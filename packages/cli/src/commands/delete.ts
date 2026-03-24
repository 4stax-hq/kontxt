import chalk from 'chalk'
import { getDb, deleteMemory, getAllMemories } from '../vault/db.js'

export async function deleteCommand(id: string) {
  const db = getDb()
  const all = getAllMemories(db)

  // support partial id match
  const match = all.find(m => m.id.startsWith(id))

  if (!match) {
    console.log(chalk.red(`\n  no memory found with id starting: ${id}\n`))
    return
  }

  deleteMemory(db, match.id)
  console.log(chalk.green(`\n  ✓ deleted [${match.id.slice(0, 8)}] ${match.content.slice(0, 60)}\n`))
}
