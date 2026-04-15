#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { addCommand } from './commands/add.js'
import { searchCommand } from './commands/search.js'
import { listCommand } from './commands/list.js'
import { deleteCommand } from './commands/delete.js'
import { editCommand } from './commands/edit.js'
import { extractCommand } from './commands/extract.js'
import { startCommand } from './commands/start.js'
import { stopCommand } from './commands/stop.js'
import { statusCommand } from './commands/status.js'
import { scanCommand } from './commands/scan.js'
import { captureCommand } from './commands/capture.js'
import { vacuumCommand } from './commands/vacuum.js'
import { watchCommand } from './commands/watch.js'
import { livingInitCommand } from './commands/living-init.js'
import {
  livingDecisionCommand,
  livingFactCommand,
  livingFocusCommand,
  livingNoteCommand,
  livingTaskCommand,
} from './commands/living-manage.js'
import { sessionEndCommand, sessionStartCommand } from './commands/session.js'
import { syncPushCommand, syncStatusCommand } from './commands/sync.js'

const program = new Command()

program
  .name('kontxt')
  .description('Your AI memory layer. Works everywhere.')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize your local memory vault')
  .option('--key <apikey>', 'OpenAI API key for semantic embeddings')
  .action(initCommand)

program
  .command('add <content>')
  .description('Add a memory to your vault')
  .option('-t, --type <type>', 'memory type (fact/preference/project/skill/decision/episodic)', 'fact')
  .option('-p, --project <project>', 'associate with a project')
  .action(addCommand)

program
  .command('search <query>')
  .description('Search your vault semantically')
  .option('-l, --limit <n>', 'max results', '5')
  .action(searchCommand)

program
  .command('list')
  .description('List all memories')
  .option('-p, --project <project>', 'filter by project')
  .action(listCommand)

program
  .command('delete <id>')
  .description('Delete a memory by id (partial id ok)')
  .action(deleteCommand)

program
  .command('edit <id> <content>')
  .description('Edit a memory content by id (partial id ok)')
  .action(editCommand)

program
  .command('extract')
  .description('Extract and store memories from a conversation transcript')
  .option('-f, --file <path>', 'path to transcript file (or pipe via stdin)')
  .option('-p, --project <project>', 'associate extracted memories with a project')
  .action(extractCommand)

program
  .command('scan')
  .description('Scan a project directory and extract facts into the vault')
  .option('-d, --dir <path>', 'directory to scan (defaults to current directory)')
  .option('-p, --project <name>', 'project name to tag memories with')
  .action(scanCommand)

program
  .command('capture')
  .description('Auto-capture durable memories from a transcript')
  .option('-f, --file <path>', 'transcript file (or pipe via stdin)')
  .option('-p, --project <project>', 'associate extracted memories with a project')
  .option('-l, --limit <n>', 'max items to store', '50')
  .action(captureCommand)

program
  .command('start')
  .description('Start the MCP server as a background daemon')
  .action(startCommand)

program
  .command('stop')
  .description('Stop the background MCP server')
  .action(stopCommand)

program
  .command('status')
  .description('Show server status, embedding tier, and vault stats')
  .action(statusCommand)

program
  .command('vacuum')
  .description('Delete superseded memories and low-signal old items')
  .option('--days <n>', 'retention window in days (default: 180)')
  .option('--importance <n>', 'importance_score threshold (default: 0.2)')
  .action(vacuumCommand)

program
  .command('watch')
  .description('Watch living markdown (.kontxt/*.md and root CONTEXT.md, …) and ingest into the vault')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project tag for new memories')
  .option('--debounce <ms>', 'debounce file writes (default: 800)', '800')
  .option('--once', 'ingest all living markdown once and exit')
  .action(watchCommand)

const living = program
  .command('living')
  .description('Living workspace markdown templates under .kontxt/')

living
  .command('init')
  .description('Create CONTEXT.md, DECISIONS.md, FACTS.md, TIMELINE.md under .kontxt/')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-f, --force', 'overwrite existing files')
  .action(livingInitCommand)

living
  .command('focus <text>')
  .description('Set the current focus in .kontxt/CONTEXT.md and sync it into the vault')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project tag for synced memories')
  .action(livingFocusCommand)

living
  .command('task <text>')
  .description('Add an active task to .kontxt/CONTEXT.md and sync it into the vault')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project tag for synced memories')
  .action(livingTaskCommand)

living
  .command('fact <text>')
  .description('Add a stable fact to .kontxt/FACTS.md and sync it into the vault')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project tag for synced memories')
  .action(livingFactCommand)

living
  .command('decision <title>')
  .description('Add a decision entry to .kontxt/DECISIONS.md and sync it into the vault')
  .requiredOption('--decision <text>', 'final decision text')
  .option('--context <text>', 'decision context / tradeoffs')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project tag for synced memories')
  .action(livingDecisionCommand)

living
  .command('note <text>')
  .description('Append a dated timeline note to .kontxt/TIMELINE.md and sync it into the vault')
  .option('--date <yyyy-mm-dd>', 'override date heading (default: today)')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project tag for synced memories')
  .action(livingNoteCommand)

const sync = program.command('sync').description('Optional Supabase cloud mirror (see supabase/migrations)')

sync.command('status').description('Show sync configuration state').action(syncStatusCommand)

sync
  .command('push')
  .description('Upsert eligible memories to public.kontxt_memories')
  .option('--include-private', 'also push private memories')
  .option('--dry-run', 'print counts only; no network writes')
  .action(syncPushCommand)

const session = program.command('session').description('Cross-provider continuity workflow')

session
  .command('start <query>')
  .description('Prepare compact continuity context for the next chat/session')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project name override')
  .option('--provider <name>', 'provider or surface (cursor, claude-web, codex, gemini, etc.)')
  .option('--mode <mode>', 'auto | ask | fresh', 'ask')
  .option('-l, --limit <n>', 'max ranked memories to consider', '8')
  .option('--json', 'machine-readable output')
  .action(sessionStartCommand)

session
  .command('end')
  .description('Capture the finished session transcript and update local continuity state')
  .option('-f, --file <path>', 'transcript file (or pipe via stdin)')
  .option('-d, --dir <path>', 'repository root (default: cwd)')
  .option('-p, --project <name>', 'project name override')
  .option('--provider <name>', 'provider or surface (cursor, claude-web, codex, gemini, etc.)')
  .option('-l, --limit <n>', 'max extracted items to store', '50')
  .option('--json', 'machine-readable output')
  .action(sessionEndCommand)

// Alias
program
  .command('decay')
  .description('Alias for vacuum')
  .option('--days <n>', 'retention window in days (default: 180)')
  .option('--importance <n>', 'importance_score threshold (default: 0.2)')
  .action(vacuumCommand)

program
  .command('serve')
  .description('Start MCP server on stdio (for Cursor / Claude Desktop)')
  .action(() => {
    // Compiled layout: dist/cli/index.js -> dist/mcp/server.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../mcp/server.js')
  })

program.parse()
