import { v4 as uuid } from 'uuid'
import { getDb, insertMemory, findSimilarMemory, supersedeMemory, findMemoryByContent } from './vault/db.js'
import { embedText } from './vault/embed.js'
import type { MemoryType } from './types.js'
import type { ExtractedMemory } from './extractor.js'
import { redactSensitiveText } from './content-policy.js'

export async function storeExtractedMemories(
  extracted: ExtractedMemory[],
  options: { project?: string; source?: string; importanceScore?: number; limit?: number } = {}
): Promise<{ stored: number; updated: number; skipped: number; items: ExtractedMemory[] }> {
  const db = getDb()
  let stored = 0
  let updated = 0
  let skipped = 0
  const source = options.source || 'auto-captured'
  const importance = options.importanceScore ?? 0.65
  const items = extracted.slice(0, options.limit ?? extracted.length)

  for (const item of items) {
    if (!item.content || !item.type) {
      skipped++
      continue
    }
    try {
      const assessed = redactSensitiveText(item.content)
      if (assessed.blocked) {
        skipped++
        continue
      }
      const safeContent = assessed.value.trim()
      if (!safeContent) {
        skipped++
        continue
      }
      const exact = findMemoryByContent(db, safeContent)
      if (exact) {
        skipped++
        continue
      }
      const { embedding, tier } = await embedText(safeContent)
      const duplicate = findSimilarMemory(db, embedding, 0.92, tier)
      const now = new Date().toISOString()

      if (duplicate) {
        const newId = uuid()
        supersedeMemory(db, duplicate.id, newId)
        insertMemory(db, {
          id: newId,
          content: safeContent,
          summary: safeContent.slice(0, 100),
          source,
          type: item.type as MemoryType,
          embedding,
          embedding_tier: tier,
          superseded_by: null,
          tags: [],
          project: options.project,
          related_ids: [],
          privacy_level: 'private',
          importance_score: importance,
          access_count: 0,
          created_at: now,
          accessed_at: now,
        })
        updated++
      } else {
        insertMemory(db, {
          id: uuid(),
          content: safeContent,
          summary: safeContent.slice(0, 100),
          source,
          type: item.type as MemoryType,
          embedding,
          embedding_tier: tier,
          superseded_by: null,
          tags: [],
          project: options.project,
          related_ids: [],
          privacy_level: 'private',
          importance_score: importance,
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

  return { stored, updated, skipped, items }
}
