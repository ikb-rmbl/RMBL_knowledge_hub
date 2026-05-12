#!/usr/bin/env node
/**
 * RMBL Knowledge Fabric MCP Server
 *
 * Provides AI assistants with tools to search publications, explore
 * research neighborhoods, look up entities, and find related works
 * in the RMBL Knowledge Fabric.
 *
 * Communicates via stdio transport. Calls the REST API v1 over HTTP
 * so users need only a base URL, no database credentials.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { RMBLClient } from './client.js'

const client = new RMBLClient()

const server = new McpServer({
  name: 'rmbl-knowledge-fabric',
  version: '0.1.0',
})

// --- Tools ---

server.tool(
  'search_rmbl',
  'Search the RMBL Knowledge Fabric for publications, datasets, and documents. Returns ranked results with relevance scores.',
  {
    query: z.string().describe('Search query (e.g., "marmot hibernation", "alpine pollination")'),
    type: z.enum(['', 'publications', 'datasets', 'documents']).optional().describe('Filter by collection type'),
    limit: z.number().min(1).max(50).optional().describe('Max results to return (default 20)'),
  },
  async ({ query, type, limit }) => {
    const text = await client.search(query, type, limit)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'get_publication',
  'Get full details of a publication including title, authors, abstract, journal, DOI, citation count, and linked entities (species, concepts, protocols, places).',
  {
    id: z.number().describe('Publication ID'),
  },
  async ({ id }) => {
    const text = await client.getPublication(id)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'get_dataset',
  'Get details of a research dataset including title, repository, DOI, description, creators, and linked entities.',
  {
    id: z.number().describe('Dataset ID'),
  },
  async ({ id }) => {
    const text = await client.getDataset(id)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'get_document',
  'Get details of a community/policy document including title, type, summary, and linked entities and stakeholders.',
  {
    id: z.number().describe('Document ID'),
  },
  async ({ id }) => {
    const text = await client.getDocument(id)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'get_entity',
  'Look up a knowledge graph entity (species, concept, protocol, place, or stakeholder) with its details and the publications/documents that mention it.',
  {
    type: z.enum(['species', 'concept', 'protocol', 'place', 'stakeholder']).describe('Entity type'),
    id: z.number().describe('Entity ID'),
  },
  async ({ type, id }) => {
    const text = await client.getEntity(type, id)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'find_related',
  'Find works related to a given publication, dataset, or document. Uses 4 signals: semantic similarity, shared entities, co-authorship, and citations.',
  {
    collection: z.enum(['publications', 'datasets', 'documents']).describe('Collection of the source item'),
    id: z.number().describe('Item ID'),
  },
  async ({ collection, id }) => {
    const text = await client.getRelated(collection, id)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'explore_neighborhood',
  'Get details of a research neighborhood (community) including its research primer, member entities, and thematic summary. There are 154 neighborhoods covering topics from marmot ecology to water policy.',
  {
    id: z.number().describe('Neighborhood ID'),
  },
  async ({ id }) => {
    const text = await client.getNeighborhood(id)
    return { content: [{ type: 'text', text }] }
  },
)

server.tool(
  'list_neighborhoods',
  'Browse or search the 154 research neighborhoods in the RMBL Knowledge Fabric. Each neighborhood represents a research community detected by analyzing the knowledge graph.',
  {
    query: z.string().optional().describe('Optional search query to filter neighborhoods'),
  },
  async ({ query }) => {
    const text = await client.listNeighborhoods(query)
    return { content: [{ type: 'text', text }] }
  },
)

// --- Start ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('RMBL Knowledge Fabric MCP server running on stdio')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
