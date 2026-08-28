import { describe, it, expect } from 'vitest'
import { curatedSafe, curatedSkipClause } from '../lib/curation.js'

describe('curatedSkipClause', () => {
  it('emits string literals, not column identifiers', () => {
    // Regression: double-quoted names were parsed by Postgres as column
    // references — 'abstract' silently compared against the abstract
    // column's value, making the curation guard a no-op.
    expect(curatedSkipClause(['pdf_link'])).toBe(`NOT (curated_fields ?| array['pdfLink'])`)
    expect(curatedSkipClause(['abstract', 'pdf_link'])).toBe(
      `NOT (curated_fields ?| array['abstract', 'pdfLink'])`,
    )
  })

  it('returns TRUE for no columns', () => {
    expect(curatedSkipClause([])).toBe('TRUE')
  })
})

describe('curatedSafe', () => {
  it('camelCases the field name inside the jsonb membership test', () => {
    expect(curatedSafe('pdf_link', '$1')).toBe(
      `pdf_link = CASE WHEN curated_fields @> '["pdfLink"]'::jsonb THEN pdf_link ELSE $1 END`,
    )
  })
})
