/**
 * Server-side graph data fetching — delegates to the graph service.
 */

import { getDb } from './db'
import {
  fetchNeighborhood as _fetchNeighborhood,
  fetchItemNetwork as _fetchItemNetwork,
  fetchAuthorNetwork as _fetchAuthorNetwork,
} from '@/services/graph'

export type { GraphNode, GraphEdge, NeighborhoodData } from '@/services/graph'

export function fetchNeighborhood(entityType: string, entityId: number, limit?: number) {
  return _fetchNeighborhood(getDb(), entityType, entityId, limit)
}

export function fetchItemNetwork(collection: string, itemId: number, itemTitle: string, limit?: number) {
  return _fetchItemNetwork(getDb(), collection, itemId, itemTitle, limit)
}

export function fetchAuthorNetwork(authorId: number, authorName: string, limit?: number) {
  return _fetchAuthorNetwork(getDb(), authorId, authorName, limit)
}
