# RMBL Knowledge Hub MCP Server

MCP (Model Context Protocol) server that gives AI assistants access to the RMBL Knowledge Hub — 5,267 publications, 1,381 documents, 1,216 datasets, and a 13,800-node knowledge graph from the Rocky Mountain Biological Laboratory.

## Tools

| Tool | Description |
|---|---|
| `search_rmbl` | Full-text search across all collections |
| `get_publication` | Publication detail with authors, abstract, entities |
| `get_dataset` | Dataset detail with creators and entities |
| `get_document` | Document detail with entities and stakeholders |
| `get_entity` | Entity detail (species, concept, protocol, place, stakeholder) |
| `find_related` | Related works via 4 signals (semantic, shared entities, coauthorship, citations) |
| `explore_neighborhood` | Research neighborhood detail + primer |
| `list_neighborhoods` | Browse/search 154 research neighborhoods |

## Setup for Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rmbl-knowledge-hub": {
      "command": "node",
      "args": ["/path/to/RMBL_knowledge_hub/mcp/dist/index.js"],
      "env": {
        "RMBL_API_URL": "https://rmblknowledgehub.org"
      }
    }
  }
}
```

Or if published to npm:

```json
{
  "mcpServers": {
    "rmbl-knowledge-hub": {
      "command": "npx",
      "args": ["-y", "@rmbl/knowledge-hub-mcp"],
      "env": {
        "RMBL_API_URL": "https://rmblknowledgehub.org"
      }
    }
  }
}
```

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
