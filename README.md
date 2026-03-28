# kontxt

A local-first memory layer for AI tools. Persistent, semantically-searchable context across sessions and providers via MCP.

---

## What it does

AI tools have no memory between sessions. kontxt maintains a persistent vault on your machine. Any MCP-compatible client reads from and writes to it during conversation — injecting only the most relevant memories, not everything.

```
You: "help me fix this auth bug"
kontxt: [injects] "prefers JWT with 7-day expiry" + "uses Supabase" + "FastAPI backend"
AI:   already knows your stack.
```

---

## Architecture

```
~/.kontxt/vault.db         SQLite database, lives on your machine
       │
       ├── memories         content, embeddings, type, tags, project, scores
       └── config.json      API key, settings

packages/
├── core/                   shared TypeScript types
├── cli/                    command-line interface + vault logic
│   └── src/
│       ├── commands/       init, add, search, list, edit, delete
│       └── vault/
│           ├── db.ts       SQLite via better-sqlite3
│           └── embed.ts    embeddings + scoring
└── mcp-server/
    └── src/
        ├── server.ts       MCP server entry point
        └── vault/          db.ts, embed.ts
```

---

## Requirements

- Node.js >= 18
- pnpm
- OpenAI API key (optional — falls back to local pseudo-embeddings)

---

## Install

```bash
git clone https://github.com/4stax-hq/kontxt.git
cd kontxt
pnpm install
pnpm build
```

If `better-sqlite3` fails:

```bash
cd node_modules/.pnpm/better-sqlite3@9.6.0/node_modules/better-sqlite3
npm run build-release
cd -
```

---

## CLI

```bash
# Initialize vault
node packages/cli/dist/index.js init
node packages/cli/dist/index.js init --key sk-...

# Add memories
node packages/cli/dist/index.js add "I prefer JWT with 7-day expiry"
node packages/cli/dist/index.js add "this project uses Supabase" --type project --project my-app
node packages/cli/dist/index.js add "I know FastAPI, React, TypeScript" --type skill

# Search
node packages/cli/dist/index.js search "auth preferences"
node packages/cli/dist/index.js search "what stack am I using" --limit 3

# Manage
node packages/cli/dist/index.js list
node packages/cli/dist/index.js list --project my-app
node packages/cli/dist/index.js edit <id>
node packages/cli/dist/index.js delete <id>
```

**Memory types:** `fact` `preference` `project` `decision` `skill` `episodic`

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_relevant_context` | Semantic search, returns top-k scored memories |
| `store_memory` | Write a memory from inside a conversation |
| `store_conversation_summary` | Summarize and store a full conversation |
| `get_user_profile` | All memories grouped by type |
| `auto_capture` | Passively detect and store significant context |

```bash
node packages/mcp-server/dist/server.js
```

---

## Connecting to Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kontxt": {
      "command": "node",
      "args": ["/absolute/path/to/kontxt/packages/mcp-server/dist/server.js"]
    }
  }
}
```

## Connecting to Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kontxt": {
      "command": "node",
      "args": ["/absolute/path/to/kontxt/packages/mcp-server/dist/server.js"]
    }
  }
}
```

---

## Relevance Scoring

```
score = (semantic_similarity * 0.50)
      + (recency_decay       * 0.20)
      + (access_frequency    * 0.15)
      + (importance_score    * 0.15)
```

Recency uses exponential decay over 30 days. Frequency is log-scaled.

---

## Data

Everything stays local. Single SQLite file at `~/.kontxt/vault.db`. No telemetry. No accounts. OpenAI key only used for `text-embedding-3-small` calls if provided.

---

## Roadmap

- [x] v0.1 — local vault, CLI, MCP server, relevance scoring, auto-capture
- [ ] v0.2 — browser extension, cross-provider injection, memory classification
- [ ] v0.3 — React dashboard, permission controls, audit log
- [ ] v0.4 — optional encrypted cloud sync

---

## Contributing

Core logic in `packages/cli/src/vault/` — `db.ts` for storage, `embed.ts` for scoring. MCP integration in `packages/mcp-server/src/server.ts`.

---

MIT License · Part of [4StaX](https://4stax.com)