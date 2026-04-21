import * as crypto from 'crypto'
import { EMBEDDING_DIM } from '../constants'

const cache = new Map<string, Float32Array>()

function cacheKey(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export async function embedText(text: string, apiKey: string): Promise<Float32Array> {
  if (!apiKey) {
    console.warn('[embeddings] No OpenAI API key — returning zero vector. Deduplication disabled.')
    return new Float32Array(EMBEDDING_DIM)
  }

  const key = cacheKey(text)
  const cached = cache.get(key)
  if (cached) return cached

  const { OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  const vec = new Float32Array(response.data[0].embedding)
  cache.set(key, vec)
  return vec
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0
  return dot / denom
}

export function isZeroVector(v: Float32Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== 0) return false
  }
  return true
}
