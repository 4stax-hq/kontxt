# kontxt

A local-first memory layer for AI tools. Persistent, semantically-searchable context across sessions and providers via MCP.

**npm:** [`@4stax/kontxt`](https://www.npmjs.com/package/@4stax/kontxt) — the unscoped name `kontxt` is already taken on npm.

After a global install, the CLI on your PATH is still **`kontxt`**; without that, use **`npx -y @4stax/kontxt …`**.

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
       ├── memories         content, embeddings, embedding_tier, type, tags, project, scores
       └── config.json      API key, settings

src/
├── cli/
│   ├── index.ts            Commander entry (kontxt serve loads MCP inline)
│   └── commands/           init, add, search, list, edit, delete, capture, …
├── mcp/server.ts           MCP tools + prompts (stdio)
├── vault/
│   ├── db.ts               SQLite via better-sqlite3
│   └── embed.ts            embedding providers + relevance scoring
├── types.ts
└── extractor.ts            transcript → durable facts (OpenAI or Ollama)

dist/                       compiled output (from npm install / publish, not committed)
bin/kontxt.js               shim → dist/cli/index.js
```

---

## Requirements

- Node.js >= 18
- OpenAI API key (optional — used first when set in `~/.kontxt/config.json`)
- Offline semantic search works without a key via **Transformers.js** (`all-MiniLM-L6-v2`), with models cached under `~/.kontxt/models` after the first run

---

## Install

```bash
# One-off (no global install)
npx -y @4stax/kontxt init

# Optional: set OpenAI key for higher-quality embeddings
npx -y @4stax/kontxt init --key sk-...

# Optional: install globally so the binary is just `kontxt`
npm install -g @4stax/kontxt
```

`init` creates the local vault (`~/.kontxt/vault.db`) and writes MCP config for Cursor and Claude Desktop when those config paths exist. New configs use `npx -y @4stax/kontxt serve` so MCP works without a global install.

---

## CLI

With a global install (`npm install -g @4stax/kontxt`), run `kontxt …` as below. Otherwise prefix with `npx -y @4stax/kontxt` (for example `npx -y @4stax/kontxt search "…"`).

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
      "command": "npx",
      "args": ["-y", "@4stax/kontxt", "serve"]
    }
  }
}
```

If you use a **global** install, you may use `"command": "kontxt", "args": ["serve"]` instead.

## Connecting to Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kontxt": {
      "command": "npx",
      "args": ["-y", "@4stax/kontxt", "serve"]
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

### Embedding backends (order)
1. **OpenAI** — `text-embedding-3-small` when `openai_api_key` is set (about US $0.00002 per call at typical usage).
2. **Transformers.js** — `Xenova/all-MiniLM-L6-v2` in-process, no API key; first run downloads the model once.
3. **Ollama** — local embeddings if `ollama serve` is running and an embed model is available.
4. **Pseudo** — hashed bag-of-words fallback only when nothing else works; not comparable across tiers with real embeddings.

Semantic search only compares memories stored in the **same** `embedding_tier` as the current query, so switching providers does not produce misleading cosine scores against old vectors.

---

## Roadmap

- [x] v0.1 — local vault, CLI, MCP server, relevance scoring, auto-capture
- [ ] v0.2 — browser extension, cross-provider injection, memory classification
- [ ] v0.3 — React dashboard, permission controls, audit log
- [ ] v0.4 — optional encrypted cloud sync

---

## Contributing

Core logic: `src/vault/db.ts` (storage), `src/vault/embed.ts` (embeddings + scoring), `src/mcp/server.ts` (MCP).

---

MIT License · Part of [4StaX](https://4stax.com)