import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { PID_PATH } from '../../constants'

export function startCommand(workspacePath?: string): void {
  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10)
    try {
      process.kill(pid, 0)
      console.log(`Daemon already running (PID ${pid})`)
      return
    } catch {
      fs.unlinkSync(PID_PATH)
    }
  }

  const daemonEntry = path.join(__dirname, '../../daemon/run.js')
  const env = { ...process.env }
  if (workspacePath) {
    env.KONTXT_WORKSPACE = workspacePath
  }

  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: 'ignore',
    env,
  })
  child.unref()

  console.log(`Daemon started (PID ${child.pid})`)
}
