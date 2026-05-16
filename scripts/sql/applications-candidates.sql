-- Candidate mining for the "applications" entity (Stage 1, deterministic).
-- Surfaces research↔practice connections from references_cited + entity_mentions
-- + neighborhood overlap. No LLM. Run as:
--   psql rmbl_knowledge_hub -f scripts/sql/applications-candidates.sql

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- A. Realized direct citations: document → publication
-- High-confidence signal, but very rare (~33 in current corpus).
-- ---------------------------------------------------------------------------
\echo '--- A. Realized: document → publication direct citations ---'
SELECT
  d.id            AS source_doc_id,
  d.title         AS source_doc_title,
  d.document_type AS doc_type,
  p.id            AS target_pub_id,
  p.title         AS target_pub_title,
  p.year          AS pub_year,
  r.match_confidence,
  r.cited_authors
FROM references_cited r
JOIN documents    d ON d.id = r.source_document_id
JOIN publications p ON p.id = r.target_publication_id
ORDER BY d.id, r.match_confidence DESC NULLS LAST
LIMIT 50;

-- ---------------------------------------------------------------------------
-- B. Realized indirect: story → publication
-- The biggest "realized" signal (~19,827 rows). News linking research to
-- public discourse. Each row is a candidate evidence chain.
-- ---------------------------------------------------------------------------
\echo '\n--- B. Realized: story → publication citations, top 20 pubs by story count ---'
SELECT
  p.id                            AS pub_id,
  p.title                         AS pub_title,
  p.year                          AS pub_year,
  count(*)                        AS story_citations,
  array_agg(DISTINCT s.id ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL) AS story_ids,
  array_agg(DISTINCT s.date::date) FILTER (WHERE s.date IS NOT NULL) AS dates
FROM references_cited r
JOIN publications p ON p.id = r.target_publication_id
LEFT JOIN stories s ON s.id = r.source_story_id
WHERE r.source_story_id IS NOT NULL
GROUP BY p.id, p.title, p.year
ORDER BY story_citations DESC
LIMIT 20;

-- ---------------------------------------------------------------------------
-- C. Potential applications: pub↔doc topical overlap WITHOUT direct citation
-- High-leverage candidates: documents and publications that share substantial
-- entity vocabulary (concepts + species + places + stakeholders) but have no
-- explicit citation chain. Filter for at least 3 shared SPECIFIC entities.
-- ---------------------------------------------------------------------------
\echo '\n--- C. Potential: pub↔doc topical overlap (≥3 shared specific entities, no citation) ---'
WITH pub_entities AS (
  SELECT item_id AS pub_id, entity_type, entity_id
  FROM entity_mentions
  WHERE collection = 'publications'
    AND entity_type IN ('concept', 'species', 'place', 'stakeholder', 'protocol')
),
doc_entities AS (
  SELECT item_id AS doc_id, entity_type, entity_id
  FROM entity_mentions
  WHERE collection = 'documents'
    AND entity_type IN ('concept', 'species', 'place', 'stakeholder', 'protocol')
),
overlap AS (
  SELECT
    pe.pub_id,
    de.doc_id,
    count(DISTINCT (pe.entity_type, pe.entity_id))                     AS shared_entities,
    count(DISTINCT pe.entity_id) FILTER (WHERE pe.entity_type='concept')     AS shared_concepts,
    count(DISTINCT pe.entity_id) FILTER (WHERE pe.entity_type='species')     AS shared_species,
    count(DISTINCT pe.entity_id) FILTER (WHERE pe.entity_type='place')       AS shared_places,
    count(DISTINCT pe.entity_id) FILTER (WHERE pe.entity_type='stakeholder') AS shared_stakeholders,
    array_agg(DISTINCT pe.entity_type || ':' || pe.entity_id) AS shared_entity_keys
  FROM pub_entities pe
  JOIN doc_entities de USING (entity_type, entity_id)
  GROUP BY pe.pub_id, de.doc_id
),
not_already_cited AS (
  SELECT o.*
  FROM overlap o
  WHERE o.shared_entities >= 3
    AND NOT EXISTS (
      SELECT 1 FROM references_cited r
      WHERE r.source_document_id = o.doc_id
        AND r.target_publication_id = o.pub_id
    )
)
SELECT
  p.id   AS pub_id,
  left(p.title, 70) AS pub_title,
  p.year,
  d.id   AS doc_id,
  left(d.title, 70) AS doc_title,
  d.document_type,
  o.shared_entities,
  o.shared_concepts,
  o.shared_species,
  o.shared_places,
  o.shared_stakeholders
