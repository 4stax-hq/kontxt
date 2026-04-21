import type { Database } from '../storage/db'
import { getAllActiveEntries } from '../storage/db'
import { embedText, cosineSimilarity, isZeroVector } from '../storage/embeddings'
import type { ExtractedItem, EntryScope, DedupeAction } from '../types'
import { DEDUPE_SKIP_THRESHOLD, DEDUPE_MERGE_THRESHOLD } from '../constants'

export interface DedupeResult {
  action: DedupeAction
  existingId?: string
  embedding: Float32Array
}

export async function deduplicate(
  item: ExtractedItem & { project: string; scope: EntryScope },
  db: Database.Database,
  config: { openaiKey?: string }
): Promise<DedupeResult> {
  const embedding = await embedText(item.content, config.openaiKey ?? '')

  if (isZeroVector(embedding)) {
    return { action: 'insert', embedding }
  }

  const existing = getAllActiveEntries(db, item.project).filter(e => e.type === item.type)

  let maxSim = 0
  let mostSimilarId: string | undefined

  for (const entry of existing) {
    if (!entry.embedding || isZeroVector(entry.embedding)) continue
    const sim = cosineSimilarity(embedding, entry.embedding)
    if (sim > maxSim) {
      maxSim = sim
      mostSimilarId = entry.id
    }
  }

  if (maxSim >= DEDUPE_SKIP_THRESHOLD) {
    return { action: 'skip', existingId: mostSimilarId, embedding }
  }

  if (maxSim >= DEDUPE_MERGE_THRESHOLD) {
    return { action: 'merge', existingId: mostSimilarId, embedding }
  }

  return { action: 'insert', embedding }
}
