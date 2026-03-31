/**
 * Download paywalled PDFs via institutional access using Playwright.
 *
 * Uses a headless browser to handle publisher authentication flows,
 * bot detection, and cookie management. Downloads the PDF, extracts
 * text via pdftotext, then deletes the PDF (text-only retention).
 *
 * Must be run from a network with institutional access (campus IP or VPN).
 *
 * Usage:
 *   npx tsx scripts/download-institutional.ts [--limit=N] [--publisher=springer|jstor|wiley|elsevier|all] [--headed]
 */

import { chromium, type Browser, type BrowserContext } from 'playwright'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import {
  loadManifest,
  saveManifest,
  printStats,
  STAGING_DIR,
  type ManifestEntry,
} from './lib/pdf-manifest.js'

const args = process.argv.slice(2)
const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
const limit = limitArg ? parseInt(limitArg) : Infinity
const publisherFilter = args.find((a) => a.startsWith('--publisher='))?.split('=')[1] || 'all'
const headed = args.includes('--headed')

const DOWNLOAD_DIR = join(STAGING_DIR, 'institutional')
const PDFTOTEXT_PATH = '/opt/homebrew/bin/pdftotext'
const DELAY_BETWEEN_DOWNLOADS_MS = 3000 // be polite to publishers

// ---------------------------------------------------------------------------
// Publisher PDF URL patterns
// ---------------------------------------------------------------------------

interface PublisherConfig {
  name: string
  doiPrefix: string[]
  getPdfUrl: (doi: string) => string
}

const PUBLISHERS: PublisherConfig[] = [
  {
    name: 'springer',
    doiPrefix: ['10.1007'],
    getPdfUrl: (doi) => `https://link.springer.com/content/pdf/${doi}.pdf`,
  },
  {
    name: 'jstor',
    doiPrefix: ['10.2307'],
    getPdfUrl: (doi) => {
      // 10.2307/4137022 -> stable ID is the suffix
      const id = doi.replace('10.2307/', '')
      return `https://www.jstor.org/stable/pdf/${id}.pdf?acceptTC=1`
    },
  },
  {
    name: 'jstor-redirect',
    doiPrefix: ['10.1086'],
    getPdfUrl: (doi) => `https://www.jstor.org/stable/pdf/${doi}.pdf?acceptTC=1`,
  },
  {
    name: 'wiley',
    doiPrefix: ['10.1111', '10.1002', '10.1046', '10.1890'],
    getPdfUrl: (doi) => `https://onlinelibrary.wiley.com/doi/pdfdirect/${doi}`,
  },
  {
    name: 'elsevier',
    doiPrefix: ['10.1016'],
    getPdfUrl: (doi) => `https://doi.org/${doi}`,  // follow redirect to ScienceDirect, then find PDF
  },
  {
    name: 'taylor-francis',
    doiPrefix: ['10.1080'],
    getPdfUrl: (doi) => `https://www.tandfonline.com/doi/pdf/${doi}`,
  },
  {
    name: 'nrc',
    doiPrefix: ['10.1139'],
    getPdfUrl: (doi) => `https://cdnsciencepub.com/doi/pdf/${doi}`,
  },
  {
    name: 'science',
    doiPrefix: ['10.1126'],
    getPdfUrl: (doi) => `https://www.science.org/doi/pdf/${doi}`,
  },
  {
    name: 'oxford',
    doiPrefix: ['10.1093'],
    getPdfUrl: (doi) => `https://academic.oup.com/doi/pdf/${doi}`,
  },
  {
    name: 'nature',
    doiPrefix: ['10.1038'],
    getPdfUrl: (doi) => `https://www.nature.com/articles/${doi.replace('10.1038/', '')}.pdf`,
  },
  {
    name: 'annual-reviews',
    doiPrefix: ['10.1146'],
    getPdfUrl: (doi) => `https://www.annualreviews.org/doi/pdf/${doi}`,
  },
]

function getPublisher(doi: string): PublisherConfig | null {
  const prefix = doi.match(/^10\.\d+/)?.[0]
  if (!prefix) return null
  return PUBLISHERS.find((p) => p.doiPrefix.includes(prefix)) || null
}

// ---------------------------------------------------------------------------
// Playwright download
// ---------------------------------------------------------------------------

async function downloadPdfWithBrowser(
  context: BrowserContext,
  entry: ManifestEntry,
  publisher: PublisherConfig,
): Promise<{ text: string; pageCount: number } | null> {
  const page = await context.newPage()

  try {
    const pdfUrl = publisher.getPdfUrl(entry.id.replace('pub:', '').replace('doc:', ''))

    // For Elsevier, we need to navigate to the DOI page and find the PDF link
    if (publisher.name === 'elsevier') {
      return await downloadElsevier(page, entry)
    }

    // Navigate to PDF URL
    const response = await page.goto(pdfUrl, { waitUntil: 'load', timeout: 30000 })

    if (!response) return null

    const contentType = response.headers()['content-type'] || ''

    if (contentType.includes('pdf')) {
      // Direct PDF response — save and extract
      const body = await response.body()
      return saveTempAndExtract(body, entry)
    }

    // Some publishers show an HTML page with the PDF embedded or a download button
    // Wait a moment for any redirects
    await page.waitForTimeout(2000)

    // Try to find a PDF download link or embedded PDF
    const currentUrl = page.url()
    if (currentUrl.includes('.pdf')) {
      // We ended up at a PDF URL after redirects
      const res2 = await page.goto(currentUrl, { waitUntil: 'load', timeout: 30000 })
      if (res2) {
        const ct = res2.headers()['content-type'] || ''
        if (ct.includes('pdf')) {
          const body = await res2.body()
          return saveTempAndExtract(body, entry)
        }
      }
    }

    return null
  } catch (err: any) {
    entry.downloadError = err.message?.slice(0, 200) || String(err)
    return null
  } finally {
    await page.close()
  }
}

