import { v4 as uuid } from 'uuid'
import chalk from 'chalk'
import ora from 'ora'
import { getDb, insertMemory, findSimilarMemory, supersedeMemory, findMemoryByContent } from '../../vault/db.js'
import { embedText } from '../../vault/embed.js'
import type { MemoryType } from '../../types.js'

export async function addCommand(content: string, options: { type?: string; project?: string }) {
  const spinner = ora('storing memory...').start()

  try {
    const db = getDb()
    const exact = findMemoryByContent(db, content)
    if (exact) {
      spinner.info(chalk.yellow(`memory already exists [${exact.id.slice(0, 8)}]`))
      console.log(chalk.gray(`  type: ${exact.type}`))
      if (exact.project) console.log(chalk.gray(`  project: ${exact.project}`))
      return
    }
    const { embedding, tier } = await embedText(content)

    const duplicate = findSimilarMemory(db, embedding, 0.92, tier)
    if (duplicate) {
      const newId = uuid()
      supersedeMemory(db, duplicate.id, newId)
      const now = new Date().toISOString()

      insertMemory(db, {
        id: newId,
        content,
        summary: content.slice(0, 100),
        source: 'manual',
        type: (options.type || 'fact') as MemoryType,
        embedding,
        embedding_tier: tier,
        superseded_by: null,
        tags: [],
        project: options.project,
        related_ids: [],
        privacy_level: 'private',
        importance_score: 0.7,
        access_count: 0,
        created_at: now,
        accessed_at: now,
      })

      spinner.succeed(chalk.yellow(`superseded [${duplicate.id.slice(0, 8)}] -> [${newId.slice(0, 8)}]`))
      console.log(chalk.gray(`  before: ${duplicate.content.slice(0, 60)}`))
      console.log(chalk.gray(`  after:  ${content.slice(0, 60)}`))
      return
    }

    const id = uuid()
    const now = new Date().toISOString()

    insertMemory(db, {
      id,
      content,
      summary: content.slice(0, 100),
      source: 'manual',
      type: (options.type || 'fact') as MemoryType,
      embedding,
      embedding_tier: tier,
      superseded_by: null,
      tags: [],
      project: options.project,
      related_ids: [],
      privacy_level: 'private',
      importance_score: 0.7,
      access_count: 0,
      created_at: now,
      accessed_at: now,
    })

    spinner.succeed(chalk.green(`memory stored [${id.slice(0, 8)}]`))
    console.log(chalk.gray(`  type: ${options.type || 'fact'}`))
    if (options.project) console.log(chalk.gray(`  project: ${options.project}`))
  } catch (err: any) {
    spinner.fail(chalk.red('failed: ' + err.message))
  }
}
