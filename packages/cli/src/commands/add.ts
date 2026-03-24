import { v4 as uuid } from 'uuid'
import chalk from 'chalk'
import ora from 'ora'
import { getDb, insertMemory } from '../vault/db.js'
import { embedText } from '../vault/embed.js'
import { MemoryType } from '@mnemix/core'

export async function addCommand(content: string, options: { type?: string; project?: string }) {
  const spinner = ora('storing memory...').start()

  try {
    const db = getDb()
    const embedding = await embedText(content)
    const now = new Date().toISOString()

    const memory = {
      id: uuid(),
      content,
      summary: content.slice(0, 100),
      source: 'manual',
      type: (options.type || 'fact') as MemoryType,
      embedding,
      tags: [],
      project: options.project,
      related_ids: [],
      privacy_level: 'private' as const,
      importance_score: 0.7,
      access_count: 0,
      created_at: now,
      accessed_at: now,
    }

    insertMemory(db, memory)
    spinner.succeed(chalk.green(`memory stored [${memory.id.slice(0, 8)}]`))
    console.log(chalk.gray(`  type: ${memory.type}`))
    if (memory.project) console.log(chalk.gray(`  project: ${memory.project}`))
  } catch (err: any) {
    spinner.fail(chalk.red('failed: ' + err.message))
  }
}
