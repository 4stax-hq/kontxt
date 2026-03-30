import chalk from 'chalk'
import ora from 'ora'
import { getDb } from '../vault/db.js'

export async function vacuumCommand(options: { days?: number; importance?: number }) {
  const db = getDb()
  const days = typeof options.days === 'number' ? options.days : 180
  const importance = typeof options.importance === 'number' ? options.importance : 0.2

  const spinner = ora('vacuuming vault...').start()

  try {
    // Delete:
    // 1) superseded memories (superseded_by != NULL)
    // 2) optional low-signal old memories: access_count=0, low importance, and older than N days
    const stmt = db.prepare(`
      DELETE FROM memories
      WHERE superseded_by IS NOT NULL
         OR (
              access_count = 0
              AND importance_score < ?
              AND datetime(created_at) < datetime('now', ?)
            )
    `)

    const res = stmt.run(importance, `-${days} days`)
    spinner.stop()

    console.log(chalk.green(`vault vacuum complete. deleted=${res.changes}`))
    console.log(chalk.gray('  strategy: superseded + low-signal old (never accessed)'))
  } catch (err: any) {
    spinner.fail(chalk.red('vacuum failed: ' + err.message))
  }
}

