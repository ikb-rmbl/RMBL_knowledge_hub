/**
 * Backfill PDF sizes for documents missing Content-Length data.
 * Reads/writes the same sustainable-library.json file in place.
 */

import { writeFileSync, readFileSync } from 'fs'

const OUTPUT_PATH = new URL('./output/sustainable-library.json', import.meta.url).pathname
const CONCURRENCY = 5
const DELAY_MS = 100

interface Doc {
  pdfUrl: string | null
  pdfSizeBytes: number | null
  [key: string]: unknown
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const documents: Doc[] = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'))

  const needSize = documents.filter(
    (d) => d.pdfSizeBytes === null && d.pdfUrl?.includes('wp-content/uploads'),
  )
  console.log(`${needSize.length} PDFs need size backfill`)

  let completed = 0
  let errors = 0

  async function worker(queue: Doc[]) {
    while (queue.length > 0) {
      const doc = queue.shift()!
      try {
        const res = await fetch(doc.pdfUrl!, { method: 'HEAD' })
        const cl = res.headers.get('content-length')
        if (cl) {
          doc.pdfSizeBytes = parseInt(cl, 10)
        } else {
          errors++
        }
      } catch {
        errors++
      }
      completed++
      if (completed % 50 === 0 || completed === needSize.length) {
        process.stdout.write(`\r  ${completed}/${needSize.length} (${errors} errors)`)
      }
      await sleep(DELAY_MS)
    }
  }

  const queue = [...needSize]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)),
  )
  console.log()

  // Stats
  const allWithSize = documents.filter((d) => d.pdfSizeBytes !== null)
  const sizes = allWithSize.map((d) => d.pdfSizeBytes!)
  const totalBytes = sizes.reduce((a, b) => a + b, 0)

  const fmt = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
    return `${(bytes / 1e3).toFixed(1)} KB`
  }

  console.log(`\nPDF Archive Size (${allWithSize.length}/${documents.length} measured):`)
  console.log(`  Total:    ${fmt(totalBytes)}`)
  console.log(`  Average:  ${fmt(totalBytes / allWithSize.length)}`)
  console.log(`  Largest:  ${fmt(Math.max(...sizes))}`)
  console.log(`  Smallest: ${fmt(Math.min(...sizes))}`)

  writeFileSync(OUTPUT_PATH, JSON.stringify(documents, null, 2))
  console.log(`\nUpdated ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
