import { describe, expect, it } from 'vitest'
import { resolveSpeciesRef } from '../lib/entity-name-match'

// Registry stand-in: "damselfly" is the common name of one registry species.
const registry: Record<string, number> = { damselfly: 1, 'lestes disjunctus': 2, cattle: 3, 'yellow-bellied marmot': 4 }
const resolve = (n: unknown) => registry[String(n ?? '').trim().toLowerCase()] ?? null

describe('resolveSpeciesRef', () => {
  it('resolves an exact Latin name', () => {
    expect(resolveSpeciesRef(resolve, { scientificName: 'Lestes disjunctus', commonName: 'damselfly' })).toBe(2)
  })
  it('does not fall back to a common name when the extractor gave a different Latin name', () => {
    expect(resolveSpeciesRef(resolve, { scientificName: 'Lestes congener', commonName: 'damselfly' }, 'damselfly')).toBeNull()
  })
  it('does not map a genus-level "sp." to a species via its common name', () => {
    expect(resolveSpeciesRef(resolve, { scientificName: 'Dytiscus sp.', commonName: 'damselfly' })).toBeNull()
  })
  it('uses vernacular names when no Latin name was extracted', () => {
    expect(resolveSpeciesRef(resolve, { scientificName: 'cattle', commonName: 'cattle' })).toBe(3)
    expect(resolveSpeciesRef(resolve, { scientificName: '', commonName: 'yellow-bellied marmot' })).toBe(4)
  })
})
