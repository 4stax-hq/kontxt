import * as fs from 'fs'
import { PID_PATH } from '../../constants'

export function stopCommand(): void {
  if (!fs.existsSync(PID_PATH)) {
    console.log('Daemon is not running.')
    return
  }

  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10)
  try {
    process.kill(pid, 'SIGTERM')
    console.log(`Daemon stopped (PID ${pid})`)
  } catch {
    console.log('Daemon was not running (stale PID file removed)')
    fs.unlinkSync(PID_PATH)
  }
}
