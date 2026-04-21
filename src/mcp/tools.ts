import type { Database } from '../storage/db'
import { getAllActiveEntries } from '../storage/db'
import { buildContextPacket, formatContextPacket } from '../retrieval/engine'
import { embedText, cosineSimilarity, isZeroVector } from '../storage/embeddings'
import { processDirectEntry } from '../pipeline/writer'
import type { Config } from '../config'
import type { EntryType, RawEvent } from '../types'

export async function toolGetContext(
  db: Database.Database,
  config: Config,
  args: { task?: string; project?: string }
): Promise<string> {
  const project = args.project ?? 'default'
  const task = args.task ?? ''
  const packet = await buildContextPacket(db, project, task, config)
  return formatContextPacket(packet)
}

export async function toolRecordEvent(
  db: Database.Database,
  config: Config,
  args: { type: EntryType; content: string; project?: string }
): Promise<string> {
  const event: RawEvent = {
    text: args.content,
    source: 'mcp',
    projectName: args.project ?? 'default',
    timestamp: new Date().toISOString(),
  }
  await processDirectEntry(args.type, args.content, event, db, config)
  return `Recorded ${args.type}: ${args.content.slice(0, 80)}${args.content.length > 80 ? '...' : ''}`
}

export async function toolQuery(
  db: Database.Database,
  config: Config,
  args: { query: string; project?: string; types?: EntryType[] }
): Promise<string> {
  const project = args.project ?? 'default'
  const entries = getAllActiveEntries(db, project).filter(e =>
    !args.types || args.types.length === 0 || args.types.includes(e.type)
  )

  if (entries.length === 0) {
    return 'No entries found for this project.'
  }

  let queryEmbedding: Float32Array | null = null
  if (config.openaiKey) {
    try {
      queryEmbedding = await embedText(args.query, config.openaiKey)
      if (isZeroVector(queryEmbedding)) queryEmbedding = null
    } catch {
      queryEmbedding = null
    }
  }

  const scored = entries.map(entry => {
    let sim = 0
    if (queryEmbedding && entry.embedding && !isZeroVector(entry.embedding)) {
      sim = cosineSimilarity(queryEmbedding, entry.embedding)
    }
    return { entry, sim }
  })

  scored.sort((a, b) => b.sim - a.sim)

  const top = scored.slice(0, 10)
  const lines = top.map(({ entry }) =>
    `[${entry.type}] ${entry.content} (updated: ${entry.updatedAt.slice(0, 10)})`
  )

  return lines.join('\n')
}
