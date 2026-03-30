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
- OpenAI API key (optional — embeddings prefer OpenAI when set)

---

## Install

```bash
npx kontxt init

# Optional: set OpenAI key for higher-quality embeddings
npx kontxt init --key sk-...
```

`kontxt init` creates the local vault (`~/.kontxt/vault.db`) and auto-writes MCP config for Cursor and Claude Desktop (when those configs exist).

---

## CLI

```bash
# Initialize vault + MCP config
kontxt init
kontxt init --key sk-...

# Add + search
kontxt add "I prefer JWT with 7-day expiry"
kontxt search "what stack am I using?" --limit 3

# Capture from a transcript (stdin or file)
cat conversation.txt | kontxt capture --project my-app
kontxt capture --file conversation.txt

# Start MCP server + inspect
kontxt start
kontxt status

# Cleanup
kontxt vacuum
```

**Memory types:** `fact` `preference` `project` `decision` `skill` `episodic`

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_relevant_context` | Semantic search, returns top-k scored memories |
| `search_memories` | Semantic search, returns top-k scored memories (with ids/scores) |
| `list_memories` | List memories from the vault (optionally filtered by project) |
| `delete_memory` | Delete a memory by id (partial id ok) |
| `auto_capture` | Extract durable memories from a transcript and store them |
| `store_memory` | Write a memory from inside a conversation |
| `store_conversation_summary` | Summarize and store a full conversation |
| `get_user_profile` | All memories grouped by type |

```bash
kontxt serve
```

---

## Prompt Templates

- `kontxt_context` | Returns the most relevant memories for a given `query` (args: `query`, optional `limit`, optional `project`)

---

## Connecting to Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kontxt": {
      "command": "kontxt",
      "args": ["serve"]
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
      "command": "kontxt",
      "args": ["serve"]
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

### Embedding backend troubleshooting
- If OpenAI key is set via `kontxt init --key`, embeddings prefer OpenAI.
- If Ollama is running locally, embeddings will prefer Ollama.
- If Transformers.js is available, embeddings will use Transformers.js offline.
- Otherwise, kontxt falls back to a lightweight pseudo-embedding mode.

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