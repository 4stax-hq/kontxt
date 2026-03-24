# mnemix

A local-first memory layer for AI tools. Stores, indexes, and retrieves context across sessions and across different AI clients via the Model Context Protocol (MCP).

---

## What it does

AI tools have no memory between sessions and no shared context across tools. mnemix maintains a persistent, semantically-searchable vault of memories on your machine. Any MCP-compatible AI client (Cursor, Claude Desktop, etc.) can read from and write to this vault during a conversation.

When a prompt comes in, the connected AI client calls mnemix to retrieve the most relevant memories for that specific query — not everything, just what scores highest by semantic similarity, recency, and access frequency. This keeps context injection small and precise rather than dumping your entire history into every prompt.

---

## Architecture

```
~/.mnemix/vault.db        SQLite database, lives on your machine
       │
       ├── memories        table: content, embeddings, type, tags, project, scores
       └── config.json     API key, settings

packages/
├── core/                  shared TypeScript types (Memory, MemoryType, etc.)
├── cli/                   command-line interface + vault read/write logic
│   └── src/
│       ├── commands/      init, add, search, list
│       └── vault/
│           ├── db.ts      SQLite operations via better-sqlite3
│           └── embed.ts   embedding via OpenAI or local pseudo-fallback
└── mcp-server/            MCP server exposing vault as tools to AI clients
    └── src/
        ├── server.ts      MCP server entry point
        └── vault/         copy of vault logic (db.ts, embed.ts)
```

---

## Requirements

- Node.js >= 18
- pnpm
- OpenAI API key (optional — falls back to local pseudo-embeddings without one)

---

## Install

```bash
git clone https://github.com/YOUR_USERNAME/mnemix.git
cd mnemix
pnpm install
pnpm build
```

If `better-sqlite3` fails to load (native module error):

```bash
cd node_modules/.pnpm/better-sqlite3@9.6.0/node_modules/better-sqlite3
npm run build-release
cd -
```

---

## CLI usage

```bash
# Initialize vault at ~/.mnemix/vault.db
node packages/cli/dist/index.js init

# With OpenAI key for semantic embeddings
node packages/cli/dist/index.js init --key sk-...

# Add a memory
node packages/cli/dist/index.js add "I prefer JWT with 7-day expiry for auth"
node packages/cli/dist/index.js add "this project uses Supabase" --type project --project mnemix
node packages/cli/dist/index.js add "I know FastAPI, React, ROS2" --type skill

# Semantic search
node packages/cli/dist/index.js search "auth preferences"
node packages/cli/dist/index.js search "what stack am I using" --limit 3

# List all memories
node packages/cli/dist/index.js list
node packages/cli/dist/index.js list --project mnemix
```

Memory types: `fact` `preference` `project` `decision` `skill` `episodic`

---

## MCP server

The MCP server exposes three tools to connected AI clients:

| Tool | Description |
|------|-------------|
| `get_relevant_context` | Semantic search over vault for a given query. Returns top-k scored memories. |
| `store_memory` | Writes a new memory to the vault from inside a conversation. |
| `get_user_profile` | Returns all memories grouped by type — skills, preferences, projects, etc. |

Start it manually:

```bash
node packages/mcp-server/dist/server.js
```

Or let your AI client start it automatically via config (see below).

---

## Connecting to Cursor

Add to `.cursor/mcp.json` in your project, or globally at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mnemix": {
      "command": "node",
      "args": ["/absolute/path/to/mnemix/packages/mcp-server/dist/server.js"]
    }
  }
}
```

Restart Cursor. The three mnemix tools will be available to the AI in every conversation.

---

## Connecting to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mnemix": {
      "command": "node",
      "args": ["/absolute/path/to/mnemix/packages/mcp-server/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop.

---

## Relevance scoring

When `get_relevant_context` is called, each memory is scored as:

```
score = (semantic_similarity * 0.50)
      + (recency_decay       * 0.20)
      + (access_frequency    * 0.15)
      + (importance_score    * 0.15)
```

`recency_decay` uses an exponential decay over 30 days. `access_frequency` is log-scaled. Only the top-k results are returned and injected into context.

Without an OpenAI key, embeddings fall back to a deterministic character-frequency vector. Ranking still works but semantic similarity is weaker.

---

## Data

Everything is local. The vault is a single SQLite file at `~/.mnemix/vault.db`. No data leaves your machine unless you explicitly add an OpenAI API key (used only for embedding calls to `text-embedding-3-small`).

No cloud sync, no accounts, no telemetry in v0.1.

---

## Roadmap

- [x] v0.1 — local vault, CLI, MCP server, relevance scoring
<!-- - [ ] v0.2 — browser extension for passive capture from claude.ai / ChatGPT
- [ ] v0.3 — React dashboard (visualize vault, edit/delete memories, see what gets injected)
- [ ] v0.4 — optional cloud sync via Supabase (opt-in, user-controlled)
- [ ] v1.0 — data marketplace (opt-in sharing of anonymized memory segments) -->

---

## Contributing

PRs welcome. The core logic is in `packages/cli/src/vault/` — `db.ts` for storage and `embed.ts` for scoring. The MCP server in `packages/mcp-server/src/server.ts` is the integration layer.

---

## License

MIT