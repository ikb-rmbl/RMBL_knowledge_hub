'use client'

import { useState } from 'react'

interface ExportItem {
  type: string
  id: number
}

export default function ExportButton({ items, totalCount, searchQuery, typeFilter }: { items: ExportItem[]; totalCount?: number; searchQuery?: string; typeFilter?: string }) {
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState(false)

  async function doExport(format: 'ris' | 'bibtex' | 'csl') {
    setExporting(true)
    setOpen(false)
    try {
      // Use search-based export when we have a query and more results than the current page
      const useSearchExport = searchQuery !== undefined && totalCount && totalCount > items.length
      const res = useSearchExport
        ? await fetch(`/api/v1/export-search?${new URLSearchParams({ q: searchQuery || '', format, ...(typeFilter ? { type: typeFilter } : {}) }).toString()}`)
        : await fetch('/api/v1/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: items, format }),
          })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const ext = format === 'ris' ? 'ris' : format === 'csl' ? 'json' : 'bib'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rmbl-export.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export error:', err)
    } finally {
      setExporting(false)
    }
  }

  if (items.length === 0) return null

  const label = 'export \u2193'

  const menuStyle = {
    display: 'block', width: '100%', textAlign: 'left' as const,
    padding: '8px 16px', fontSize: '13px', background: 'none',
    border: 'none', cursor: 'pointer', color: 'var(--fg-1)',
  }

  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        aria-expanded={open}
        style={{
          padding: '0',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--accent)',
          textDecoration: 'underline',
        }}
      >
        {exporting ? 'Exporting...' : label}
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: '4px',
          background: 'var(--bg)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          zIndex: 50,
          minWidth: '180px',
        }}>
          <button onClick={() => doExport('csl')} style={menuStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-inset)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
            CSL JSON (.json)
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--fg-3)' }}>Zotero, Pandoc, Mendeley</span>
          </button>
          <button onClick={() => doExport('ris')} style={menuStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-inset)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
            RIS (.ris)
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--fg-3)' }}>EndNote, RefWorks</span>
          </button>
          <button onClick={() => doExport('bibtex')} style={menuStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-inset)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
            BibTeX (.bib)
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--fg-3)' }}>LaTeX, Overleaf</span>
          </button>
        </div>
      )}
    </span>
  )
}
