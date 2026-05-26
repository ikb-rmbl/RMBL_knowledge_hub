/**
 * Shared MCP server definition for the RMBL Knowledge Commons.
 *
 * Defines tools that call the REST API v1 internally.
 * Used by both the Streamable HTTP route handler and the standalone stdio server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

function getBaseUrl(): string {
  if (process.env.RMBL_API_URL) return process.env.RMBL_API_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

async function fetchText(path: string, params: Record<string, string | number | undefined> = {}): Promise<string> {
  const url = new URL(path, getBaseUrl())
  url.searchParams.set('format', 'text')
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), { redirect: 'follow' })
  if (!res.ok) throw new Error(`API error ${res.status}: ${url.pathname}`)
  return await res.text()
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'rmbl-knowledge-commons',
    version: '0.3.0',
  })

  server.tool(
    'search_rmbl',
    'Search the RMBL Knowledge Commons for publications, datasets, documents, and stories.',
    {
      query: z.string().describe('Search query'),
      type: z.enum(['', 'publications', 'datasets', 'documents', 'stories']).optional().describe('Filter by collection type'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default 20)'),
    },
    async ({ query, type, limit }) => ({
      content: [{ type: 'text' as const, text: await fetchText('/api/v1/search', { q: query, type, limit }) }],
    }),
  )

  server.tool(
    'get_publication',
    'Get full details of a publication including authors, abstract, entities, and citations.',
    { id: z.number().describe('Publication ID') },
    async ({ id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/publications/${id}`) }],
    }),
  )

  server.tool(
    'get_dataset',
    'Get details of a research dataset including creators and entities.',
    { id: z.number().describe('Dataset ID') },
    async ({ id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/datasets/${id}`) }],
    }),
  )

  server.tool(
    'get_document',
    'Get details of a community/policy document including entities and stakeholders.',
    { id: z.number().describe('Document ID') },
    async ({ id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/documents/${id}`) }],
    }),
  )

  server.tool(
    'get_entity',
    'Look up a knowledge graph entity with its details and mentions.',
    {
      type: z.enum(['species', 'concept', 'protocol', 'place', 'stakeholder']).describe('Entity type'),
      id: z.number().describe('Entity ID'),
    },
    async ({ type, id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/entities/${type}/${id}`) }],
    }),
  )

  server.tool(
    'find_related',
    'Find works related to a publication, dataset, or document via semantic similarity, shared entities, co-authorship, and citations.',
    {
      collection: z.enum(['publications', 'datasets', 'documents']).describe('Collection of the source item'),
      id: z.number().describe('Item ID'),
    },
    async ({ collection, id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/related/${collection}/${id}`) }],
    }),
  )

  server.tool(
    'explore_neighborhood',
    'Get details of a research neighborhood including its research primer and member entities.',
    { id: z.number().describe('Neighborhood ID') },
    async ({ id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/neighborhoods/${id}`) }],
    }),
  )

  server.tool(
    'list_neighborhoods',
    'Browse or search the research neighborhoods in the RMBL Knowledge Commons.',
    { query: z.string().optional().describe('Optional search query') },
    async ({ query }) => ({
      content: [{ type: 'text' as const, text: await fetchText('/api/v1/neighborhoods', { q: query }) }],
    }),
  )

  server.tool(
    'list_frontiers',
    'Browse or search research frontiers — synthesized boundaries between what scientists know and don\'t know in the RMBL knowledge graph, with key questions and concrete actions for pushing each boundary forward.',
    {
      query: z.string().optional().describe('Optional search query (matches title, summary, description)'),
      sort: z.enum(['breadth', 'leverage', 'size', 'title']).optional().describe('breadth = most cross-cutting first (default); leverage = highest management relevance; size = largest source cluster; title = A-Z'),
    },
    async ({ query, sort }) => ({
      content: [{ type: 'text' as const, text: await fetchText('/api/v1/frontiers', { q: query, sort }) }],
    }),
  )

  server.tool(
    'get_frontier',
    'Get full details of a research frontier including its narrative (context, frontier description, barriers, opportunities), key questions, concrete actions ("Pushing the frontier"), data gaps, contributing neighborhoods, linked entities, and source statements.',
    { id: z.number().describe('Frontier ID') },
    async ({ id }) => ({
      content: [{ type: 'text' as const, text: await fetchText(`/api/v1/frontiers/${id}`) }],
    }),
  )

  return server
}
