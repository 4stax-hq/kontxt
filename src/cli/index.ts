import { Command } from 'commander'
import { loadConfig, setConfigKey, ensureKontxtDir } from '../config'

const program = new Command()

program
  .name('kontxt')
  .description('Your AI memory layer — captures developer knowledge automatically')
  .version('0.2.0')

program
  .command('start')
  .description('Start the background daemon')
  .option('-w, --workspace <path>', 'Workspace path to monitor')
  .action((opts) => {
    const { startCommand } = require('./commands/start') as typeof import('./commands/start')
    startCommand(opts.workspace)
  })

program
  .command('stop')
  .description('Stop the running daemon')
  .action(() => {
    const { stopCommand } = require('./commands/stop') as typeof import('./commands/stop')
    stopCommand()
  })

program
  .command('status')
  .description('Show daemon status and recent entries')
  .action(() => {
    const { statusCommand } = require('./commands/status') as typeof import('./commands/status')
    statusCommand()
  })

program
  .command('note <text>')
  .description('Capture an explicit note (default type: fact)')
  .option('-t, --type <type>', 'Entry type: decision|fact|blocker|progress|focus', 'fact')
  .option('-w, --workspace <path>', 'Workspace path')
  .action(async (text: string, opts) => {
    const { noteCommand } = require('./commands/note') as typeof import('./commands/note')
    await noteCommand(text, opts.type, opts.workspace)
  })

program
  .command('context')
  .description('Print current context packet to stdout')
  .option('-p, --project <name>', 'Project name')
  .option('-w, --workspace <path>', 'Workspace path')
  .action(async (opts) => {
    const { contextCommand } = require('./commands/context') as typeof import('./commands/context')
    await contextCommand(opts.project, opts.workspace)
  })

program
  .command('ingest [file]')
  .description('Process a conversation file or stdin')
  .option('-w, --workspace <path>', 'Workspace path')
  .action(async (file: string | undefined, opts) => {
    const { ingestCommand } = require('./commands/ingest') as typeof import('./commands/ingest')
    await ingestCommand(file, opts.workspace)
  })

program
  .command('init')
  .description('Analyze this repo and seed initial context (1 API call)')
  .option('-w, --workspace <path>', 'Workspace path (defaults to cwd)')
  .action(async (opts) => {
    const { initCommand } = require('./commands/init') as typeof import('./commands/init')
    await initCommand(opts.workspace ?? process.cwd())
  })

program
  .command('mcp-server')
  .description('Start the MCP server on stdio (for Cursor/Claude Desktop config)')
  .action(async () => {
    const { startMcpServer } = require('../mcp/server') as typeof import('../mcp/server')
    await startMcpServer()
  })

const configCmd = program
  .command('config')
  .description('Manage kontxt configuration')

configCmd
  .command('set <key> <value>')
  .description('Set a config value')
  .action((key: string, value: string) => {
    try {
      ensureKontxtDir()
      setConfigKey(key, value)
      console.log(`Set ${key} = ${key.includes('key') ? '***' : value}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      process.exit(1)
    }
  })

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig()
    const safe = {
      ...config,
      anthropicKey: config.anthropicKey ? '***' + config.anthropicKey.slice(-4) : '(not set)',
      openaiKey: config.openaiKey ? '***' + config.openaiKey.slice(-4) : '(not set)',
    }
    console.log(JSON.stringify(safe, null, 2))
  })

program.parseAsync(process.argv).catch(err => {
  console.error(err)
  process.exit(1)
})
