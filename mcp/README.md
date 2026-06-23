# RMBL Knowledge Commons MCP Server

MCP (Model Context Protocol) server that gives AI assistants access to the RMBL Knowledge Commons — 4,852 publications, 1,769 documents (including 388 Federal Register notices), 1,426 datasets, 841 stories, and a 23K-node knowledge graph (species + places + concepts + protocols + stakeholders) from the Rocky Mountain Biological Laboratory.

## Tools

| Tool | Description |
|---|---|
| `search_rmbl` | Full-text search across all collections |
| `get_publication` | Publication detail with authors, abstract, entities, citations |
| `get_dataset` | Dataset detail with creators and entities |
| `get_document` | Document detail with entities and stakeholders |
| `get_entity` | Entity detail (species, concept, protocol, place, stakeholder) |
| `find_related` | Related works via 4 signals (semantic, shared entities, coauthorship, citations) |
| `explore_neighborhood` | Research neighborhood detail + primer |
| `list_neighborhoods` | Browse/search 146 research neighborhoods |
| `get_frontier` | Research frontier detail: key questions (with verbatim primary-paper cites), data gaps, currency state |
| `list_frontiers` | Browse paper-grounded research frontiers (sortable by breadth/leverage) |

## Setup for Claude Desktop

### Option A: Remote connector (recommended, no install)

1. Open Claude Desktop → **Settings → Connectors**
2. Click **Add custom connector**
3. Enter URL: `https://rmblknowledgecommons.org/api/mcp`
4. All 10 tools are immediately available

### Option B: Local server

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rmbl-knowledge-fabric": {
      "command": "node",
      "args": ["/path/to/RMBL_knowledge_hub/mcp/dist/index.js"],
      "env": {
        "RMBL_API_URL": "https://rmblknowledgecommons.org"
      }
    }
  }
}
```

## Compatibility

- **Claude Desktop**: Supported via remote connector (Streamable HTTP) or local server (stdio)
- **OpenAI/ChatGPT**: Not currently supported — requires old SSE transport with long-lived connections, incompatible with our serverless hosting. Use the REST API (`/api/v1/*`) with `?format=text` instead.
- **Other MCP clients**: Any client supporting Streamable HTTP transport can connect to `https://rmblknowledgecommons.org/api/mcp`

## Development

```bash
cd mcp
npm install
npm run build
npm start        # runs on stdio
```

For local development, set `RMBL_API_URL=http://localhost:3000` (the default).

## Architecture

The MCP server calls the REST API v1 (`/api/v1/*`) over HTTP with `format=text`. It does **not** connect to the database directly — users need only a base URL, no credentials.
