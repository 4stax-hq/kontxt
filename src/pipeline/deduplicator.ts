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

// ─── token similarity fallback ───────────────────────────────────────────────
// Used when embeddings unavailable. Jaccard on meaningful tokens.

const STOP = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can','to','of',
  'in','on','at','by','for','with','about','and','or','but','not','this','that',
  'it','its','i','we','they','he','she','you','our','my','their','from','as','so',
])

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP.has(t))
  )
}

function jaccardSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 && tb.size === 0) return 1
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

// Jaccard thresholds are lower than cosine — token overlap is noisier
const TOKEN_SKIP_THRESHOLD  = 0.65
const TOKEN_MERGE_THRESHOLD = 0.40

// ─── main deduplicator ────────────────────────────────────────────────────────

export async function deduplicate(
  item: ExtractedItem & { project: string; scope: EntryScope },
  db: Database.Database,
  config: { openaiKey?: string }
): Promise<DedupeResult> {
  const embedding = await embedText(item.content, config.openaiKey ?? '')
  const hasEmbeddings = !isZeroVector(embedding)

  // Load same-type active entries for this project
  const existing = getAllActiveEntries(db, item.project).filter(e => e.type === item.type)
  if (existing.length === 0) return { action: 'insert', embedding }

  let maxSim = 0
  let mostSimilarId: string | undefined

  if (hasEmbeddings) {
    // Semantic similarity via cosine
    for (const entry of existing) {
      if (!entry.embedding || isZeroVector(entry.embedding)) continue
      const sim = cosineSimilarity(embedding, entry.embedding)
      if (sim > maxSim) { maxSim = sim; mostSimilarId = entry.id }
    }
    if (maxSim >= DEDUPE_SKIP_THRESHOLD)  return { action: 'skip',  existingId: mostSimilarId, embedding }
    if (maxSim >= DEDUPE_MERGE_THRESHOLD) return { action: 'merge', existingId: mostSimilarId, embedding }
  } else {
    // Fallback: token overlap (Jaccard) — works without any API key
    for (const entry of existing) {
      const sim = jaccardSimilarity(item.content, entry.content)
      if (sim > maxSim) { maxSim = sim; mostSimilarId = entry.id }
    }
    if (maxSim >= TOKEN_SKIP_THRESHOLD)  return { action: 'skip',  existingId: mostSimilarId, embedding }
    if (maxSim >= TOKEN_MERGE_THRESHOLD) return { action: 'merge', existingId: mostSimilarId, embedding }
  }

  return { action: 'insert', embedding }
}
