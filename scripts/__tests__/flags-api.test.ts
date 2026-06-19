/**
 * Regression test: every collection value the flag UI sends must be in the
 * VALID_COLLECTIONS / TABLE_MAP allow-lists in
 * src/app/(frontend)/api/v1/flags/route.ts.
 *
 * The test reads the route file as text and asserts each known collection
 * name appears in both allow-lists. Stops us silently dropping support for
 * a collection by editing one list and not the other.
 *
 * Pins issue: https://github.com/ikb-rmbl/RMBL_knowledge_hub/issues/51
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
