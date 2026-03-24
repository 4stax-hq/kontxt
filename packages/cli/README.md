# mnemix

**Your AI memory layer. Works everywhere.**

Every AI tool you use starts from zero.  
mnemix gives them all shared, persistent, semantically-searchable memory — that you own.

Works with Cursor, Claude Desktop, and any MCP-compatible tool.  
Local first. Open source. Your data never leaves your machine.

## Install
```bash
npx mnemix init
npx mnemix init --key sk-...   # optional: enable semantic search
```

## Use
```bash
mnemix add "I always use JWT with 7-day expiry"
mnemix add "this project uses Supabase" --project mnemix
mnemix search "auth preferences"
mnemix list
mnemix serve   # start MCP server
```

## Connect to Cursor

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "mnemix": { "command": "npx", "args": ["mnemix", "serve"] }
    }
  }
}
```

See `docs/mcp-setup.md` for Claude Desktop setup.

## Roadmap

- [x] v0.1 — local vault + MCP server
- [ ] v0.2 — browser extension, auto-capture
- [ ] v0.3 — React dashboard
- [ ] v0.4 — cloud sync (opt-in)
- [ ] v1.0 — data marketplace
