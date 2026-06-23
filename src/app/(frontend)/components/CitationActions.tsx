/**
 * Inline citation actions for a single source detail page (publication,
 * dataset, or document). Two affordances rendered side by side:
 *
 *   - "Copy citation"  — writes a plain-text APA-style citation to the
 *                        clipboard. The citation is pre-formatted on the
 *                        server (see citation-format.ts) and passed in
 *                        as a prop so we don't need a round trip.
 *
 *   - "Export ▾"       — collapsible menu that downloads a single-item
 *                        bibliography record (RIS / BibTeX / CSL-JSON)
 *                        via the existing /api/v1/export POST endpoint.
 *
 * Visually paired with `FlagButton` — same plain-text-link aesthetic, so
 * the three sit cleanly as a row beneath the page title.
 */

'use client'

import { useEffect, useRef, useState } from 'react'

type Source = 'publication' | 'dataset' | 'document'

const TRIGGER_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '12px',
  color: 'var(--fg-3)',
  textDecoration: 'underline',
  padding: 0,
  font: 'inherit',
}

const MENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 30,
  margin: 0,
  padding: '4px 0',
  listStyle: 'none',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: '4px',
  boxShadow: 'var(--shadow-2)',
  minWidth: '180px',
  fontSize: '12px',
}

const MENU_ITEM_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  padding: '6px 12px',
  cursor: 'pointer',
  color: 'var(--fg-1)',
  fontSize: '12px',
  font: 'inherit',
}

interface CitationActionsProps {
  source: Source
  itemId: number
  /** Server-formatted APA-style citation. Pre-computed so the copy
   *  action is instant (no fetch). */
  citationText: string
}

export default function CitationActions({ source, itemId, citationText }: CitationActionsProps) {
  const [copied, setCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  // Click-outside closes the export menu.
  useEffect(() => {
    if (!exportOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  async function copyCitation() {
    try {
      await navigator.clipboard.writeText(citationText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail in restricted contexts. Fall back to a
      // hidden textarea + execCommand. Quiet on failure — the user can
      // still grab the citation from the URL on the page.
      const ta = document.createElement('textarea')
      ta.value = citationText
      ta.setAttribute('readonly', '')
      ta.style.position = 'absolute'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* nothing */ }
      document.body.removeChild(ta)
    }
  }

  async function downloadExport(format: 'ris' | 'bibtex' | 'csl') {
    setExportOpen(false)
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch('/api/v1/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [{ type: source, id: itemId }], format }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const ext = format === 'ris' ? 'ris' : format === 'csl' ? 'json' : 'bib'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rmbl-${source}-${itemId}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <span ref={wrapperRef} style={{ display: 'inline-flex', gap: '14px', alignItems: 'center', position: 'relative' }}>
      <button
        type="button"
        onClick={copyCitation}
        style={TRIGGER_STYLE}
        aria-live="polite"
      >
        {copied ? '✓ Citation copied' : 'Copy citation'}
      </button>
      <span style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setExportOpen(o => !o)}
          aria-expanded={exportOpen}
          aria-haspopup="menu"
          disabled={exporting}
          style={TRIGGER_STYLE}
        >
          {exporting ? 'Exporting…' : 'Export bibliography record ▾'}
        </button>
        {exportOpen && (
          <ul role="menu" style={MENU_STYLE}>
            <li role="none">
              <button type="button" role="menuitem" style={MENU_ITEM_STYLE} onClick={() => downloadExport('ris')}>
                RIS (.ris) <span style={{ color: 'var(--fg-3)', fontSize: '11px' }}>— EndNote, Zotero</span>
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" style={MENU_ITEM_STYLE} onClick={() => downloadExport('bibtex')}>
                BibTeX (.bib) <span style={{ color: 'var(--fg-3)', fontSize: '11px' }}>— LaTeX</span>
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" style={MENU_ITEM_STYLE} onClick={() => downloadExport('csl')}>
                CSL-JSON (.json) <span style={{ color: 'var(--fg-3)', fontSize: '11px' }}>— Zotero, Pandoc</span>
              </button>
            </li>
          </ul>
        )}
      </span>
    </span>
  )
}
