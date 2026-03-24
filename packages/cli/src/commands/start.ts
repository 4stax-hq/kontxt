import chalk from 'chalk'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const PID_FILE = path.join(os.homedir(), '.mnemix', 'server.pid')
const LOG_FILE = path.join(os.homedir(), '.mnemix', 'server.log')

function getServerPath(): string {
  const local = path.join(process.cwd(), 'packages/mcp-server/dist/server.js')
  if (fs.existsSync(local)) return local
  // when installed globally via npm, resolve relative to this file
  return path.join(path.dirname(process.execPath), '../lib/node_modules/mnemix/packages/mcp-server/dist/server.js')
}

export async function startCommand() {
  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim()
    try {
      process.kill(Number(pid), 0) // check if process exists
      console.log(chalk.yellow('  mnemix server already running (pid ' + pid + ')'))
      console.log(chalk.gray('  mnemix stop — to stop it'))
      return
    } catch {
      // pid file stale, clean it up
      fs.unlinkSync(PID_FILE)
    }
  }

  const serverPath = getServerPath()
  if (!fs.existsSync(serverPath)) {
    console.log(chalk.red('  server not found at: ' + serverPath))
    console.log(chalk.gray('  run pnpm build first'))
    return
  }

  const log = fs.openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: ['ignore', log, log],
  })

  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))

  console.log(chalk.green('  ✓ mnemix server started (pid ' + child.pid + ')'))
  console.log(chalk.gray('  logs: ~/.mnemix/server.log'))
  console.log(chalk.gray('  mnemix stop — to stop'))
}
