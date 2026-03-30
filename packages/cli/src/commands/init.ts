import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../vault/db.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')
const OLD_VAULT_DIR = path.join(os.homedir(), '.mnemix')
const OLD_DB_PATH = path.join(OLD_VAULT_DIR, 'vault.db')
const OLD_CONFIG_PATH = path.join(OLD_VAULT_DIR, 'config.json')

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

function safeReadJson(filePath: string): any {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function upsertMcpServerConfig(mcpConfigPath: string, serverName: string, serverCommand: string, serverArgs: string[]) {
  const dir = path.dirname(mcpConfigPath)
  fs.mkdirSync(dir, { recursive: true })

  const existing = safeReadJson(mcpConfigPath) || {}
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers || {}),
      [serverName]: {
        command: serverCommand,
        args: serverArgs,
      },
    },
  }

  fs.writeFileSync(mcpConfigPath, JSON.stringify(next, null, 2))
}

export async function initCommand(options: { key?: string }) {
  const vaultDir = path.join(os.homedir(), '.kontxt')
  
  console.log(chalk.cyan('\n  kontxt — your AI memory layer\n'))

  // Migrate old vault + config if present.
  try {
    if (fs.existsSync(OLD_DB_PATH) && !fs.existsSync(path.join(vaultDir, 'vault.db'))) {
      fs.mkdirSync(vaultDir, { recursive: true })
      fs.copyFileSync(OLD_DB_PATH, path.join(vaultDir, 'vault.db'))
      console.log(chalk.green('  ✓ migrated existing vault.db from ~/.mnemix'))
    }
    if (fs.existsSync(OLD_CONFIG_PATH) && !fs.existsSync(CONFIG_PATH)) {
      const oldConfig = safeReadJson(OLD_CONFIG_PATH)
      if (oldConfig) {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(oldConfig, null, 2))
        console.log(chalk.green('  ✓ migrated existing config.json from ~/.mnemix'))
      }
    }
  } catch {
    // Non-fatal; vault initialization will still proceed.
  }

  getDb()
  console.log(chalk.green('  ✓ vault ready at ~/.kontxt/vault.db'))

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

  // MCP config for Cursor and Claude Desktop.
  // Critical: point clients at the installed `kontxt` command, not a repo path.
  const mcpServerName = 'kontxt'
  const mcpServerEntry = { command: 'kontxt', args: ['serve'] }

  const cursorMcpPath = path.join(os.homedir(), '.cursor', 'mcp.json')
  const claudeMcpPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json'
  )

  // Cursor config path
  try {
    fs.mkdirSync(path.dirname(cursorMcpPath), { recursive: true })
    upsertMcpServerConfig(
      cursorMcpPath,
      mcpServerName,
      mcpServerEntry.command,
      mcpServerEntry.args
    )
    console.log(chalk.green(`  ✓ MCP config updated for Cursor (${cursorMcpPath})`))
  } catch {}

  // Claude Desktop config path (best-effort; directory may not exist yet)
  try {
    fs.mkdirSync(path.dirname(claudeMcpPath), { recursive: true })
    upsertMcpServerConfig(
      claudeMcpPath,
      mcpServerName,
      mcpServerEntry.command,
      mcpServerEntry.args
    )
    console.log(chalk.green(`  ✓ MCP config updated for Claude Desktop (${claudeMcpPath})`))
  } catch {}

  console.log(chalk.cyan('\n  commands:'))
  console.log(chalk.gray('  kontxt add "..."       — store a memory'))
  console.log(chalk.gray('  kontxt search "..."    — semantic search'))
  console.log(chalk.gray('  kontxt list            — browse vault'))
  console.log(chalk.gray('  kontxt start           — start MCP server'))
  console.log(chalk.gray('  kontxt status          — show vault + embeddings'))
  console.log(chalk.gray('  kontxt init --key sk-  — set OpenAI key\n'))
}
