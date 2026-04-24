import type { Metadata } from 'next'
import Link from 'next/link'
import { getDb } from '../lib/db'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'About — RMBL Knowledge Hub',
  description: 'How the RMBL Knowledge Hub works: data sources, knowledge graph construction, and technical architecture.',
}

export default async function AboutPage() {
  const db = getDb()

  // Fetch live counts for the stats section
  const { rows: counts } = await db.query(`
    SELECT
      (SELECT count(*) FROM publications)::int as publications,
      (SELECT count(*) FROM datasets)::int as datasets,
      (SELECT count(*) FROM documents)::int as documents,
      (SELECT count(*) FROM authors WHERE work_count > 0)::int as authors,
      (SELECT count(*) FROM species WHERE publication_count > 0)::int as species,
      (SELECT count(*) FROM concepts)::int as concepts,
      (SELECT count(*) FROM protocols)::int as protocols,
      (SELECT count(*) FROM places WHERE publication_count > 0)::int as places,
      (SELECT count(*) FROM neighborhoods)::int as neighborhoods,
      (SELECT count(*) FROM neighborhoods WHERE primer IS NOT NULL)::int as primers,
      (SELECT count(*) FROM entity_mentions)::int as entity_mentions,
      (SELECT count(*) FROM references_cited)::int as references
  `)
  const c = counts[0]

  return (
    <div className="detail" style={{ maxWidth: '780px' }}>
      <h1>About the Knowledge Hub</h1>

      <p style={{ fontSize: '15px', lineHeight: 1.7, color: 'var(--fg-2)', marginBottom: '24px' }}>
        The RMBL Knowledge Hub is a unified search and discovery platform for environmental research at the{' '}
        <a href="https://www.rmbl.org" target="_blank" rel="noopener noreferrer">Rocky Mountain Biological Laboratory</a>{' '}
        in Gothic, Colorado. It connects scientific publications, community documents, research datasets, and a knowledge
        graph of species, concepts, protocols, and places studied at one of the longest-running field biology stations in North America.
      </p>

      {/* ===== At a Glance ===== */}
      <div className="detail-section">
        <h2>At a Glance</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', margin: '16px 0' }}>
          {[
            { label: 'Publications', value: c.publications.toLocaleString(), href: '/search?type=publications' },
            { label: 'Datasets', value: c.datasets.toLocaleString(), href: '/search?type=datasets' },
            { label: 'Documents', value: c.documents.toLocaleString(), href: '/search?type=documents' },
            { label: 'Authors', value: c.authors.toLocaleString(), href: '/authors' },
            { label: 'Species', value: c.species.toLocaleString(), href: '/species' },
            { label: 'Concepts', value: c.concepts.toLocaleString(), href: '/concepts' },
            { label: 'Protocols', value: c.protocols.toLocaleString(), href: '/protocols' },
            { label: 'Places', value: c.places.toLocaleString(), href: '/places' },
            { label: 'Neighborhoods', value: c.neighborhoods.toLocaleString(), href: '/neighborhoods' },
            { label: 'Research Primers', value: c.primers.toLocaleString(), href: '/neighborhoods' },
            { label: 'Entity Mentions', value: c.entity_mentions.toLocaleString() },
            { label: 'Citation Links', value: c.references.toLocaleString() },
          ].map((stat) => (
            <div key={stat.label} style={{ padding: '12px 16px', background: 'var(--bg-inset)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent)' }}>{stat.value}</div>
              {stat.href ? (
                <Link href={stat.href} style={{ fontSize: '13px', color: 'var(--fg-2)', textDecoration: 'none' }}>{stat.label}</Link>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--fg-2)' }}>{stat.label}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ===== FAQ Section ===== */}
      <div className="detail-section">
        <h2>Frequently Asked Questions</h2>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>What is the RMBL Knowledge Hub?</summary>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 12px', maxWidth: '65ch' }}>
            The Knowledge Hub is a search and discovery tool that brings together the scientific output of RMBL and the
            Gunnison Basin into one searchable platform. It includes peer-reviewed publications dating back to 1928,
            community and policy documents from the Sustainable Living Library, and research datasets from multiple
            repositories. A knowledge graph connects these resources through shared species, concepts, research methods,
            and geographic locations.
          </p>
        </details>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Who is this for?</summary>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 12px', maxWidth: '65ch' }}>
            The Hub is designed for researchers, students, land managers, community members, and policymakers interested
            in the environmental research and stewardship of the Gunnison Basin. It is equally useful for scientists
            looking for related work and for community members exploring how research connects to local policy issues.
          </p>
        </details>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>What are Knowledge Neighborhoods?</summary>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 12px', maxWidth: '65ch' }}>
            Knowledge Neighborhoods are research communities detected automatically by analyzing the connections in the
            knowledge graph. Using a community-detection algorithm (Louvain), the system identifies clusters of
            tightly connected authors, publications, species, concepts, and places. Each neighborhood represents a
            distinct research theme — from marmot behavioral ecology to watershed biogeochemistry to federal land
            management policy. Many neighborhoods include AI-generated research primers that summarize the key findings
            and cite specific publications.
          </p>
        </details>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>How do I use the API or MCP server?</summary>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 12px', maxWidth: '65ch' }}>
            The Hub provides a REST API at <code>/api/v1/</code> with endpoints for search, publication detail, entity
            lookup, related works, and more. Add <code>?format=text</code> to any endpoint for LLM-friendly plain text.
            For AI assistants like Claude Desktop, an MCP server is available — see the{' '}
            <a href="https://github.com/ikb-rmbl/RMBL_knowledge_hub/tree/main/mcp" target="_blank" rel="noopener noreferrer">
              MCP documentation
            </a>{' '}
            for setup instructions. See <a href="/llms.txt">/llms.txt</a> for a machine-readable index of available endpoints.
          </p>
        </details>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>How can I contribute or report issues?</summary>
          <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 12px', maxWidth: '65ch' }}>
            The Knowledge Hub is developed and maintained by RMBL. If you notice missing publications, incorrect
            data, or have suggestions for improvement, please contact RMBL or submit an issue on the{' '}
            <a href="https://github.com/ikb-rmbl/RMBL_knowledge_hub" target="_blank" rel="noopener noreferrer">
              GitHub repository
            </a>.
          </p>
        </details>
      </div>

      {/* ===== AI Integration ===== */}
      <div className="detail-section">
        <h2>AI Integration</h2>
        <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', marginBottom: '16px', maxWidth: '65ch' }}>
          The Knowledge Hub can be queried by AI assistants via the REST API or the MCP (Model Context Protocol) server.
          This allows tools like Claude Desktop, ChatGPT, and custom scripts to search publications, explore research
          neighborhoods, and access the knowledge graph programmatically.
        </p>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>REST API</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p style={{ marginBottom: '12px' }}>
              All API endpoints are at <code>/api/v1/</code> and support <code>?format=text</code> for LLM-friendly plain text.
              See <a href="/llms.txt">/llms.txt</a> for a complete list. Examples:
            </p>
            <pre style={{ fontSize: '13px', lineHeight: 1.5, padding: '12px 16px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'auto' }}>
{`# Search for publications about alpine pollination
curl "https://rmblknowledgehub.org/api/v1/search?q=alpine+pollination&format=text"

# Get publication details
curl "https://rmblknowledgehub.org/api/v1/publications/13?format=text"

# Explore a research neighborhood with primer
curl "https://rmblknowledgehub.org/api/v1/neighborhoods/620?format=text"

# Look up a species
curl "https://rmblknowledgehub.org/api/v1/entities/species/8426?format=text"

# Find related works
curl "https://rmblknowledgehub.org/api/v1/related/publications/13?format=text"`}
            </pre>
          </div>
        </details>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>MCP Server for Claude Desktop</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p style={{ marginBottom: '12px' }}>
              The MCP server gives Claude Desktop (and other MCP-compatible tools) direct access to 8 Knowledge Hub tools:
              search, publication/dataset/document lookup, entity detail, related works, and neighborhood exploration.
            </p>

            <p style={{ marginBottom: '8px' }}>
              <strong>Step 1:</strong> Clone the repository and build the MCP server:
            </p>
            <pre style={{ fontSize: '13px', lineHeight: 1.5, padding: '12px 16px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'auto' }}>
{`git clone https://github.com/ikb-rmbl/RMBL_knowledge_hub.git
cd RMBL_knowledge_hub/mcp
npm install
npm run build`}
            </pre>

            <p style={{ marginTop: '12px', marginBottom: '8px' }}>
              <strong>Step 2:</strong> Add to your Claude Desktop config (<code>~/Library/Application Support/Claude/claude_desktop_config.json</code>):
            </p>
            <pre style={{ fontSize: '13px', lineHeight: 1.5, padding: '12px 16px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'auto' }}>
{`{
  "mcpServers": {
    "rmbl-knowledge-hub": {
      "command": "node",
      "args": ["/path/to/RMBL_knowledge_hub/mcp/dist/index.js"],
      "env": {
        "RMBL_API_URL": "https://rmblknowledgehub.org"
      }
    }
  }
}`}
            </pre>

            <p style={{ marginTop: '12px', marginBottom: '8px' }}>
              <strong>Step 3:</strong> Restart Claude Desktop. You should see 8 tools available (hammer icon). Try asking:
            </p>
            <ul style={{ paddingLeft: '20px' }}>
              <li>&ldquo;Search for publications about marmot hibernation at RMBL&rdquo;</li>
              <li>&ldquo;What is research neighborhood 620 about?&rdquo;</li>
              <li>&ldquo;Find works related to publication 13&rdquo;</li>
              <li>&ldquo;Look up the species Marmota flaviventer&rdquo;</li>
            </ul>
          </div>
        </details>

        <details style={{ marginBottom: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Available MCP Tools</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', overflow: 'auto' }}>
            <table style={{ fontSize: '13px', borderCollapse: 'collapse', width: '100%', maxWidth: '65ch' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-strong)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Tool</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['search_rmbl', 'Full-text search across all collections'],
                  ['get_publication', 'Publication detail with authors, abstract, entities, citations'],
                  ['get_dataset', 'Dataset detail with creators and entities'],
                  ['get_document', 'Document detail with entities and stakeholders'],
                  ['get_entity', 'Entity lookup (species, concept, protocol, place, stakeholder)'],
                  ['find_related', 'Related works via semantic similarity, shared entities, co-authorship, citations'],
                  ['explore_neighborhood', 'Research neighborhood detail with primer'],
                  ['list_neighborhoods', 'Browse or search 154 research neighborhoods'],
                ].map(([tool, desc]) => (
                  <tr key={tool} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{tool}</td>
                    <td style={{ padding: '6px 12px', color: 'var(--fg-2)' }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* ===== Technical Deep-Dive ===== */}
      <div className="detail-section">
        <h2>Technical Deep-Dive</h2>
        <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', marginBottom: '16px', maxWidth: '65ch' }}>
          The sections below describe how data flows into the Knowledge Hub and how the knowledge graph is constructed.
        </p>

        <details style={{ marginBottom: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Data Sources</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p><strong>Publications</strong> are sourced from the RMBL publications database, with additional
            discovery via OpenAlex and CrossRef. Each record is enriched with metadata from CrossRef (authors, DOIs,
            abstracts, citation counts) and Unpaywall (open access links). Full text is extracted from PDFs using
            pdftotext with OCR fallback via Tesseract.</p>

            <p style={{ marginTop: '12px' }}><strong>Datasets</strong> are discovered from eight repository sources including
            EDI, DataONE, Dryad, Zenodo, USGS ScienceBase, Pangaea, NCBI, and Figshare. Each dataset is enriched with
            EML/DataCite metadata including temporal and spatial coverage, creator information, and licensing.</p>

            <p style={{ marginTop: '12px' }}><strong>Documents</strong> come from the Sustainable Living Library, a
            collection of community and policy documents relevant to the Gunnison Basin. These include management plans,
            environmental impact statements, water quality reports, and local planning documents.</p>
          </div>
        </details>

        <details style={{ marginBottom: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Author Deduplication</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p>Authors are deduplicated across all collections using a two-phase process. First, authors with matching
            ORCID identifiers are merged. Then, authors sharing the same family name are compared by given name initials,
            with checks to prevent false merges when middle initials differ (e.g., &ldquo;R. J. Smith&rdquo; is kept separate from
            &ldquo;R. A. Smith&rdquo;). Author ordering on publications is repaired from CrossRef metadata to ensure
            correct first-author attribution.</p>
          </div>
        </details>

        <details style={{ marginBottom: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Entity Extraction &amp; Knowledge Graph</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p>Entities (species, concepts, protocols, places, and stakeholders) are extracted from publication and
            document full text using Claude vision models (VLM extraction). Each entity mention is linked to its source
            item with a confidence score and extraction method. Entities are then deduplicated using embedding-based
            clustering (Voyage AI voyage-4, 1024 dimensions) with type-specific similarity thresholds.</p>

            <p style={{ marginTop: '12px' }}>Species names are validated against the ITIS (Integrated Taxonomic
            Information System) database. Places are enriched with coordinates from GNIS (Geographic Names Information
            System) and organized into a parent-child hierarchy.</p>

            <p style={{ marginTop: '12px' }}>The resulting knowledge graph has {c.entity_mentions.toLocaleString()} entity
            mentions linking items to entities, plus {c.references.toLocaleString()} citation references with internal
            cross-links between publications.</p>
          </div>
        </details>

        <details style={{ marginBottom: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Community Detection &amp; Primers</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p>Knowledge Neighborhoods are detected using the Louvain community detection algorithm on the unified
            knowledge graph. The graph includes all entities and items as nodes, with edges from co-occurrence in
            publications, co-authorship, and citations. Edge weights are boosted for structural relationships
            (co-authorship &times;5, citations &times;3) to ensure that social and citation structure drives community
            boundaries rather than just shared terminology.</p>

            <p style={{ marginTop: '12px' }}>Research primers are generated for the largest neighborhoods using Claude
            (Opus model) with tiered context assembly: landmark papers (full abstracts + key findings), frontier
            papers (2020+), breadth papers (single best finding each), and entity context (species, concepts, methods,
            places). Each primer includes parenthetical citations linked to specific publications in the Hub. Policy-focused
            neighborhoods receive primers with document citations instead.</p>
          </div>
        </details>

        <details style={{ marginBottom: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Search &amp; Similarity</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p>Full-text search uses PostgreSQL tsvector with weighted ranking (title &gt; abstract &gt; full text) and
            stemmed query matching. Search results include highlighted snippets via ts_headline.</p>

            <p style={{ marginTop: '12px' }}>Related works are found using four signals: semantic similarity (pgvector
            cosine distance on Voyage AI embeddings), shared entity mentions (at least 3 shared entities), co-authorship
            (shared authors across publications), and citation links (from the references_cited table). Signals are
            merged with a multi-signal bonus for items connected by multiple pathways.</p>
          </div>
        </details>

        <details style={{ marginBottom: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '15px', padding: '8px 0' }}>Technology Stack</summary>
          <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', padding: '4px 0 16px', maxWidth: '65ch' }}>
            <p>The Knowledge Hub is built with Next.js and Payload CMS on PostgreSQL with pgvector. Graph visualizations
            use Sigma.js (WebGL). The data pipeline is a set of TypeScript scripts for scraping, enrichment, entity
            extraction, and graph construction. Vector embeddings are generated by Voyage AI (voyage-4, 1024 dimensions).
            The site is hosted on Vercel with the database on Neon (serverless PostgreSQL).</p>

            <p style={{ marginTop: '12px' }}>The project is open source at{' '}
            <a href="https://github.com/ikb-rmbl/RMBL_knowledge_hub" target="_blank" rel="noopener noreferrer">
              github.com/ikb-rmbl/RMBL_knowledge_hub
            </a>.</p>
          </div>
        </details>
      </div>

      {/* ===== Feedback ===== */}
      <div className="detail-section">
        <h2>Feedback &amp; Contact</h2>
        <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', marginBottom: '12px', maxWidth: '65ch' }}>
          The Knowledge Hub is an evolving platform and we welcome feedback from the community. If you notice
          missing publications, incorrect data, broken links, or have ideas for new features, there are two ways
          to get in touch:
        </p>
        <ul style={{ fontSize: '14px', lineHeight: 1.9, color: 'var(--fg-2)', paddingLeft: '20px', maxWidth: '65ch' }}>
          <li>
            <strong>Report an issue on GitHub:</strong>{' '}
            <a href="https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues" target="_blank" rel="noopener noreferrer">
              github.com/ikb-rmbl/RMBL_knowledge_hub/issues
            </a>
            {' '}&mdash; best for bug reports, data corrections, and feature requests.
          </li>
          <li>
            <strong>Contact the developer:</strong>{' '}
            Ian Breckheimer &mdash;{' '}
            <a href="mailto:ikb@rmbl.org">ikb@rmbl.org</a>
          </li>
        </ul>
      </div>

      {/* ===== Acknowledgments ===== */}
      <div className="detail-section">
        <h2>Acknowledgments</h2>
        <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--fg-2)', maxWidth: '65ch' }}>
          The RMBL Knowledge Hub was developed with support from the Clark Family Foundation.
          Built by <a href="https://www.rmbl.org" target="_blank" rel="noopener noreferrer">RMBL</a> using
          data from CrossRef, OpenAlex, Unpaywall, ITIS, GNIS, and multiple data repositories.
        </p>
      </div>
    </div>
  )
}
