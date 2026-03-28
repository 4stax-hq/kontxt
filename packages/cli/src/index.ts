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

const program = new Command()

program
  .name('mnemix')
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
  .command('serve')
  .description('Start MCP server in foreground (for debugging)')
  .action(() => {
    console.log('Starting mnemix MCP server...')
  })

program.parse()
