import chalk from 'chalk'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const PID_FILE = path.join(os.homedir(), '.mnemix', 'server.pid')
const LOG_FILE = path.join(os.homedir(), '.mnemix', 'server.log')

function findTsx(): string | null {
  const candidates = [
    path.join(process.cwd(), 'packages/mcp-server/node_modules/.bin/tsx'),
    path.join(process.cwd(), 'packages/mcp-server/node_modules/.bin/tsx'),
  ]
  return candidates.find(p => fs.existsSync(p)) || null
}

function getServerPath(): string {
  const local = path.join(process.cwd(), 'packages/mcp-server/src/server.ts')
  if (fs.existsSync(local)) return local
  return path.join(__dirname, '../../../mcp-server/src/server.ts')
}

export async function startCommand() {
  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim()
    try {
      process.kill(Number(pid), 0)
      console.log(chalk.yellow('  mnemix server already running (pid ' + pid + ')'))
      return
    } catch {
      fs.unlinkSync(PID_FILE)
    }
  }

  const serverPath = getServerPath()
  const tsx = findTsx()

  if (!tsx) {
    console.log(chalk.red('  tsx not found — run pnpm install first'))
    return
  }

  if (!fs.existsSync(serverPath)) {
    console.log(chalk.red('  server not found at: ' + serverPath))
    return
  }

  const log = fs.openSync(LOG_FILE, 'a')
  const child = spawn(tsx, [serverPath], {
    detached: true,
    stdio: ['ignore', log, log],
  })

  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))

  console.log(chalk.green('  ✓ mnemix server started (pid ' + child.pid + ')'))
  console.log(chalk.gray('  logs: ~/.mnemix/server.log'))
  console.log(chalk.gray('  mnemix stop — to stop'))
}
