import { describe, it, expect } from 'vitest'
import { parseTranscript } from '../../src/app/(frontend)/lib/transcript.js'

const SAMPLE = `Solé Agulla [0:13]:
Good afternoon. Today is July 13, 2026.

Carol Boggs [1:04]:
Okay, so I'm not quite sure what you want.

More of the same turn, second paragraph.

David Inouye:
A turn without a timestamp.
Continuation line of the same paragraph.
`

describe('parseTranscript', () => {
  it('parses speaker turns with timestamps', () => {
    const turns = parseTranscript(SAMPLE)
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({ speaker: 'Solé Agulla', timestamp: '0:13' })
    expect(turns[1].timestamp).toBe('1:04')
    expect(turns[1].paragraphs).toHaveLength(2)
  })

  it('handles turns without timestamps and joins wrapped lines', () => {
    const turns = parseTranscript(SAMPLE)
    expect(turns[2]).toMatchObject({ speaker: 'David Inouye', timestamp: null })
    expect(turns[2].paragraphs[0]).toBe('A turn without a timestamp. Continuation line of the same paragraph.')
  })

  it('handles h:mm:ss timestamps', () => {
    const turns = parseTranscript('Carol Boggs [1:00:49]:\nKeep your eyes open.')
    expect(turns[0].timestamp).toBe('1:00:49')
  })

  it('ignores content before the first speaker header and empty turns', () => {
    const turns = parseTranscript('stray line\n\nA Speaker [0:01]:\nHello.\n\nEmpty Turn [0:02]:\n')
    expect(turns).toHaveLength(1)
    expect(turns[0].paragraphs).toEqual(['Hello.'])
  })

  it('does not treat ordinary sentences ending in a colon as headers', () => {
    const turns = parseTranscript('A Speaker [0:01]:\nHe said the following:\nmore text.')
    expect(turns).toHaveLength(1)
    expect(turns[0].paragraphs[0]).toBe('He said the following: more text.')
  })
})
