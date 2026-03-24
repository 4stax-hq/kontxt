import chalk from 'chalk'
import { getDb, getAllMemories } from '../vault/db.js'

export async function listCommand(options: { project?: string }) {
  const db = getDb()
  let memories = getAllMemories(db)

  if (options.project) {
    memories = memories.filter(m => m.project === options.project)
  }

  if (memories.length === 0) {
    console.log(chalk.yellow('\n  no memories found\n'))
    return
  }

  console.log(chalk.cyan(`\n  ${memories.length} memories in vault\n`))
  memories.forEach(m => {
    console.log(chalk.white(`  [${m.id.slice(0, 8)}] ${m.content.slice(0, 80)}`))
    console.log(chalk.gray(`           ${m.type} | ${m.created_at.slice(0, 10)}`))
  })
  console.log()
}
