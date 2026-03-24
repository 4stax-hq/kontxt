import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../vault/db.js'

const CONFIG_PATH = path.join(os.homedir(), '.mnemix', 'config.json')

async function detectEmbedTier(): Promise<string> {
  const config = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    : {}

  if (config.openai_api_key) return 'openai (text-embedding-3-small)'

  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000)
    })
    if (res.ok) return 'ollama (nomic-embed-text)'
  } catch {}

  return 'pseudo (local fallback — install Ollama or set OpenAI key for semantic search)'
}

export async function initCommand(options: { key?: string }) {
  const vaultDir = path.join(os.homedir(), '.mnemix')
  
  console.log(chalk.cyan('\n  mnemix — your AI memory layer\n'))

  getDb()
  console.log(chalk.green('  ✓ vault ready at ~/.mnemix/vault.db'))

  const config: any = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    : {}

  if (options.key) {
    config.openai_api_key = options.key
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    console.log(chalk.green('  ✓ OpenAI API key saved'))
  }

  const tier = await detectEmbedTier()
  const tierColor = tier.startsWith('openai') || tier.startsWith('ollama')
    ? chalk.green
    : chalk.yellow
  console.log(tierColor(`  ✓ embeddings: ${tier}`))

  console.log(chalk.cyan('\n  commands:'))
  console.log(chalk.gray('  mnemix add "..."       — store a memory'))
  console.log(chalk.gray('  mnemix search "..."    — semantic search'))
  console.log(chalk.gray('  mnemix list            — browse vault'))
  console.log(chalk.gray('  mnemix serve           — start MCP server'))
  console.log(chalk.gray('  mnemix init --key sk-  — set OpenAI key\n'))
}
