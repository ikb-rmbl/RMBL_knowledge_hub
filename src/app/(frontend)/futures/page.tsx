/**
 * Futures browse page — single-column scenario cards with sidebar filters,
 * matching the pattern used by /species, /frontiers, etc.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { getDb } from '../lib/db'
import {
  FUTURE_SETS,
  listSetsWithScenarios,
  type ScenarioSummary,
} from '@/services/futures'
import { BrowseDisclaimer } from './lib/Disclaimer'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Futures — RMBL Knowledge Commons',
  description:
    'Future scenarios and companion narratives for the RMBL Centennial Campaign — planning artifacts mapping a strategic decision space, with central, upside, and downside companion sets.',
}

type SortKey = 'tail' | 'name' | 'stories'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'tail', label: 'Central → Upside → Downside' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'stories', label: 'Most stories' },
]

const TAIL_LABELS: Record<string, string> = {
  central: 'Central',
  upside: 'Upside',
  downside: 'Downside',
}

const TAIL_COLORS: Record<string, string> = {
  central: 'var(--rmbl-sky)',
  upside: 'var(--rmbl-moss)',
  downside: 'var(--rmbl-aspen)',
}

function tailRank(tail: 'central' | 'upside' | 'downside'): number {
  return tail === 'central' ? 0 : tail === 'upside' ? 1 : 2
}

function buildUrl(
  current: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const merged: Record<string, string | undefined> = { ...current, ...overrides }
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(merged)) {
    if (v) qs.set(k, v)
  }
  const str = qs.toString()
  return str ? `/futures?${str}` : '/futures'
}

function ScenarioCard({ s }: { s: ScenarioSummary }) {
  const setName = FUTURE_SETS[s.set_id]?.name ?? s.set_id
  const tailLabel = TAIL_LABELS[s.set_tail]
  const tailColor = TAIL_COLORS[s.set_tail]
  return (
    <Link href={`/futures/${s.slug}`} className="result-card">
      <div className="result-card-header">
        <span
          className="badge"
          style={{
            background: 'transparent',
            border: `1px solid ${tailColor}`,
            color: tailColor,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: '10px',
            fontWeight: 600,
          }}
        >
          {tailLabel}
        </span>
        <h3 className="result-card-title">{s.name}</h3>
      </div>
      {s.bracket_position && (
        <p
          className="result-card-snippet"
          style={{ fontStyle: 'italic', color: 'var(--fg-2)' }}
        >
          {s.bracket_position}
        </p>
      )}
      {s.distinguishing_thesis && (
        <p
          className="result-card-snippet"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {s.distinguishing_thesis}
        </p>
      )}
      <div className="result-card-meta">
        <span>{setName}</span>
        {s.continuity_pct !== null && s.innovation_pct !== null && (
          <span>
            {s.continuity_pct}% continuity / {s.innovation_pct}% innovation
          </span>
        )}
        {s.frontier_portfolio.length > 0 && (
          <span>
            {s.frontier_portfolio.length} frontier
            {s.frontier_portfolio.length === 1 ? '' : 's'}
          </span>
        )}
        {s.story_count > 0 && (
          <span>
            {s.story_count} {s.story_count === 1 ? 'story' : 'stories'}
          </span>
        )}
      </div>
    </Link>
  )
}

export default async function FuturesBrowse({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const params = await searchParams
  const tailFilter = (params.tail || '') as '' | 'central' | 'upside' | 'downside'
  const setFilter = params.set || ''
  const sortKey = ((params.sort as SortKey) || 'tail') as SortKey

  // Flatten — service returns groups; we need a single list for sidebar+sort.
  const sets = await listSetsWithScenarios(getDb())
  const all: ScenarioSummary[] = sets.flatMap(({ scenarios }) => scenarios)

  // Counts for sidebar (before filtering).
  const countByTail: Record<string, number> = { central: 0, upside: 0, downside: 0 }
  const countBySet: Record<string, number> = {}
  for (const s of all) {
    countByTail[s.set_tail] = (countByTail[s.set_tail] || 0) + 1
    countBySet[s.set_id] = (countBySet[s.set_id] || 0) + 1
  }

  // Filter.
  let filtered = all
  if (tailFilter) filtered = filtered.filter((s) => s.set_tail === tailFilter)
  if (setFilter) filtered = filtered.filter((s) => s.set_id === setFilter)

  // Sort.
  filtered = [...filtered].sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name)
    if (sortKey === 'stories') return b.story_count - a.story_count
    // tail: central -> upside -> downside, then by name within tail
    const t = tailRank(a.set_tail) - tailRank(b.set_tail)
    if (t !== 0) return t
    return a.name.localeCompare(b.name)
  })

  const total = filtered.length
  const current = { tail: tailFilter || undefined, set: setFilter || undefined, sort: sortKey === 'tail' ? undefined : sortKey }
  const activeStyle = { fontWeight: 700 as const, color: 'var(--color-accent)' }
  const inactiveStyle = { fontWeight: 400 as const, color: 'inherit' }

  // Sets, in tail order, for the sidebar.
  const setEntries = Object.values(FUTURE_SETS).sort(
    (a, b) => tailRank(a.set_tail) - tailRank(b.set_tail),
  )

  return (
    <>
      <div className="search-results-header">
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px' }}>
          Futures
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--fg-2)', margin: '0 0 16px', maxWidth: '65ch' }}>
          Future scenarios and companion narratives mapping the strategic
          decision space for RMBL&apos;s 2027–2029 Centennial Campaign. Three
          sets: central case, upside companion, and downside companion. Each
          scenario has at least one literary narrative grounded in it.
        </p>

        <BrowseDisclaimer />

        <p className="results-count" style={{ marginTop: '12px' }}>
          {total.toLocaleString()} scenario{total === 1 ? '' : 's'}
          {tailFilter ? ` in ${TAIL_LABELS[tailFilter]}` : ''}
          {setFilter ? ` in ${FUTURE_SETS[setFilter]?.name ?? setFilter}` : ''}
        </p>
      </div>

      <div className="search-layout">
        <aside className="filters">
          <div className="filter-group">
            <h2 className="filter-label">Sort by</h2>
            {SORT_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <Link
                  href={buildUrl(current, { sort: opt.value === 'tail' ? undefined : opt.value })}
                  style={sortKey === opt.value ? activeStyle : inactiveStyle}
                >
                  {opt.label}
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h2 className="filter-label">Tail</h2>
            <label>
              <Link
                href={buildUrl(current, { tail: undefined })}
                style={!tailFilter ? activeStyle : inactiveStyle}
              >
                All ({all.length})
              </Link>
            </label>
            {(['central', 'upside', 'downside'] as const).map((t) => (
              <label key={t}>
                <Link
                  href={buildUrl(current, { tail: t })}
                  style={tailFilter === t ? activeStyle : inactiveStyle}
                >
                  {TAIL_LABELS[t]} ({countByTail[t] ?? 0})
                </Link>
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h2 className="filter-label">Set</h2>
            <label>
              <Link
                href={buildUrl(current, { set: undefined })}
                style={!setFilter ? activeStyle : inactiveStyle}
              >
                All
              </Link>
            </label>
            {setEntries.map((s) => (
              <label key={s.set_id}>
                <Link
                  href={buildUrl(current, { set: s.set_id })}
                  style={setFilter === s.set_id ? activeStyle : inactiveStyle}
                >
                  {s.name} ({countBySet[s.set_id] ?? 0})
                </Link>
              </label>
            ))}
          </div>
        </aside>

        <div className="result-cards">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--fg-2)', fontStyle: 'italic' }}>
              No scenarios match the current filter.
            </p>
          ) : (
            filtered.map((s) => <ScenarioCard key={s.slug} s={s} />)
          )}
        </div>
      </div>
    </>
  )
}
