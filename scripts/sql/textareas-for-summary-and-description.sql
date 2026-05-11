-- Convert documents.summary and datasets.description from jsonb (Lexical
-- rich-text) to text. The fields were declared as `richText` in Payload but
-- ingestion always wrote plain-string JSON values, so the Lexical editor
-- crashed on every admin detail page. The frontend already renders these as
-- plain strings.
--
-- Pair this migration with changing the field type from `richText` to
-- `textarea` in src/collections/Documents.ts and src/collections/Datasets.ts.

-- Idempotent: only run when the column is still jsonb. (`#>> '{}'` is a
-- jsonb operator; running it on a text column would fail.)
DO $$
BEGIN
  -- Pre-step for datasets.description: some Neon rows were saved as a Lexical
  -- AST array `[{"children":[{"text":"..."}]}]` instead of a plain string.
  -- `#>> '{}'` on those would yield the raw JSON text (preserving the data
  -- but with ugly bracket/quote noise). Collapse those rows to a single
  -- jsonb string of joined text first so the subsequent type cast is clean.
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'datasets' AND column_name = 'description') = 'jsonb' THEN
    UPDATE datasets SET description = to_jsonb((
      SELECT string_agg(coalesce(child->>'text', ''), ' ')
      FROM jsonb_array_elements(description) AS para,
           jsonb_array_elements(coalesce(para->'children', '[]'::jsonb)) AS child
    ))
    WHERE jsonb_typeof(description) = 'array';
  END IF;

  -- Now the type conversion. `#>> '{}'` handles strings (unquoted), numbers
  -- (stringified), and the now-collapsed array rows.
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'summary') = 'jsonb' THEN
    ALTER TABLE documents
      ALTER COLUMN summary TYPE text USING summary #>> '{}';
  END IF;

  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'datasets' AND column_name = 'description') = 'jsonb' THEN
    ALTER TABLE datasets
      ALTER COLUMN description TYPE text USING description #>> '{}';
  END IF;
END $$;
