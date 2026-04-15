#!/usr/bin/env bash
# Isolated HOME smoke test for kontxt CLI. Requires a successful `npm run build`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export HOME="$ROOT/.e2e-home"
rm -rf "$HOME"
mkdir -p "$HOME"

echo "== kontxt init =="
node dist/cli/index.js init

echo "== kontxt add + search =="
node dist/cli/index.js add "E2E prefers local-first vault" -t preference -p kontxt-e2e
node dist/cli/index.js search "local" -l 3

echo "== kontxt living init + watch --once (temp repo) =="
TMP_REPO="$(mktemp -d)"
node dist/cli/index.js living init --dir "$TMP_REPO"
node dist/cli/index.js living focus "Ship kontxt as a cross-tool memory layer" --dir "$TMP_REPO"
node dist/cli/index.js living task "Dogfood kontxt while building 4stax" --dir "$TMP_REPO"
node dist/cli/index.js living fact "kontxt should keep project context portable across AI tools" --dir "$TMP_REPO"
node dist/cli/index.js living decision "Use managed markdown" --decision "kontxt should update its living markdown files from the CLI" --context "This makes the product usable before any dashboard or extension exists" --dir "$TMP_REPO"
node dist/cli/index.js living note "Implemented managed markdown helpers for dogfooding" --dir "$TMP_REPO"
node dist/cli/index.js watch --dir "$TMP_REPO" --project kontxt-e2e --once

echo "== kontxt session start/end =="
node dist/cli/index.js session start "continue building kontxt" --mode ask --provider cursor --dir "$TMP_REPO"
printf 'User: I am building kontxt for cross-provider continuity.\nUser: Today I implemented session start and session end commands.\nUser: I decided the CLI should remain the source of truth for continuity.\n' | node dist/cli/index.js session end --provider claude-web --dir "$TMP_REPO"
rm -rf "$TMP_REPO"

echo "== kontxt status =="
node dist/cli/index.js status

echo ""
echo "Notes:"
echo "  - capture/scan work best with OpenAI key / Ollama; heuristic extraction is the fallback."
echo "  - If init fails with better-sqlite3 native binding errors, run: npm rebuild better-sqlite3"
echo "  - MCP serve is not started here (long-running stdio server)."
echo ""
echo "E2E smoke OK."
