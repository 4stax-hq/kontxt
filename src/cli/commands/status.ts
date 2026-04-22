import * as fs from 'fs'
import { loadConfig } from '../../config'
import { PID_PATH } from '../../constants'
import { getDb } from '../../storage/db'

export function statusCommand(): void {
  let daemonRunning = false
  let daemonPid: number | null = null

  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10)
    try {
      process.kill(pid, 0)
      daemonRunning = true
      daemonPid = pid
    } catch {
      daemonRunning = false
    }
  }

  console.log(`Daemon: ${daemonRunning ? `running (PID ${daemonPid})` : 'not running'}`)
  console.log(`Capture: ${loadConfig().capturePaused ? 'paused' : 'live'}`)

  try {
    const db = getDb()
    const projects = db.prepare('SELECT name, last_active_at FROM projects ORDER BY last_active_at DESC LIMIT 5').all() as Array<{ name: string; last_active_at: string }>

    if (projects.length > 0) {
      console.log('\nRecent projects:')
      for (const p of projects) {
        const date = p.last_active_at.slice(0, 16).replace('T', ' ')
        console.log(`  ${p.name} (last active: ${date})`)
      }
    }

    const recentEntries = db.prepare(`
      SELECT type, content, project, updated_at FROM entries
      WHERE superseded_by IS NULL
      ORDER BY updated_at DESC LIMIT 5
    `).all() as Array<{ type: string; content: string; project: string; updated_at: string }>

    if (recentEntries.length > 0) {
      console.log('\nRecent entries:')
      for (const e of recentEntries) {
        const date = e.updated_at.slice(0, 16).replace('T', ' ')
        const preview = e.content.length > 60 ? e.content.slice(0, 60) + '...' : e.content
        console.log(`  [${e.type}] ${preview} (${e.project}, ${date})`)
      }
    }
  } catch {
    console.log('(database not yet initialized)')
  }
}