FROM not_already_cited o
JOIN publications p ON p.id = o.pub_id
JOIN documents   d  ON d.id = o.doc_id
ORDER BY o.shared_entities DESC, o.shared_stakeholders DESC
LIMIT 30;

-- ---------------------------------------------------------------------------
-- D. Most "research-informed" documents — those with most pub citations or
-- highest topical overlap with the pubs corpus. Useful for prioritizing
-- which docs to deeply analyze for application chains.
-- ---------------------------------------------------------------------------
\echo '\n--- D. Most research-informed documents ---'
WITH per_doc_cites AS (
  SELECT r.source_document_id AS doc_id, count(DISTINCT r.target_publication_id) AS n_direct_cites
  FROM references_cited r
  WHERE r.source_document_id IS NOT NULL AND r.target_publication_id IS NOT NULL
  GROUP BY r.source_document_id
),
per_doc_overlap AS (
  SELECT em_doc.item_id AS doc_id, count(DISTINCT em_pub.item_id) AS n_overlapping_pubs
  FROM entity_mentions em_doc
  JOIN entity_mentions em_pub USING (entity_type, entity_id)
  WHERE em_doc.collection = 'documents'
    AND em_pub.collection = 'publications'
    AND em_doc.entity_type IN ('concept', 'species', 'place', 'stakeholder', 'protocol')
  GROUP BY em_doc.item_id
)
SELECT
  d.id,
  left(d.title, 75) AS title,
  d.document_type,
  coalesce(pdc.n_direct_cites, 0)      AS direct_pub_cites,
  coalesce(pdo.n_overlapping_pubs, 0)  AS overlapping_pubs
FROM documents d
LEFT JOIN per_doc_cites pdc   ON pdc.doc_id = d.id
LEFT JOIN per_doc_overlap pdo ON pdo.doc_id = d.id
WHERE coalesce(pdc.n_direct_cites, 0) > 0
   OR coalesce(pdo.n_overlapping_pubs, 0) >= 20
ORDER BY direct_pub_cites DESC, overlapping_pubs DESC
LIMIT 30;

-- ---------------------------------------------------------------------------
-- E. Most "applied" publications — those most cited by docs or stories,
-- or with strongest topical overlap with docs. The "translated" research.
-- ---------------------------------------------------------------------------
\echo '\n--- E. Most-applied publications (cited by docs/stories, or doc-overlapping) ---'
WITH per_pub AS (
  SELECT
    p.id,
    p.title,
    p.year,
    coalesce(p.external_citation_count, 0) AS academic_cites,
    (SELECT count(*) FROM references_cited WHERE source_document_id IS NOT NULL AND target_publication_id = p.id) AS doc_cites,
    (SELECT count(*) FROM references_cited WHERE source_story_id    IS NOT NULL AND target_publication_id = p.id) AS story_cites,
    (SELECT count(DISTINCT em_d.item_id)
       FROM entity_mentions em_p
       JOIN entity_mentions em_d USING (entity_type, entity_id)
       WHERE em_p.collection = 'publications' AND em_p.item_id = p.id
         AND em_d.collection = 'documents'
         AND em_p.entity_type IN ('concept','species','place','stakeholder','protocol')
    ) AS doc_overlap_count
  FROM publications p
)
SELECT
  id, left(title, 60) AS title, year,
  academic_cites, doc_cites, story_cites, doc_overlap_count,
  (doc_cites * 5 + story_cites * 1 + doc_overlap_count) AS application_signal
FROM per_pub
WHERE doc_cites > 0 OR story_cites >= 3 OR doc_overlap_count >= 20
ORDER BY application_signal DESC
LIMIT 30;

-- ---------------------------------------------------------------------------
-- F. Frontier-bridge candidates: management-relevant frontier statements
-- (from frontiers extraction) paired with stakeholders/agencies that
-- would be the natural audience for that research. Surfaces "research X
-- could inform agency Y, but Y hasn't cited X yet."
-- (Populated AFTER frontiers extraction lands in DB. Placeholder query.)
-- ---------------------------------------------------------------------------
\echo '\n--- F. Frontier-bridge candidates: pending frontiers table ---'
SELECT '(skipped — frontier_atomic_statements table not yet created)' AS note;
