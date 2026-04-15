import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../../vault/db.js'
import { detectAvailableEmbeddingBackend } from '../../vault/embed.js'
import { ensurePrivateDir, writePrivateFile } from '../../security.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')
const OLD_VAULT_DIR = path.join(os.homedir(), '.mnemix')
const OLD_DB_PATH = path.join(OLD_VAULT_DIR, 'vault.db')
const OLD_CONFIG_PATH = path.join(OLD_VAULT_DIR, 'config.json')

function safeReadJson(filePath: string): any {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function readPackageName(): string {
  const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: string }
    if (pkg.name && typeof pkg.name === 'string') return pkg.name
  } catch {
    // dev / unexpected layout
  }
  return '@4stax/kontxt'
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
  ensurePrivateDir(vaultDir)
  
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
        ensurePrivateDir(path.dirname(CONFIG_PATH))
        writePrivateFile(CONFIG_PATH, JSON.stringify(oldConfig, null, 2))
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
    writePrivateFile(CONFIG_PATH, JSON.stringify(config, null, 2))
    console.log(chalk.green('  ✓ OpenAI API key saved'))
  }

  const tierInfo = await detectAvailableEmbeddingBackend()
  const tier = tierInfo.label
  const tierColor =
    tierInfo.tier !== 'pseudo'
      ? chalk.green
      : chalk.yellow
  console.log(tierColor(`  ✓ embeddings: ${tier}`))

  // MCP: use npx so Cursor / Claude work without a global install (required for scoped npm names).
  const mcpServerName = 'kontxt'
  const npmPackageName = readPackageName()
  const mcpServerEntry = { command: 'npx', args: ['-y', npmPackageName, 'serve'] }

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
  console.log(chalk.gray(`  npx -y ${npmPackageName} add "..."` + '       — store a memory'))
  console.log(chalk.gray(`  npx -y ${npmPackageName} search "..."` + '    — semantic search'))
  console.log(chalk.gray(`  npx -y ${npmPackageName} list` + '            — browse vault'))
  console.log(chalk.gray(`  npx -y ${npmPackageName} start` + '           — start MCP server'))
  console.log(chalk.gray(`  npx -y ${npmPackageName} status` + '          — show vault + embeddings'))
  console.log(
    chalk.gray(`  npm install -g ${npmPackageName}` + '  — then use plain `kontxt …` on PATH\n')
  )
}
