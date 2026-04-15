import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ensurePrivateDir } from '../security.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')
const TRANSFORMERS_CACHE = path.join(os.homedir(), '.kontxt', 'models')

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

async function getBestEmbedModel(): Promise<string> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000)
    })
    if (!res.ok) return 'nomic-embed-text'
    const data = await res.json() as { models: { name: string }[] }
    const models = data.models.map(m => m.name)
    const embedPreference = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'bge-']
    for (const pref of embedPreference) {
      const match = models.find(m => m.toLowerCase().includes(pref))
      if (match) return match
    }
    return models[0] || 'nomic-embed-text'
  } catch {
    return 'nomic-embed-text'
  }
}

async function embedOpenAI(text: string, apiKey: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey })
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return res.data[0].embedding
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000)
    })
    return res.ok
  } catch { return false }
}

async function embedOllama(text: string): Promise<number[]> {
  const model = await getBestEmbedModel()
  const res = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  })
  if (!res.ok) throw new Error('Ollama embedding failed')
  const data = await res.json() as { embedding: number[] }
  return data.embedding
}

function pseudoEmbed(text: string): number[] {
  const dim = 256
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase().split(/\s+/)
  for (const word of words) {
    let hash = 5381
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash) + word.charCodeAt(i)
      hash = hash & hash
    }
    vec[Math.abs(hash) % dim] += 1
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / mag)
}

let transformersPipelinePromise: Promise<any> | null = null

async function getTransformersPipeline(): Promise<any> {
  if (transformersPipelinePromise) return transformersPipelinePromise

  transformersPipelinePromise = (async () => {
    const config = getConfig()
    const candidates: string[] = []
    if (typeof config.transformers_embedding_model === 'string' && config.transformers_embedding_model) {
      candidates.push(config.transformers_embedding_model)
    }
    // Small-ish general embedding models. Users can override via `transformers_embedding_model`.
    candidates.push('Xenova/all-MiniLM-L6-v2')
    candidates.push('Xenova/paraphrase-MiniLM-L6-v2')

    const transformers = await import('@xenova/transformers')
    ensurePrivateDir(TRANSFORMERS_CACHE)
    transformers.env.cacheDir = TRANSFORMERS_CACHE

    let lastErr: any = null
    for (const model of candidates) {
      try {
        // feature-extraction + mean pooling produces fixed-size sentence embeddings.
        return await transformers.pipeline('feature-extraction', model, {
          pooling: 'mean',
          normalize: true,
        })
      } catch (err) {
        lastErr = err
      }
    }

    throw lastErr || new Error('Failed to initialize Transformers embeddings pipeline')
  })()

  return transformersPipelinePromise
}

function toNumberArray(value: any): number[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(v => Number(v))
  if (typeof value?.tolist === 'function') return value.tolist().map((v: any) => Number(v))
  if (value?.data) {
    const data = value.data
    if (Array.isArray(data)) return data.map((v: any) => Number(v))
    if (typeof data.length === 'number') return Array.from(data).map((v: any) => Number(v))
  }
  if (typeof value?.length === 'number') return Array.from(value).map((v: any) => Number(v))
  return []
}

async function embedTransformers(text: string): Promise<number[]> {
  const pipeline = await getTransformersPipeline()

  // Transformers.js pipeline outputs a tensor-like object.
  const out = await pipeline(text, { pooling: 'mean', normalize: true })
  const embedding = toNumberArray(out?.data ?? out)

  if (!embedding.length) {
    throw new Error('Transformers embedding produced an empty vector')
  }
  return embedding
}

type EmbedTier = 'openai' | 'ollama' | 'transformers' | 'pseudo'
let resolvedTier: EmbedTier | null = null

export async function detectAvailableEmbeddingBackend(): Promise<{
  tier: EmbedTier
  label: string
}> {
  const config = getConfig()

  if (config.openai_api_key) {
    try {
      await embedOpenAI('kontxt healthcheck', config.openai_api_key)
      return { tier: 'openai', label: 'openai (text-embedding-3-small)' }
    } catch {
      // Continue to honest fallback detection below.
    }
  }

  try {
    await embedTransformers('kontxt healthcheck')
    return {
      tier: 'transformers',
      label: 'offline semantic (Transformers.js — all-MiniLM-L6-v2; models cache in ~/.kontxt/models)',
    }
  } catch {
    // first-run download/network/model init may fail
  }

  if (await isOllamaRunning()) {
    try {
      await embedOllama('kontxt healthcheck')
      return { tier: 'ollama', label: 'ollama (local embeddings via running ollama serve)' }
    } catch {
      // Continue to pseudo fallback.
    }
  }

  return {
    tier: 'pseudo',
    label: 'pseudo (weak lexical fallback — add an OpenAI key or configure a working local embedding backend)',
  }
}

export async function embedText(
  text: string
): Promise<{ embedding: number[]; tier: EmbedTier }> {
  const config = getConfig()

  if (config.openai_api_key) {
    try {
      const result = await embedOpenAI(text, config.openai_api_key)
      resolvedTier = 'openai'
      return { embedding: result, tier: 'openai' }
    } catch {
      console.error('  OpenAI embedding failed, falling back...')
    }
  }

  try {
    const result = await embedTransformers(text)
    resolvedTier = 'transformers'
    return { embedding: result, tier: 'transformers' }
  } catch {
    // Optional @xenova/transformers: missing install, first-run download issues, etc.
  }

  if (await isOllamaRunning()) {
    try {
      const result = await embedOllama(text)
      resolvedTier = 'ollama'
      return { embedding: result, tier: 'ollama' }
    } catch {}
  }

  resolvedTier = 'pseudo'
  return { embedding: pseudoEmbed(text), tier: 'pseudo' }
}

export function getActiveTier(): EmbedTier {
  return resolvedTier || 'pseudo'
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const len = Math.min(a.length, b.length)
  const dot = a.slice(0, len).reduce((sum, ai, i) => sum + ai * b[i], 0)
  const magA = Math.sqrt(a.slice(0, len).reduce((s, v) => s + v * v, 0))
  const magB = Math.sqrt(b.slice(0, len).reduce((s, v) => s + v * v, 0))
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
