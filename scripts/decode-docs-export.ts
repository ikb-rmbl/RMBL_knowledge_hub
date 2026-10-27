/**
 * Write a Claude Docs export to a file.
 *
 * The Claude Docs connector's `export` tool returns the file base64-encoded in
 * JSON ({"data":{"bytes_b64":…,"bytes":…}}); large exports are saved to a text
 * file by the tool harness. This decodes that JSON into the real file, checks
 * the byte count, and refuses anything that isn't a valid export.
 *
 * Used to refresh docs/RMBL-Knowledge-Commons-Manual.docx from the living doc
 * (see "Knowledge Commons manual" in CLAUDE.md).
 *
 * Usage:
 *   npx tsx scripts/decode-docs-export.ts <export.json|.txt> <out-file>
 */

import { readFileSync, writeFileSync } from 'fs'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('Usage: npx tsx scripts/decode-docs-export.ts <export.json|.txt> <out-file>')
  process.exit(1)
}
const parsed = JSON.parse(readFileSync(input, 'utf-8'))
const data = parsed?.data
if (parsed?.verdict !== 'allow' || typeof data?.bytes_b64 !== 'string') {
  console.error(`Not a Claude Docs export (verdict ${parsed?.verdict ?? 'missing'})`)
  process.exit(1)
}
const bytes = Buffer.from(data.bytes_b64, 'base64')
if (typeof data.bytes === 'number' && bytes.length !== data.bytes) {
  console.error(`Size mismatch: decoded ${bytes.length} bytes, export says ${data.bytes}`)
  process.exit(1)
}
writeFileSync(output, bytes)
console.log(`Wrote ${output} (${bytes.length} bytes, ${data.format ?? 'unknown format'}, doc rev ${parsed.rev ?? '?'})`)
