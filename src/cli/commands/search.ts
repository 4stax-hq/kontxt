import chalk from 'chalk'
import ora from 'ora'
import { getDb, getAllMemories, incrementAccess } from '../../vault/db.js'
import { embedText } from '../../vault/embed.js'
import { rankMemories } from '../../retrieval.js'

export async function searchCommand(query: string, options: { limit?: number }) {
  const spinner = ora('searching vault...').start()
  const limit = options.limit || 5

  try {
    const db = getDb()
    const { embedding: queryEmbedding, tier: queryTier } = await embedText(query)
    const all = getAllMemories(db)

    if (all.length === 0) {
      spinner.stop()
      console.log(chalk.yellow('\n  vault is empty. run: kontxt add "..."\n'))
      return
    }

    const scored = rankMemories(all, {
      query,
      queryEmbedding,
      queryTier,
      limit,
    })

    spinner.stop()
    console.log(chalk.cyan(`\n  top ${scored.length} memories for: "${query}"\n`))

    scored.forEach(({ memory, score }, i) => {
      console.log(chalk.white(`  ${i + 1}. ${memory.content}`))
      console.log(
        chalk.gray(
          `     score: ${score.toFixed(3)} | type: ${memory.type} | tier: ${memory.embedding_tier} | id: ${memory.id.slice(0, 8)}`
        )
      )
      if (memory.project) console.log(chalk.gray(`     project: ${memory.project}`))
      console.log()
      incrementAccess(db, memory.id)
    })
  } catch (err: any) {
    spinner.fail(chalk.red('search failed: ' + err.message))
  }
}
