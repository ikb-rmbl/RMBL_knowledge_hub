/**
 * Parser for the canonical oral-history transcript format produced by
 * scripts/ingest-oral-histories.ts:
 *
 *   Speaker Name [12:34]:
 *   Paragraph text...
 *
 *   Speaker Name:
 *   Turns without timestamps are allowed.
 *
 * Returns structured turns for safe React rendering (no HTML involved).
 */

export interface TranscriptTurn {
  speaker: string
  timestamp: string | null
  paragraphs: string[]
}

// Speaker must look like a name — up to five words, each starting with an
// uppercase letter or digit ("Solé Agulla", "Speaker 4") — so prose lines
// that happen to end with a colon are not mistaken for turn headers.
const TURN_HEADER = /^([A-ZÀ-Þ][^\s:]*(?:\s+[A-ZÀ-Þ0-9][^\s:]*){0,4})(?: \[(\d{1,2}:\d{2}(?::\d{2})?)\])?:$/

export function parseTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let cur: TranscriptTurn | null = null
  let para: string[] = []

  const flushPara = () => {
    if (cur && para.length > 0) {
      cur.paragraphs.push(para.join(' '))
      para = []
    }
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const m = trimmed.match(TURN_HEADER)
    if (m) {
      flushPara()
      cur = { speaker: m[1], timestamp: m[2] ?? null, paragraphs: [] }
      turns.push(cur)
    } else if (trimmed === '') {
      flushPara()
    } else if (cur) {
      para.push(trimmed)
    }
  }
  flushPara()
  return turns.filter((t) => t.paragraphs.length > 0)
}
