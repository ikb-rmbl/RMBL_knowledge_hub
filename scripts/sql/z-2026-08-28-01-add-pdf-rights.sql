-- PDF redistribution-rights audit (roadmap item 5).
-- Basis values written by audit-pdf-rights.ts:
--   rmbl_owned         — student papers / theses (RMBL program works)
--   oa_licensed:<lic>  — explicit CC license from Unpaywall (redistribution OK)
--   oa_published       — gold/hybrid/diamond OA, license not stated (low risk)
--   review             — free-to-read but no redistribution grant (green/bronze)
--   unknown            — no DOI or closed access: manual worklist
ALTER TABLE publications ADD COLUMN IF NOT EXISTS pdf_rights_basis TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS pdf_rights_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS publications_pdf_rights_idx ON publications(pdf_rights_basis);
