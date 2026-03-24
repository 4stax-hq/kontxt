import chalk from 'chalk'
import ora from 'ora'
import { getDb, getAllMemories, incrementAccess } from '../vault/db.js'
import { embedText, cosineSimilarity, scoreMemory } from '../vault/embed.js'

export async function searchCommand(query: string, options: { limit?: number }) {
  const spinner = ora('searching vault...').start()
  const limit = options.limit || 5

  try {
    const db = getDb()
    const queryEmbedding = await embedText(query)
    const all = getAllMemories(db)

    if (all.length === 0) {
      spinner.stop()
      console.log(chalk.yellow('\n  vault is empty. run: mnemix add "..."\n'))
      return
    }

    const scored = all
      .map(m => ({
        memory: m,
        score: scoreMemory(
          cosineSimilarity(m.embedding, queryEmbedding),
          m.created_at,
          m.access_count,
          m.importance_score
        )
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    spinner.stop()
    console.log(chalk.cyan(`\n  top ${scored.length} memories for: "${query}"\n`))

    scored.forEach(({ memory, score }, i) => {
      console.log(chalk.white(`  ${i + 1}. ${memory.content}`))
      console.log(chalk.gray(`     score: ${score.toFixed(3)} | type: ${memory.type} | id: ${memory.id.slice(0, 8)}`))
      if (memory.project) console.log(chalk.gray(`     project: ${memory.project}`))
      console.log()
      incrementAccess(db, memory.id)
    })
  } catch (err: any) {
    spinner.fail(chalk.red('search failed: ' + err.message))
  }
}
