import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { getDb, insertMemory, findSimilarMemory, supersedeMemory } from '../vault/db.js'
import { embedText } from '../vault/embed.js'
import { extractMemoriesFromTranscript } from '../../../core/dist/extractor.js'
import type { MemoryType } from '../../../core/dist/index.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

export async function captureCommand(options: { file?: string; project?: string; limit?: number | string }) {
  let transcript = ''

  if (options.file) {
    if (!fs.existsSync(options.file)) {
      console.log(chalk.red('file not found: ' + options.file))
      return
    }
    transcript = fs.readFileSync(options.file, 'utf-8')
  } else {
    transcript = fs.readFileSync('/dev/stdin', 'utf-8')
  }

  if (!transcript.trim()) {
    console.log(chalk.red('no transcript provided'))
    console.log(chalk.gray('  cat conversation.txt | kontxt capture'))
    console.log(chalk.gray('  kontxt capture --file conversation.txt'))
    return
  }

  const spinner = ora('auto-capturing durable memories...').start()
  try {
    const config = getConfig()
    const extracted = await extractMemoriesFromTranscript(transcript, config.openai_api_key)

    if (!extracted.length) {
      spinner.stop()
      console.log(chalk.yellow('no durable memories found'))
      return
    }

    spinner.text = 'storing memories...'

    const db = getDb()
    let stored = 0
    let updated = 0
    let skipped = 0

    const maxItems = typeof options.limit === 'string' ? Number(options.limit) : (options.limit ?? 50)

    for (const item of extracted.slice(0, maxItems)) {
      if (!item.content || !item.type) { skipped++; continue }
      try {
        const { embedding, tier } = await embedText(item.content)
        const duplicate = findSimilarMemory(db, embedding, 0.92, tier)

        if (duplicate) {
          const newId = uuid()
          supersedeMemory(db, duplicate.id, newId)

          const now = new Date().toISOString()
          insertMemory(db, {
            id: newId,
            content: item.content,
            summary: item.content.slice(0, 100),
            source: 'auto-captured',
            type: item.type as MemoryType,
            embedding,
            embedding_tier: tier,
            superseded_by: null,
            tags: [],
            project: options.project,
            related_ids: [],
            privacy_level: 'private',
            importance_score: 0.65,
            access_count: 0,
            created_at: now,
            accessed_at: now,
          })
          updated++
        } else {
          const now = new Date().toISOString()
          const id = uuid()
          insertMemory(db, {
            id,
            content: item.content,
            summary: item.content.slice(0, 100),
            source: 'auto-captured',
            type: item.type as MemoryType,
            embedding,
            embedding_tier: tier,
            superseded_by: null,
            tags: [],
            project: options.project,
            related_ids: [],
            privacy_level: 'private',
            importance_score: 0.65,
            access_count: 0,
            created_at: now,
            accessed_at: now,
          })
          stored++
        }
      } catch {
        skipped++
      }
    }

    spinner.stop()
    console.log(
      chalk.cyan(
        `done: stored=${stored}, updated=${updated}, skipped=${skipped} (from ${Math.min(extracted.length, maxItems)} extracted items)`
      )
    )
  } catch (err: any) {
    spinner.fail(chalk.red('capture failed: ' + err.message))
  }
}

