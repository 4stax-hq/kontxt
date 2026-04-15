import type { SupabaseClient } from '@supabase/supabase-js'
import type Database from 'better-sqlite3'
import type { Memory } from '../types.js'
import { getAllMemories } from '../vault/db.js'
import { KONTXT_MEMORIES_TABLE } from './base-mapping.js'

export interface PushOptions {
  includePrivate?: boolean
  dryRun?: boolean
  batchSize?: number
}

export interface KontxtMemoryRow {
  id: string
  user_id: string
  project: string | null
  content: string
  summary: string
  source: string
  type: string
  privacy_level: string
  embedding_tier: string
  tags: string[]
  related_ids: string[]
  importance_score: number
  client_updated_at: string
  updated_at: string
}

function memoryToRow(m: Memory, userId: string, updatedAt: string): KontxtMemoryRow {
  return {
    id: m.id,
    user_id: userId,
    project: m.project ?? null,
    content: m.content,
    summary: m.summary,
    source: m.source,
    type: m.type,
    privacy_level: m.privacy_level,
    embedding_tier: m.embedding_tier,
    tags: m.tags,
    related_ids: m.related_ids,
    importance_score: m.importance_score,
    client_updated_at: m.accessed_at || m.created_at,
    updated_at: updatedAt,
  }
}

function filterForSync(memories: Memory[], includePrivate: boolean): Memory[] {
  if (includePrivate) return memories
  return memories.filter(m => m.privacy_level === 'anonymizable' || m.privacy_level === 'shareable')
}

/**
 * Upsert eligible local memories into Supabase `kontxt_memories`.
 * Caller must supply a Supabase client already scoped to the user's JWT.
 */
export async function pushMemoriesToSupabase(
  localDb: Database.Database,
  supabase: SupabaseClient,
  userId: string,
  options: PushOptions = {}
): Promise<{ pushed: number; skipped: number; batches: number }> {
  const includePrivate = options.includePrivate === true
  const dryRun = options.dryRun === true
  const batchSize = Math.min(500, Math.max(1, options.batchSize ?? 100))

  const all = getAllMemories(localDb)
  const eligible = filterForSync(all, includePrivate)
  const skipped = all.length - eligible.length

  if (dryRun) {
    return { pushed: eligible.length, skipped, batches: 0 }
  }

  const updatedAt = new Date().toISOString()
  const rows = eligible.map(m => memoryToRow(m, userId, updatedAt))
  let batches = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(KONTXT_MEMORIES_TABLE).upsert(chunk, {
      onConflict: 'id',
    })
    if (error) throw new Error(error.message)
    batches++
  }

  return { pushed: rows.length, skipped, batches }
}
