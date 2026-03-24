#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { addCommand } from './commands/add.js'
import { searchCommand } from './commands/search.js'
import { listCommand } from './commands/list.js'
import { deleteCommand } from './commands/delete.js'
import { editCommand } from './commands/edit.js'

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
  .command('serve')
  .description('Start the MCP server for Cursor/Claude integration')
  .action(() => {
    console.log('Starting mnemix MCP server...')
    require('../../../packages/mcp-server/dist/server.js')
  })

program.parse()
