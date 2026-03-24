import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../vault/db.js'

export async function initCommand(options: { key?: string }) {
  const vaultDir = path.join(os.homedir(), '.mnemix')
  const configPath = path.join(vaultDir, 'config.json')

  console.log(chalk.cyan('\n  mnemix — your AI memory layer\n'))

  // Init DB
  getDb()
  console.log(chalk.green('  ✓ vault created at ~/.mnemix/vault.db'))

  // Save API key if provided
  const config: any = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {}

  if (options.key) {
    config.openai_api_key = options.key
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log(chalk.green('  ✓ OpenAI API key saved'))
  } else {
    console.log(chalk.yellow('  ⚠ No API key set. Run: mnemix init --key sk-...'))
    console.log(chalk.gray('    (using offline mode until then)'))
  }

  console.log(chalk.cyan('\n  Next steps:'))
  console.log(chalk.white('  1. mnemix serve         — start MCP server'))
  console.log(chalk.white('  2. Add to Cursor/Claude — see docs/mcp-setup.md'))
  console.log(chalk.white('  3. mnemix add "..."     — add your first memory\n'))
}
