import chalk from 'chalk'
import { getDb, getAllMemories } from '../vault/db.js'
import { embedText } from '../vault/embed.js'

export async function editCommand(id: string, newContent: string) {
  const db = getDb()
  const all = getAllMemories(db)

  const match = all.find(m => m.id.startsWith(id))

  if (!match) {
    console.log(chalk.red(`\n  no memory found with id starting: ${id}\n`))
    return
  }

  const { embedding, tier } = await embedText(newContent)

  db.prepare(`
    UPDATE memories
    SET content = ?, summary = ?, embedding = ?, embedding_tier = ?, accessed_at = ?
    WHERE id = ?
  `).run(
    newContent,
    newContent.slice(0, 100),
    Buffer.from(new Float32Array(embedding).buffer),
    tier,
    new Date().toISOString(),
    match.id
  )

  console.log(chalk.green(`\n  ✓ updated [${match.id.slice(0, 8)}]`))
  console.log(chalk.gray(`  before: ${match.content.slice(0, 60)}`))
  console.log(chalk.gray(`  after:  ${newContent.slice(0, 60)}\n`))
}
