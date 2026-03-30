import chalk from 'chalk'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const PID_FILE = path.join(os.homedir(), '.kontxt', 'server.pid')
const LOG_FILE = path.join(os.homedir(), '.kontxt', 'server.log')

function getServerJsPath(): string {
  // When compiled, this file lives at: packages/cli/dist/commands/start.js
  // So MCP server dist is at: packages/mcp-server/dist/server.js
  const installedCandidate = path.resolve(__dirname, '../../../mcp-server/dist/server.js')
  const repoCandidate = path.resolve(process.cwd(), 'packages/mcp-server/dist/server.js')
  return fs.existsSync(installedCandidate) ? installedCandidate : repoCandidate
}

export async function startCommand() {
  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim()
    try {
      process.kill(Number(pid), 0)
      console.log(chalk.yellow('  kontxt server already running (pid ' + pid + ')'))
      return
    } catch {
      fs.unlinkSync(PID_FILE)
    }
  }

  const serverJs = getServerJsPath()
  if (!fs.existsSync(serverJs)) {
    console.log(chalk.red('  server not found at: ' + serverJs))
    console.log(chalk.gray('  try: npm run build'))
    return
  }

  const log = fs.openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [serverJs], {
    detached: true,
    stdio: ['ignore', log, log],
  })

  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))

  console.log(chalk.green('  ✓ kontxt server started (pid ' + child.pid + ')'))
  console.log(chalk.gray('  logs: ~/.kontxt/server.log'))
  console.log(chalk.gray('  kontxt stop — to stop'))
}
