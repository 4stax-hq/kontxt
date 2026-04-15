import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '../../vault/db.js'
import { detectAvailableEmbeddingBackend, getActiveTier } from '../../vault/embed.js'

const PID_FILE = path.join(os.homedir(), '.kontxt', 'server.pid')
const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

export async function statusCommand() {
  console.log(chalk.cyan('\n  kontxt status\n'))

  // server
  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim()
    try {
      process.kill(Number(pid), 0)
      console.log(chalk.green('  ✓ server running') + chalk.gray(' (pid ' + pid + ')'))
    } catch {
      console.log(chalk.yellow('  ✗ server pid stale — run kontxt start'))
      fs.unlinkSync(PID_FILE)
    }
  } else {
    console.log(chalk.yellow('  ✗ server not running — run kontxt start'))
  }

  // embeddings (priority view + last resolved tier)
  const config = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    : {}

  const backend = await detectAvailableEmbeddingBackend()

  let activeTier: string | null = null
  try {
    activeTier = getActiveTier()
  } catch {
    activeTier = null
  }

  const backendColor = backend.tier === 'pseudo' ? chalk.yellow : chalk.green
  console.log(backendColor('  ✓ embeddings: ' + backend.label + (activeTier ? ' (active: ' + activeTier + ')' : '')))
  console.log(
    chalk.gray(
      '  config: ' +
        (config.openai_api_key ? 'openai_api_key is set' : 'no OpenAI key (ollama/transformers/pseudo fallback)')
    )
  )

  // vault (active-only)
  console.log(chalk.gray('  vault.db: ~/.kontxt/vault.db'))
  try {
    const db = getDb()

    const activeCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE superseded_by IS NULL').get() as any)?.c ?? 0
    const supersededCount =
      (db.prepare('SELECT COUNT(*) as c FROM memories WHERE superseded_by IS NOT NULL').get() as any)?.c ?? 0

    console.log(chalk.green('  ✓ vault: ' + activeCount + ' active memories'))
    if (supersededCount > 0) console.log(chalk.yellow('  ✓ vault: ' + supersededCount + ' superseded (ignored)'))

    // tier distribution
    const tierStats = db
      .prepare(`
        SELECT embedding_tier, COUNT(*) as c,
               SUM(access_count) as total_access,
               AVG(importance_score) as avg_importance
        FROM memories
        WHERE superseded_by IS NULL
        GROUP BY embedding_tier
        ORDER BY c DESC
      `)
      .all() as any[]

    if (tierStats.length) {
      console.log(chalk.gray('  tiers (active):'))
      for (const t of tierStats) {
        const avgImp = Number(t.avg_importance) || 0
        console.log(
          '   - ' +
            String(t.embedding_tier).padEnd(12) +
            `count=${String(t.c).padStart(4)} access=${String(t.total_access ?? 0).padStart(5)} avgImp=${avgImp.toFixed(2)}`
        )
      }
    }

    // top projects
    const topProjects = db
      .prepare(`
        SELECT project, COUNT(*) as c
        FROM memories
        WHERE superseded_by IS NULL AND project IS NOT NULL AND project != ''
        GROUP BY project
        ORDER BY c DESC
        LIMIT 5
      `)
      .all() as any[]

    if (topProjects.length) {
      console.log(chalk.gray('  top projects:'))
      for (const p of topProjects) console.log('   - ' + p.project + ': ' + p.c)
    }

    // recent activity
    const recent = db
      .prepare(`
        SELECT created_at, source, type, embedding_tier, access_count, content
        FROM memories
        WHERE superseded_by IS NULL
        ORDER BY created_at DESC
        LIMIT 6
      `)
      .all() as any[]

    if (recent.length) {
      console.log(chalk.gray('  recent activity:'))
      for (const m of recent) {
        const snippet = String(m.content || '').replace(/\s+/g, ' ').slice(0, 120)
        console.log('   - [' + m.created_at + '] (' + m.source + '/' + m.type + '/' + m.embedding_tier + ') ' + snippet)
      }
    }

    // decay candidates
    const vacuumDays = 180
    const vacuumImportance = 0.2
    const decayCandidates = (db
      .prepare(`
        SELECT COUNT(*) as c
        FROM memories
        WHERE superseded_by IS NULL
          AND access_count = 0
          AND importance_score < ?
          AND datetime(created_at) < datetime('now', ?)
      `)
      .get(vacuumImportance, `-${vacuumDays} days`) as any)?.c ?? 0

    if (decayCandidates > 0) {
      console.log(chalk.gray('  decay candidates (vacuum): ' + decayCandidates))
    }
  } catch {
    console.log(chalk.red('  ✗ vault: not initialized — run kontxt init'))
  }

  console.log()
}
