import chalk from 'chalk'
import { getDb, deleteMemory, resolveMemoryByPrefix } from '../../vault/db.js'

export async function deleteCommand(id: string) {
  const db = getDb()
  const { match, ambiguous } = resolveMemoryByPrefix(db, id)

  if (!match) {
    if (ambiguous.length) {
      console.log(chalk.red(`\n  ambiguous id prefix: ${id}`))
      ambiguous.forEach(m => console.log(chalk.gray(`  [${m.id.slice(0, 8)}] ${m.content.slice(0, 60)}`)))
      console.log()
      return
    }
    console.log(chalk.red(`\n  no memory found with id starting: ${id}\n`))
    return
  }

  deleteMemory(db, match.id)
  console.log(chalk.green(`\n  ✓ deleted [${match.id.slice(0, 8)}] ${match.content.slice(0, 60)}\n`))
}
