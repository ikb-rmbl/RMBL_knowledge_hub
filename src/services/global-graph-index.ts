/**
 * Lazy-loaded index of node IDs present in the unified global graph.
 * Used by detail pages to decide whether to show a "View in full graph"
 * link — entities pruned by degree don't appear in the unified graph and
 * therefore can't be focused on it.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

let cached: Set<string> | null = null

function load(): Set<string> {
  if (cached) return cached
  const path = join(process.cwd(), 'public/graph/unified-node-index.json')
  if (!existsSync(path)) { cached = new Set(); return cached }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    cached = new Set<string>(data.nodes || [])
  } catch {
    cached = new Set()
  }
  return cached
}

export function inGlobalGraph(globalNodeId: string): boolean {
  return load().has(globalNodeId)
}
