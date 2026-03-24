import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, getAllMemories } from '../vault/db.js'

const PID_FILE = path.join(os.homedir(), '.mnemix', 'server.pid')
const CONFIG_PATH = path.join(os.homedir(), '.mnemix', 'config.json')

export async function statusCommand() {
  console.log(chalk.cyan('\n  mnemix status\n'))

  // server
  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim()
    try {
      process.kill(Number(pid), 0)
      console.log(chalk.green('  ✓ server running') + chalk.gray(' (pid ' + pid + ')'))
    } catch {
      console.log(chalk.yellow('  ✗ server pid stale — run mnemix start'))
      fs.unlinkSync(PID_FILE)
    }
  } else {
    console.log(chalk.yellow('  ✗ server not running — run mnemix start'))
  }

  // embeddings
  const config = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    : {}

  let embedTier = 'pseudo (offline)'
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000)
    })
    if (res.ok) embedTier = 'ollama'
  } catch {}
  if (config.openai_api_key) embedTier = 'openai'

  console.log(chalk.green('  ✓ embeddings: ' + embedTier))

  // vault
  try {
    const db = getDb()
    const memories = getAllMemories(db)
    console.log(chalk.green('  ✓ vault: ' + memories.length + ' memories'))
  } catch {
    console.log(chalk.red('  ✗ vault: not initialized — run mnemix init'))
  }

  console.log()
}
