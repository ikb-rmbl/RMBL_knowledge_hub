-- Add target_document_id to references_cited to support document→document citations
-- from LLM-extracted referenced works that match other documents in the corpus.

ALTER TABLE references_cited ADD COLUMN IF NOT EXISTS target_document_id INTEGER
  REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS refs_target_doc_idx ON references_cited(target_document_id);
