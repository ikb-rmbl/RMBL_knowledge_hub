/**
 * Streamable HTTP MCP endpoint for the RMBL Knowledge Hub.
 *
 * Uses the Web Standard transport (Request/Response, not Node.js streams)
 * for compatibility with Next.js App Router and Vercel serverless.
 *
 * Stateless: each request creates a fresh server/transport instance.
 *
 * URL: https://rmblknowledgehub.org/api/mcp
 */

import { NextRequest, NextResponse } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from './server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const server = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // return JSON instead of SSE (required for serverless)
  })

  await server.connect(transport)

  try {
    const response = await transport.handleRequest(request)
    return response
  } catch (err: any) {
    console.error('MCP error:', err.message)
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
      { status: 500 },
    )
  } finally {
    await transport.close()
    await server.close()
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'rmbl-knowledge-hub',
    version: '0.2.0',
    description: 'RMBL Knowledge Hub MCP Server — search publications, explore research neighborhoods, access the knowledge graph',
    tools: 8,
    endpoint: 'POST /api/mcp',
    setup: 'Add https://rmblknowledgehub.org/api/mcp as a Custom Connector in Claude Desktop Settings',
  })
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 })
}
