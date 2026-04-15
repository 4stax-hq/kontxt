# kontxt

Local-first continuity for AI work across chats, tools, and providers.

`kontxt` keeps project context on your machine, maintains a small living project state in Markdown, and prepares compact carry-forward context for new sessions. It is designed for workflows where you switch between tools such as Cursor, Claude Desktop, Codex, or web chat products and do not want to restart from zero every time.

**npm:** [`@4stax/kontxt`](https://www.npmjs.com/package/@4stax/kontxt)  
The installed CLI command is still `kontxt`.

## Security

`kontxt` is local-first by default.

- Vault data is stored under `~/.kontxt/`
- Project state is stored in local `.kontxt/*.md` files
- Session history is stored in `~/.kontxt/session-state.json`
- `~/.kontxt` files are created with owner-only permissions where supported
- No cloud sync is part of the default workflow
- `session start --mode fresh` disables automatic carry-forward for a clean session

Operational guidance:

- Use `--mode ask` when reviewing carry-forward context before injection matters
- Treat any transcript piped into `session end` or `capture` as data you are intentionally storing locally
- If you use an OpenAI API key, it is stored locally in `~/.kontxt/config.json`
- The local machine account is the primary trust boundary for stored memory

Additional references:

- [Security Notes](SECURITY.md)
- [VS Code Extension Architecture](docs/vscode-extension.md)

## What It Does

- Stores durable context locally in `~/.kontxt/vault.db`
- Keeps a project state in `.kontxt/CONTEXT.md`, `DECISIONS.md`, `FACTS.md`, and `TIMELINE.md`
- Retrieves relevant context for a new session
- Supports `auto`, `ask`, and `fresh` continuity modes
- Captures the outcome of a finished session and updates local state
- Exposes MCP tools for compatible clients

## Install

Requirements:
- Node.js `>=18`

One-off usage:

```bash
npx -y @4stax/kontxt init
```

Global install:

```bash
npm install -g @4stax/kontxt
kontxt init
```

Optional: save an OpenAI key for higher-quality embeddings and transcript extraction:

```bash
kontxt init --key sk-...
```

Without an API key, `kontxt` uses:
1. Transformers.js local embeddings when available
2. Ollama local models when available
3. A weaker lexical fallback when neither is available

## Quick Start

Inside a repo:

```bash
kontxt living init --dir .
kontxt living focus "Describe the current project focus" --dir .
kontxt living task "Add the next concrete task" --dir .
kontxt watch --dir .
```

At the start of a new AI session:

```bash
kontxt session start "continue working on auth flow" --mode ask --dir .
```

At the end of a session:

```bash
cat transcript.txt | kontxt session end --provider claude-web --dir .
```

Search the current project state or stored memory:

```bash
kontxt search "what changed this week?" --limit 5
kontxt search "what decisions have we made about auth?" --limit 5
```

## Daily Workflow

Recommended loop:

1. Start `kontxt watch --dir .` in the project.
2. Keep `.kontxt/*.md` as the working state for the project.
3. Before starting a new chat, run `kontxt session start ...`.
4. Inject the returned summary only if the session should continue prior work.
5. After the session, run `kontxt session end` on the transcript.

This keeps the project timeline, decisions, and durable context up to date locally.

## Continuity Modes

`kontxt session start` supports three modes:

- `--mode auto`
  Inject automatically when relevance is strong.
- `--mode ask`
  Prepare a summary, but expect the caller or UI to confirm before injecting. This is the safest default.
- `--mode fresh`
  Do not inject prior context automatically.

Example:

```bash
kontxt session start "continue debugging the API timeout issue" --mode ask --provider cursor --dir .
kontxt session start "fresh start on a new idea" --mode fresh --provider claude-web --dir .
```

## Living Project Files

`kontxt living init` creates:

- `.kontxt/CONTEXT.md`
- `.kontxt/DECISIONS.md`
- `.kontxt/FACTS.md`
- `.kontxt/TIMELINE.md`

These files are the human-readable project state. `kontxt` can update them directly and ingest them back into the local vault.

Commands:

```bash
kontxt living init --dir .
kontxt living focus "Current focus text" --dir .
kontxt living task "Next task" --dir .
kontxt living fact "Stable fact" --dir .
kontxt living decision "Short title" --decision "Final decision text" --context "Optional context" --dir .
kontxt living note "What changed today" --dir .
```

When `kontxt watch --dir .` is running, edits to these files are re-ingested automatically.

## Session Commands

### Start

Prepare continuity for a new session:

```bash
kontxt session start "<task>" [options]
```

Useful options:

- `--mode ask|auto|fresh`
- `--provider <name>`
- `--dir <path>`
- `--project <name>`
- `--limit <n>`
- `--json`

Example:

```bash
kontxt session start "continue building the npm package" --mode ask --provider codex --dir .
```

### End

Capture a completed session:

```bash
kontxt session end [options]
```

Input:
- `--file <path>` to read a transcript file
- or pipe the transcript over stdin

Useful options:

- `--provider <name>`
- `--dir <path>`
- `--project <name>`
- `--limit <n>`
- `--json`

Example:

```bash
cat transcript.txt | kontxt session end --provider claude-web --dir .
```

`session end` will:
- extract durable facts, decisions, and progress notes
- store them in the local vault
- update living Markdown where applicable
- record session metadata for future continuity

## Search And Memory Commands

```bash
kontxt add "The project uses FastAPI and PostgreSQL" --type fact --project my-app
kontxt search "what stack are we using?" --limit 5
kontxt list --project my-app
kontxt edit <id> "Updated memory text"
kontxt delete <id>
kontxt vacuum
```

Memory types:
- `fact`
- `preference`
- `project`
- `decision`
- `skill`
- `episodic`

## Capture Commands

Capture a transcript manually:

```bash
cat conversation.txt | kontxt capture --project my-app
kontxt capture --file conversation.txt --project my-app
```

Scan a repo for project facts:

```bash
kontxt scan --dir . --project my-app
```

Notes:
- Transcript extraction is better with an OpenAI key or Ollama.
- Without them, `kontxt` falls back to heuristics.

## MCP

Start the MCP server on stdio:

```bash
kontxt serve
```

Main MCP tools:

- `get_relevant_context`
- `search_memories`
- `list_memories`
- `delete_memory`
- `auto_capture`
- `store_memory`
- `store_conversation_summary`
- `get_user_profile`

### Cursor

`~/.cursor/mcp.json`

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

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`

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

`kontxt init` will try to write these configs automatically.

## Storage

Local files:

- `~/.kontxt/vault.db`
- `~/.kontxt/config.json`
- `~/.kontxt/session-state.json`
- `~/.kontxt/models/` for cached local embedding models

Project-local files:

- `.kontxt/CONTEXT.md`
- `.kontxt/DECISIONS.md`
- `.kontxt/FACTS.md`
- `.kontxt/TIMELINE.md`

By default, data stays local.

## Troubleshooting

If `better-sqlite3` native bindings fail after install:

```bash
npm rebuild better-sqlite3
```

Check current setup:

```bash
kontxt status
```

If local embeddings are unavailable, `kontxt` will still run using the lexical fallback, but retrieval quality will be lower.

## Verification

```bash
npm run build
npm run test:e2e
```

The smoke test covers:
- init
- add/search
- living file management
- watch/ingest
- session start/session end
- status

## License

MIT
