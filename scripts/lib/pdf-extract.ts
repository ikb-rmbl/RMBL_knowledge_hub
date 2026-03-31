/**
 * PDF Text Extraction Library
 *
 * Two-pass approach using system tools (poppler + tesseract):
 *   Pass 1 (fast): pdftotext for digitally-created PDFs
 *   Pass 2 (OCR):  pdftoppm + tesseract for scanned documents
 *
 * Requires: brew install poppler tesseract
 */

import { readFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from 'fs'
import { execSync, execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

const PDFTOTEXT_PATH = which('pdftotext')
const TESSERACT_PATH = which('tesseract')
const PDFTOPPM_PATH = which('pdftoppm')
const PDFINFO_PATH = which('pdfinfo')

export function checkTools(): { pdftotext: boolean; tesseract: boolean; pdftoppm: boolean } {
  return {
    pdftotext: PDFTOTEXT_PATH !== null,
    tesseract: TESSERACT_PATH !== null,
    pdftoppm: PDFTOPPM_PATH !== null,
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  text: string
  method: 'digital' | 'ocr' | 'mixed'
  pageCount: number
  qualityScore: number
  needsReview: boolean
  reviewReason: string | null
}

// ---------------------------------------------------------------------------
// Quality heuristics
// ---------------------------------------------------------------------------

function getPageCount(pdfPath: string): number {
  if (!PDFINFO_PATH) return 0
  try {
    const info = execFileSync(PDFINFO_PATH, [pdfPath], { encoding: 'utf-8', timeout: 10000 })
    const match = info.match(/Pages:\s+(\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch {
    return 0
  }
}

function assessDigitalQuality(text: string, pageCount: number): { ok: boolean; reason?: string } {
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: 'No text extracted' }
  }

  const charsPerPage = text.length / Math.max(pageCount, 1)
  if (charsPerPage < 100) {
    return { ok: false, reason: `Too few chars/page: ${Math.round(charsPerPage)}` }
  }

  // Check that there are actual words (not just symbols/garbage)
  const words = text.split(/\s+/).filter((w) => /^[a-zA-Z]{2,}$/.test(w))
  const allTokens = text.split(/\s+/).filter(Boolean)
  const wordRatio = words.length / Math.max(allTokens.length, 1)
  if (wordRatio < 0.3) {
    return { ok: false, reason: `Low word ratio: ${(wordRatio * 100).toFixed(0)}%` }
  }

  return { ok: true }
}

function scoreText(text: string, pageCount: number): number {
  if (!text || text.trim().length === 0) return 0

  let score = 1.0

  const charsPerPage = text.length / Math.max(pageCount, 1)
  if (charsPerPage < 200) score -= 0.3
  else if (charsPerPage < 500) score -= 0.1

  const words = text.split(/\s+/).filter((w) => /^[a-zA-Z]{2,}$/.test(w))
  const allTokens = text.split(/\s+/).filter(Boolean)
  const wordRatio = words.length / Math.max(allTokens.length, 1)
  if (wordRatio < 0.4) score -= 0.3
  else if (wordRatio < 0.6) score -= 0.1

  const replacements = (text.match(/\uFFFD/g) || []).length
  if (replacements > 10) score -= 0.2

  return Math.max(0, Math.min(1, score))
}

// ---------------------------------------------------------------------------
// Pass 1: Digital extraction via pdftotext (poppler)
// ---------------------------------------------------------------------------

function extractDigital(pdfPath: string): string {
  if (!PDFTOTEXT_PATH) {
    throw new Error('pdftotext not found. Install with: brew install poppler')
  }

  return execFileSync(PDFTOTEXT_PATH, ['-layout', pdfPath, '-'], {
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 50 * 1024 * 1024, // 50MB for large documents
  })
}

/** Extract text per-page to detect cover-page-only PDFs */
function extractDigitalPerPage(pdfPath: string, pageCount: number): string[] {
  if (!PDFTOTEXT_PATH) return []

  const pages: string[] = []
  for (let i = 1; i <= pageCount; i++) {
    try {
      const text = execFileSync(PDFTOTEXT_PATH, ['-f', String(i), '-l', String(i), '-layout', pdfPath, '-'], {
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 10 * 1024 * 1024,
      })
      pages.push(text)
    } catch {
      pages.push('')
    }
  }
  return pages
}

/** OCR specific page ranges (1-indexed, inclusive) */
function ocrPageRange(pdfPath: string, firstPage: number, lastPage: number): string {
  if (!TESSERACT_PATH || !PDFTOPPM_PATH) return ''

  const tempDir = join(tmpdir(), `rmbl-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    execFileSync(PDFTOPPM_PATH, [
      '-png', '-r', '300',
      '-f', String(firstPage), '-l', String(lastPage),
      pdfPath, join(tempDir, 'page'),
    ], { timeout: 300000 })

    const pageFiles = readdirSync(tempDir).filter((f) => f.endsWith('.png')).sort()
    const texts: string[] = []
    for (const pageFile of pageFiles) {
      try {
        const text = execFileSync(TESSERACT_PATH, [join(tempDir, pageFile), 'stdout', '-l', 'eng', '--psm', '3'], {
          encoding: 'utf-8',
          timeout: 120000,
        })
        texts.push(text)
      } catch {
        texts.push('')
      }
    }
    return texts.join('\n\n')
  } finally {
    try {
      for (const f of readdirSync(tempDir)) unlinkSync(join(tempDir, f))
      rmdirSync(tempDir)
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Pass 2: OCR via pdftoppm + tesseract
// ---------------------------------------------------------------------------

function ocrExtract(pdfPath: string): string {
  if (!TESSERACT_PATH || !PDFTOPPM_PATH) {
    throw new Error('tesseract and pdftoppm required for OCR. Install with: brew install tesseract poppler')
  }

  const tempDir = join(tmpdir(), `rmbl-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    // Render pages to PNG at 300 DPI
    execFileSync(PDFTOPPM_PATH, ['-png', '-r', '300', pdfPath, join(tempDir, 'page')], {
      timeout: 300000,
    })

    const pageFiles = readdirSync(tempDir).filter((f) => f.endsWith('.png')).sort()
    if (pageFiles.length === 0) {
      throw new Error('pdftoppm produced no page images')
    }

    const texts: string[] = []
    for (const pageFile of pageFiles) {
      try {
        const text = execFileSync(TESSERACT_PATH, [join(tempDir, pageFile), 'stdout', '-l', 'eng', '--psm', '3'], {
          encoding: 'utf-8',
          timeout: 120000,
        })
        texts.push(text)
      } catch {
        texts.push('')
      }
    }

    return texts.join('\n\n')
  } finally {
    try {
      for (const f of readdirSync(tempDir)) unlinkSync(join(tempDir, f))
      rmdirSync(tempDir)
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function extractText(pdfPath: string): Promise<ExtractionResult> {
  const pageCount = getPageCount(pdfPath)

  // Pass 1: Try digital extraction
  let digitalText = ''
  try {
    digitalText = extractDigital(pdfPath)
  } catch {
    // pdftotext failed — try OCR
    if (TESSERACT_PATH && PDFTOPPM_PATH) {
      try {
        const ocrText = ocrExtract(pdfPath)
        const score = scoreText(ocrText, pageCount)
        return {
          text: ocrText,
          method: 'ocr',
          pageCount,
          qualityScore: score,
          needsReview: score < 0.5,
          reviewReason: score < 0.5 ? 'Low OCR quality' : null,
        }
      } catch (ocrErr: any) {
        return { text: '', method: 'ocr', pageCount, qualityScore: 0, needsReview: true, reviewReason: `Both extraction methods failed: ${ocrErr.message}` }
      }
    }
    return { text: '', method: 'digital', pageCount, qualityScore: 0, needsReview: true, reviewReason: 'Digital extraction failed, OCR tools not available' }
  }

  // Assess quality of digital extraction
  const quality = assessDigitalQuality(digitalText, pageCount)

  if (quality.ok && pageCount > 2) {
    // Check for cover-page-only pattern: multi-page PDF where text is
    // concentrated in the first 1-2 pages (common with JSTOR scans)
    const perPage = extractDigitalPerPage(pdfPath, Math.min(pageCount, 5))
    const pageLengths = perPage.map((p) => p.trim().length)
    const firstPageLen = pageLengths[0] || 0
    const laterPagesAvg = pageLengths.slice(1).reduce((a, b) => a + b, 0) / Math.max(pageLengths.length - 1, 1)

    if (firstPageLen > 200 && laterPagesAvg < 100 && pageCount > 3) {
      // Cover-page-only: first page has text, rest are scanned
      // Use digital text for cover page, OCR for the rest
      if (TESSERACT_PATH && PDFTOPPM_PATH) {
        try {
          const ocrText = ocrPageRange(pdfPath, 2, pageCount)
          const combined = digitalText + '\n\n' + ocrText
          const score = scoreText(combined, pageCount)
          return {
            text: combined,
            method: 'mixed',
            pageCount,
            qualityScore: score,
            needsReview: score < 0.5,
            reviewReason: score < 0.5 ? 'Mixed extraction (cover digital + body OCR), low quality' : null,
          }
        } catch {
          // OCR failed — fall through to digital-only
        }
      }
    }
  }

  if (quality.ok) {
    const score = scoreText(digitalText, pageCount)
    return {
      text: digitalText,
      method: 'digital',
      pageCount,
      qualityScore: score,
      needsReview: score < 0.5,
      reviewReason: score < 0.5 ? 'Low digital quality score' : null,
    }
  }

  // Digital quality poor overall — try full OCR
  if (TESSERACT_PATH && PDFTOPPM_PATH) {
    try {
      const ocrText = ocrExtract(pdfPath)
      const ocrScore = scoreText(ocrText, pageCount)
      const digitalScore = scoreText(digitalText, pageCount)

      if (ocrScore > digitalScore) {
        return {
          text: ocrText,
          method: 'ocr',
          pageCount,
          qualityScore: ocrScore,
          needsReview: ocrScore < 0.5,
          reviewReason: ocrScore < 0.5 ? `OCR quality low (digital was worse: ${quality.reason})` : null,
        }
      }
    } catch {
      // OCR failed — fall back to digital
    }
  }

  const score = scoreText(digitalText, pageCount)
  return {
    text: digitalText,
    method: 'digital',
    pageCount,
    qualityScore: score,
    needsReview: true,
    reviewReason: `Digital quality poor: ${quality.reason}`,
  }
}
