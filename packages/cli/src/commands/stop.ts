import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'

const PID_FILE = path.join(os.homedir(), '.kontxt', 'server.pid')

export async function stopCommand() {
  if (!fs.existsSync(PID_FILE)) {
    console.log(chalk.yellow('  no kontxt server running'))
    return
  }

  const pid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim())

  // check if actually running before trying to kill
  let running = false
  try {
    process.kill(pid, 0)
    running = true
  } catch {}

  fs.unlinkSync(PID_FILE)

  if (running) {
    try {
      process.kill(pid, 'SIGTERM')
      console.log(chalk.green('  ✓ kontxt server stopped (pid ' + pid + ')'))
    } catch {
      console.log(chalk.yellow('  could not stop process, pid file cleaned up'))
    }
  } else {
    console.log(chalk.yellow('  server was not running, cleaned up pid file'))
  }
}
