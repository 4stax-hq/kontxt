#!/usr/bin/env node
import { Command } from 'commander'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
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

// Alias
program
  .command('decay')
  .description('Alias for vacuum')
  .option('--days <n>', 'retention window in days (default: 180)')
  .option('--importance <n>', 'importance_score threshold (default: 0.2)')
  .action(vacuumCommand)

program
  .command('serve')
  .description('Start MCP server in foreground (for debugging)')
  .action(() => {
    const serverTs = path.resolve(process.cwd(), 'packages/mcp-server/src/server.ts')
    const serverJs = path.resolve(process.cwd(), 'packages/mcp-server/dist/server.js')

    const tsxBinCandidates = [
      path.resolve(process.cwd(), 'node_modules/.bin/tsx'),
      path.resolve(process.cwd(), 'packages/mcp-server/node_modules/.bin/tsx'),
      path.resolve(process.cwd(), 'packages/cli/node_modules/.bin/tsx'),
    ]

    const tsxBin = tsxBinCandidates.find(p => fs.existsSync(p))
    if (!fs.existsSync(serverTs) && !fs.existsSync(serverJs)) {
      console.error('MCP server not found (no src/server.ts nor dist/server.js)')
      process.exit(1)
    }

    if (tsxBin && fs.existsSync(serverTs)) {
      // Prefer running from TypeScript so we don't depend on potentially stale `dist/`.
      const child = spawn(tsxBin, [serverTs], { stdio: 'inherit' })
      child.on('exit', code => process.exit(code ?? 1))
      return
    }

    // Fallback: run compiled JS
    const child = spawn(process.execPath, [serverJs], { stdio: 'inherit' })
    child.on('exit', code => process.exit(code ?? 1))
  })

program.parse()
