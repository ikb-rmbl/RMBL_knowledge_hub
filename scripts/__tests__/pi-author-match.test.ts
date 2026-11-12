import { describe, expect, it } from 'vitest'
import { type CandidateEvidence, collaboratorsOf, decide, firstNames, nameCompat } from '../lib/pi-author-match.js'

const cand = (o: Partial<CandidateEvidence>): CandidateEvidence => ({
  authorId: 1, name: 'A. Person', name_match: 'initial', active_papers: 0, topic: null,
  coauthored_collaborators: [], chain: false, rare_surname: false, ...o,
})

describe('firstNames', () => {
  it('collects nicknames and skips initials', () => {
    expect(firstNames('Mary (Cassie) Stoddard')).toEqual(['mary', 'cassie'])
    expect(firstNames('Lee "Mick" Demi')).toEqual(['lee', 'mick'])
    expect(firstNames('D. W. Inouye')).toEqual([])
  })
})

describe('nameCompat', () => {
  it('agrees on prefixes and nicknames', () => {
    expect(nameCompat('Dan Blumstein', 'Daniel T. Blumstein')).toBe('agree')
    expect(nameCompat('Bill Smith', 'William Smith')).toBe('agree')
    expect(nameCompat('Kenneth Hurst Williams', 'Kenneth (Ken) H. Williams')).toBe('agree')
  })
  it('is initial-only when either side gives an initial', () => {
    expect(nameCompat('Emily Mooney', 'E. H. Mooney')).toBe('initial')
  })
  it('rejects different first names and conflicting middle initials', () => {
    expect(nameCompat('Rick Williams', 'Rebecca Williams')).toBe('conflict')
    expect(nameCompat('James D. Thomson', 'J. K. Thomson')).toBe('conflict')
  })
})

describe('collaboratorsOf', () => {
  it('parses the legacy trailer', () => {
    expect(collaboratorsOf('Text.\n\nCollaborators: Nic Alexandre, Noah Whiteman\nInstitution: UA'))
      .toEqual(['Nic Alexandre', 'Noah Whiteman'])
    expect(collaboratorsOf('no trailer')).toEqual([])
  })
})

describe('decide', () => {
  it('leaves name-only matches unlinked', () => {
    expect(decide([cand({ name_match: 'agree' })]).band).toBe('none')
  })
  it('links a full first name active at RMBL in the plan years', () => {
    const d = decide([cand({ name_match: 'agree', active_papers: 3 })])
    expect(d).toMatchObject({ band: 'auto', authorId: 1 })
  })
  it('needs topic, collaborator or rare-surname evidence for initials', () => {
    expect(decide([cand({ active_papers: 3, topic: 0.5 })]).band).toBe('review')
    expect(decide([cand({ active_papers: 3, topic: 0.65 })]).band).toBe('auto')
    expect(decide([cand({ active_papers: 1, coauthored_collaborators: ['X Y'] })]).band).toBe('auto')
    expect(decide([cand({ active_papers: 1, rare_surname: true })]).band).toBe('auto')
  })
  it('sends namesakes that both pass to review', () => {
    const d = decide([
      cand({ authorId: 1, name_match: 'agree', active_papers: 3, topic: 0.66 }),
      cand({ authorId: 2, name_match: 'agree', active_papers: 80, topic: 0.7 }),
    ])
    expect(d.band).toBe('review')
  })
  it('ignores an evidence-free duplicate registry entry', () => {
    const d = decide([cand({ authorId: 1, active_papers: 4, topic: 0.61 }), cand({ authorId: 2 })])
    expect(d).toMatchObject({ band: 'auto', authorId: 1 })
  })
  it('with a real competitor, requires more than name + dates', () => {
    const d = decide([
      cand({ authorId: 1, name_match: 'agree', active_papers: 2 }),
      cand({ authorId: 2, active_papers: 1, topic: 0.3 }),
    ])
    expect(d.band).toBe('review')
  })
  it('follows a linked renewal filing', () => {
    expect(decide([cand({ chain: true, active_papers: 1 })]).band).toBe('auto')
  })
})
