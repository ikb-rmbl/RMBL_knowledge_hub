import { describe, expect, it } from 'vitest'
import { authorKey, personKeys, piKey } from '../lib/person-names.js'

describe('name keys', () => {
  it('collapses spelling variants of one person', () => {
    expect(piKey('Dan Blumstein')).toBe('blumstein d')
    expect(piKey('Daniel T. Blumstein')).toBe('blumstein d')
    expect(piKey('Mary (Cassie) Stoddard')).toBe('stoddard m')
    expect(piKey('Sébastien Rivest')).toBe('rivest s')
    expect(authorKey('Blumstein', 'Daniel T.')).toBe('blumstein d')
  })

  it('splits multi-PI strings', () => {
    expect(personKeys('Dan Blumstein, Kenneth Armitage')).toEqual(['blumstein d', 'armitage k'])
    expect(piKey('Dan Blumstein, Kenneth Armitage')).toBe('blumstein d')
  })
})
