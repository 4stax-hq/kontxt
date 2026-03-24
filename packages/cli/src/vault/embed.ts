import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.mnemix', 'config.json')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

// Tier 1: OpenAI
async function embedOpenAI(text: string, apiKey: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey })
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return res.data[0].embedding
}

// Tier 2: Ollama (auto-detected if running locally)
async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch { return false }
}

async function embedOllama(text: string): Promise<number[]> {
  const res = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
  })
  if (!res.ok) throw new Error('Ollama embedding failed')
  const data = await res.json() as { embedding: number[] }
  return data.embedding
}

// Tier 3: pseudo-embedding (deterministic, local, no deps)
function pseudoEmbed(text: string): number[] {
  const dim = 256
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase().split(/\s+/)
  // word-level hashing gives slightly better signal than char-level
  for (const word of words) {
    let hash = 5381
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash) + word.charCodeAt(i)
      hash = hash & hash // 32-bit int
    }
    vec[Math.abs(hash) % dim] += 1
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / mag)
}

type EmbedTier = 'openai' | 'ollama' | 'pseudo'
let resolvedTier: EmbedTier | null = null

export async function embedText(text: string): Promise<number[]> {
  const config = getConfig()

  // Tier 1: OpenAI key configured
  if (config.openai_api_key) {
    try {
      const result = await embedOpenAI(text, config.openai_api_key)
      if (resolvedTier !== 'openai') { resolvedTier = 'openai' }
      return result
    } catch (e: any) {
      // bad key or network — fall through
      console.error('  OpenAI embedding failed, falling back...')
    }
  }

  // Tier 2: Ollama running locally
  if (await isOllamaRunning()) {
    try {
      const result = await embedOllama(text)
      if (resolvedTier !== 'ollama') { resolvedTier = 'ollama' }
      return result
    } catch {
      // ollama running but model not pulled — fall through
    }
  }

  // Tier 3: pseudo
  if (resolvedTier !== 'pseudo') { resolvedTier = 'pseudo' }
  return pseudoEmbed(text)
}

export function getActiveTier(): EmbedTier {
  return resolvedTier || 'pseudo'
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  // handle dimension mismatch between tiers
  const len = Math.min(a.length, b.length)
  const dot = a.slice(0, len).reduce((sum, ai, i) => sum + ai * b[i], 0)
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
  if (magA === 0 || magB === 0) return 0
  return dot / (magA * magB)
}

export function scoreMemory(
  embeddingSimilarity: number,
  createdAt: string,
  accessCount: number,
  importanceScore: number
): number {
  const daysSince = (Date.now() - new Date(createdAt).getTime()) / 86400000
  const recency = Math.exp(-daysSince / 30)
  const frequency = Math.log1p(accessCount) / 10
  return (
    embeddingSimilarity * 0.50 +
    recency             * 0.20 +
    frequency           * 0.15 +
    importanceScore     * 0.15
  )
}
