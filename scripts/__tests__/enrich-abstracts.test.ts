import { describe, it, expect } from 'vitest'

// Replicate the regex extraction functions from enrich-abstracts.ts for testing
// These are pure functions with no external dependencies

const ABSTRACT_PATTERNS = [
  /(?:^|\n)\s*\x0C?Abstract:?\s*\n+([\s\S]{50,3000}?)(?:\n\s*(?:Introduction|Methods|Background|Keywords|Mentor|Student|Table of Contents|Acknowledgment|References|Literature Cited)\b)/i,
  /(?:^|\n)\s*\x0C?Abstract:?\s*\n+([\s\S]{50,2000}?)\n\s*\n/i,
  /(?:^|\n)\s*ABSTRACT\s*\n+([\s\S]{50,2000}?)\n\s*\n/i,
]

function extractAbstractFromText(fullText: string): string | null {
  for (const pattern of ABSTRACT_PATTERNS) {
    const match = fullText.match(pattern)
    if (match && match[1]) {
      const cleaned = match[1].replace(/\s+/g, ' ').trim()
      if (cleaned.length >= 50 && cleaned.length <= 3000) {
        return cleaned
      }
    }
  }
  return null
}

function extractSummaryFromText(fullText: string): string | null {
  const lines = fullText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  let startIdx = 0
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].length < 50 || /^[A-Z\s\d.,:-]+$/.test(lines[i])) {
      startIdx = i + 1
    } else {
      break
    }
  }
  const textLines = lines.slice(startIdx, startIdx + 20)
  const text = textLines.join(' ').replace(/\s+/g, ' ').trim()
  const words = text.split(/\s+/).slice(0, 300)
  const summary = words.join(' ')
  return summary.length >= 50 ? summary : null
}

describe('extractAbstractFromText', () => {
  it('extracts abstract with "Abstract:" header followed by Introduction', () => {
    const text = `Title of Paper\n\nAbstract:\n\nThis study examines the effects of climate change on alpine wildflower phenology in the Rocky Mountains over a thirty-year period.\n\nIntroduction\n\nClimate change is affecting...`
    const result = extractAbstractFromText(text)
    expect(result).toContain('examines the effects of climate change')
  })

  it('extracts abstract with "Abstract" header (no colon)', () => {
    const text = `\nAbstract\n\nWe investigated pollinator foraging behavior across an elevational gradient in subalpine meadows near Gothic, Colorado during the summer of 2020.\n\nMethods\n\nWe established...`
    const result = extractAbstractFromText(text)
    expect(result).toContain('pollinator foraging behavior')
  })

  it('extracts abstract with page break character', () => {
    const text = `Student: Jane Smith\nMentor: Dr. Jones\n\x0CAbstract\n\nYellow-bellied marmots are important indicators of climate change in alpine ecosystems because their hibernation patterns respond to temperature changes.\n\nIntroduction\n\n`
    const result = extractAbstractFromText(text)
    expect(result).toContain('Yellow-bellied marmots')
  })

  it('extracts ABSTRACT in all caps', () => {
    const text = `\nABSTRACT\n\nStream macroinvertebrate communities in the East River watershed respond to both natural and anthropogenic disturbance gradients over multiple spatial scales.\n\n\nKeywords: stream ecology`
    const result = extractAbstractFromText(text)
    expect(result).toContain('macroinvertebrate communities')
  })

  it('returns null when no abstract header found', () => {
    const text = `This is a report about water quality.\n\nThe Gunnison River provides water to many communities.`
    expect(extractAbstractFromText(text)).toBeNull()
  })

  it('returns null when abstract text is too short', () => {
    const text = `Abstract\n\nShort text.\n\nIntroduction`
    expect(extractAbstractFromText(text)).toBeNull()
  })

  it('normalizes whitespace in extracted abstract', () => {
    const text = `Abstract:\n\nThis   study   has   lots   of   extra   whitespace   and   examines   the   relationship   between   soil   moisture   and   plant   growth.\n\nMethods`
    const result = extractAbstractFromText(text)
    expect(result).not.toContain('   ')
  })
})

describe('extractSummaryFromText', () => {
  it('extracts first substantial paragraph, skipping headers', () => {
    const text = `GUNNISON COUNTY WATER PLAN\nPREPARED BY THE WATER COMMITTEE\n2024\n\nThis comprehensive plan addresses the water resource needs of Gunnison County communities including supply, demand, conservation, and environmental flows.`
    const result = extractSummaryFromText(text)
    expect(result).toContain('comprehensive plan')
    expect(result).not.toContain('GUNNISON COUNTY')
  })

  it('returns null for very short text', () => {
    expect(extractSummaryFromText('Short.')).toBeNull()
  })

  it('limits to approximately 300 words', () => {
    const longText = 'TITLE\n\n' + Array(500).fill('word').join(' ')
    const result = extractSummaryFromText(longText)
    expect(result).toBeTruthy()
    const wordCount = result!.split(/\s+/).length
    expect(wordCount).toBeLessThanOrEqual(300)
  })

  it('handles text with no headers (all substantial lines)', () => {
    const text = `The Rocky Mountain Biological Laboratory is located in Gothic, Colorado at an elevation of 9,500 feet. It provides facilities for researchers studying alpine and subalpine ecosystems.`
    const result = extractSummaryFromText(text)
    expect(result).toContain('Rocky Mountain Biological Laboratory')
  })
})