async function downloadElsevier(page: any, entry: ManifestEntry): Promise<{ text: string; pageCount: number } | null> {
  // Navigate to the DOI which redirects to ScienceDirect
  await page.goto(`https://doi.org/${entry.id.replace('pub:', '')}`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Look for the PDF download link
  const pdfLink = await page.$('a[href*="pdfft"], a[href*="/pdf/"], a.pdf-download')
  if (pdfLink) {
    const href = await pdfLink.getAttribute('href')
    if (href) {
      const fullUrl = href.startsWith('http') ? href : `https://www.sciencedirect.com${href}`
      const res = await page.goto(fullUrl, { waitUntil: 'load', timeout: 30000 })
      if (res) {
        const ct = res.headers()['content-type'] || ''
        if (ct.includes('pdf')) {
          const body = await res.body()
          return saveTempAndExtract(body, entry)
        }
      }
    }
  }
  return null
}

function saveTempAndExtract(pdfBytes: Buffer, entry: ManifestEntry): { text: string; pageCount: number } | null {
  mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const tempPath = join(DOWNLOAD_DIR, `${entry.id.replace(':', '_')}.pdf`)

  try {
    writeFileSync(tempPath, pdfBytes)

    // Verify it's a real PDF
    if (pdfBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return null
    }

    // Extract text
    const text = execFileSync(PDFTOTEXT_PATH, ['-layout', tempPath, '-'], {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    })

    // Get page count
    let pageCount = 0
    try {
      const info = execFileSync('/opt/homebrew/bin/pdfinfo', [tempPath], { encoding: 'utf-8', timeout: 10000 })
      const match = info.match(/Pages:\s+(\d+)/)
      if (match) pageCount = parseInt(match[1])
    } catch {}

    return { text, pageCount }
  } finally {
    // Delete the PDF — we only keep the text
    try { unlinkSync(tempPath) } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Institutional PDF Download (Playwright)')
  console.log('========================================')
  console.log(`Mode: ${headed ? 'headed (visible browser)' : 'headless'}`)

  const pubs: any[] = JSON.parse(readFileSync(join(STAGING_DIR, '..', 'publications-normalized.json'), 'utf-8'))
  const manifest = loadManifest()

  // Find publications with DOI, no PDF, closed/green access
  let candidates = pubs.filter((p: any) => {
    const doi = p.doi
    if (!doi || p.pdfLink) return false
    const publisher = getPublisher(doi)
    if (!publisher) return false
    if (publisherFilter !== 'all' && publisher.name !== publisherFilter && !publisher.name.startsWith(publisherFilter)) return false
    return true
  })

  console.log(`\nFound ${candidates.length} publications accessible via institutional download`)

  // Group by publisher
  const byPublisher = new Map<string, any[]>()
  for (const p of candidates) {
    const pub = getPublisher(p.doi)!
    const name = pub.name
    if (!byPublisher.has(name)) byPublisher.set(name, [])
    byPublisher.get(name)!.push(p)
  }
  for (const [name, pubs] of [...byPublisher.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${name}: ${pubs.length}`)
  }

  if (limit < candidates.length) {
    candidates = candidates.slice(0, limit)
    console.log(`\nLimited to ${limit}`)
  }

  if (candidates.length === 0) {
    console.log('Nothing to download.')
    return
  }

  // Launch browser
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  mkdirSync(DOWNLOAD_DIR, { recursive: true })

  let success = 0
  let failed = 0
  const textDir = join(STAGING_DIR, 'publications')
  mkdirSync(textDir, { recursive: true })

  for (let i = 0; i < candidates.length; i++) {
    const pub = candidates[i]
    const publisher = getPublisher(pub.doi)!
    const manifestId = `pub:${pub._sourceId}`
    const entry = manifest.get(manifestId)
    if (!entry) continue

    process.stdout.write(`\r  ${i + 1}/${candidates.length} [${publisher.name}] ${pub.title.slice(0, 50)}...`)

    const result = await downloadPdfWithBrowser(context, { ...entry, id: manifestId, _doi: pub.doi } as any, publisher)

    if (result && result.text.trim().length > 100) {
      // Save extracted text
      const textPath = join(textDir, `pub_${pub._sourceId}.txt`)
      writeFileSync(textPath, result.text)

      entry.extractionMethod = 'digital'
      entry.extractionStatus = 'extracted'
      entry.textLength = result.text.length
      entry.downloadStatus = 'downloaded'
      entry.downloadError = null
      entry.qualityScore = 1.0
      entry.needsReview = false
      entry.lastUpdated = new Date().toISOString()
      success++
    } else {
      entry.downloadError = entry.downloadError || 'Could not download or extract PDF'
      failed++
    }

    // Save manifest periodically
    if ((i + 1) % 10 === 0) saveManifest(manifest)

    // Polite delay
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_DOWNLOADS_MS))
  }

  console.log()
  await context.close()
  await browser.close()

  saveManifest(manifest)

  console.log(`\nComplete: ${success} extracted, ${failed} failed`)
  printStats(manifest)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
