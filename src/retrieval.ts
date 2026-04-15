import type { Memory, SearchResult, EmbeddingTier } from './types.js'
import { cosineSimilarity, scoreMemory } from './vault/embed.js'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'how',
  'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'that', 'the',
  'this', 'to', 'use', 'we', 'what', 'when', 'with', 'you', 'your',
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/)
    .map(token => token.trim())
    .filter(token => token.length > 1 && !STOP_WORDS.has(token))
}

function keywordOverlap(query: string, memory: Memory): number {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) return 0

  const memoryTokens = new Set([
    ...tokenize(memory.content),
    ...tokenize(memory.summary),
    ...memory.tags.flatMap(tag => tokenize(tag)),
    ...(memory.project ? tokenize(memory.project) : []),
  ])

  let hits = 0
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) hits++
  }
  return hits / queryTokens.size
}

function isTimelineQuery(query: string): boolean {
  return /\b(timeline|progress|recent|recently|latest|what changed|changed|today|yesterday|this week|status|where are we|history)\b/i.test(query)
}

function isDecisionQuery(query: string): boolean {
  return /\b(decision|decide|decided|why did|why do we|tradeoff|trade-off|adr)\b/i.test(query)
}

function typeBonus(memory: Memory, query: string): number {
  if (isTimelineQuery(query)) {
    if (memory.type === 'episodic') return 0.18
    if (memory.type === 'project') return 0.08
  }
  if (isDecisionQuery(query) && memory.type === 'decision') return 0.16
  if (/\b(prefer|preference|style|tone|usually)\b/i.test(query) && memory.type === 'preference') return 0.16
  if (/\b(skill|experience|good at|expert|stack)\b/i.test(query) && (memory.type === 'skill' || memory.type === 'fact')) return 0.12
  return 0
}

function sourceBonus(memory: Memory, query: string): number {
  if (isTimelineQuery(query) && memory.source.includes('TIMELINE.md')) return 0.08
  if (/\b(current|focus|blocker|next)\b/i.test(query) && memory.source.includes('CONTEXT.md')) return 0.08
  if (isDecisionQuery(query) && memory.source.includes('DECISIONS.md')) return 0.08
  return 0
}

function crossTierPenalty(memory: Memory, queryTier: EmbeddingTier): number {
  return memory.embedding_tier === queryTier ? 1 : 0.72
}

export function rankMemories(
  memories: Memory[],
  params: {
    query: string
    queryEmbedding: number[]
    queryTier: EmbeddingTier
    limit: number
    project?: string
  }
): SearchResult[] {
  const { query, queryEmbedding, queryTier, limit, project } = params
  const scoped = project ? memories.filter(memory => memory.project === project) : memories

  return scoped
    .map(memory => {
      const semantic = memory.embedding.length ? cosineSimilarity(memory.embedding, queryEmbedding) : 0
      const keyword = keywordOverlap(query, memory)
      const blendedSimilarity = Math.max(semantic * crossTierPenalty(memory, queryTier), keyword * 0.92)
      const base = scoreMemory(
        blendedSimilarity,
        memory.created_at,
        memory.access_count,
        memory.importance_score
      )
      const score = base + typeBonus(memory, query) + sourceBonus(memory, query)
      return { memory, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
