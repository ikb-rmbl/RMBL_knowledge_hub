/**
 * Regression test: every collection/reason value the flag UI sends must
 * be in the VALID_COLLECTIONS / TABLE_MAP / VALID_REASONS allow-lists in
 * src/app/(frontend)/api/v1/flags/route.ts.
 *
 * The test reads the route file as text and asserts each known value
 * appears in the relevant allow-list. Stops us silently dropping support
 * for one by editing some lists and not the others.
 *
 * Pins issues: https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues/51,
 * https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues/50.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROUTE_PATH = join(
  process.cwd(),
  'src/app/(frontend)/api/v1/flags/route.ts',
)

// Every collection the public FlagButton can be wired up against. If this
// list grows, the matching admin component (FlaggedItemLink.tsx) and the
// route file both need to grow too — this test catches the drift.
const EXPECTED_COLLECTIONS = [
  'publications',
  'datasets',
  'documents',
  'stories',
  'authors',
  'species',
  'concepts',
  'protocols',
  'places',
  'neighborhoods',
  'frontiers',
  'eras',
] as const

// Every reason value the public FlagButton can submit. Same drift-catch
// pattern as the collections above. The two newer values were added by #50:
//   - attribution_issue   surfaces author-conflation reports
//   - ai_quality_issue    pre-filled from LlmProvenanceSidebar's inline link
const EXPECTED_REASONS = [
  'incorrect_data',
  'attribution_issue',
  'ai_quality_issue',
  'duplicate',
  'missing_info',
  'outdated',
  'inappropriate',
  'broken_link',
  'other',
] as const

describe('flags API: collection coverage', () => {
  const source = readFileSync(ROUTE_PATH, 'utf-8')

  it.each(EXPECTED_COLLECTIONS)(
    'lists %s in VALID_COLLECTIONS',
    (collection) => {
      // The regex matches the literal string with single quotes within the
      // VALID_COLLECTIONS Set initializer.
      const re = new RegExp(`VALID_COLLECTIONS[\\s\\S]*?'${collection}'`)
      expect(source).toMatch(re)
    },
  )

  it.each(EXPECTED_COLLECTIONS)(
    'has a TABLE_MAP entry for %s',
    (collection) => {
      const re = new RegExp(`${collection}:\\s*\\{\\s*table:`)
      expect(source).toMatch(re)
    },
  )
})

describe('flags API: reason coverage', () => {
  const source = readFileSync(ROUTE_PATH, 'utf-8')

  it.each(EXPECTED_REASONS)(
    'lists %s in VALID_REASONS',
    (reason) => {
      const re = new RegExp(`VALID_REASONS[\\s\\S]*?'${reason}'`)
      expect(source).toMatch(re)
    },
  )

  it.each(EXPECTED_REASONS)(
    'has a REASON_LABELS entry for %s',
    (reason) => {
      const re = new RegExp(`${reason}:\\s*'[^']+'`)
      expect(source).toMatch(re)
    },
  )
})
