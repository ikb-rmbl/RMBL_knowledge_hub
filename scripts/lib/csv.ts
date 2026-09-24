/**
 * RFC 4180 CSV parsing.
 *
 * The ad-hoc parsers in seed-places-gnis.ts and ingest-manual-pdfs.ts split on
 * newlines before splitting on commas, which corrupts any quoted field that
 * wraps — research-plan abstracts routinely do. This one is a single pass over
 * the characters, so embedded newlines, commas and doubled quotes survive.
 *
 * Salesforce exports (the research-plan list) are Windows-1252, not UTF-8:
 * readCsvFile decodes that way so em dashes, degree signs and accented names
 * come through as themselves rather than U+FFFD.
 */

import { readFileSync } from 'fs'

export function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // CRLF: the \n does the work
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim())
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => {
      const o: Record<string, string> = {}
      header.forEach((h, i) => {
        o[h] = (r[i] ?? '').trim()
      })
      return o
    })
}

export function readCsvFile(
  path: string,
  encoding: 'utf-8' | 'windows-1252' = 'utf-8',
): Record<string, string>[] {
  return parseCsv(new TextDecoder(encoding).decode(readFileSync(path)))
}
