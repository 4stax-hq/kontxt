import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { EXTRACTION_MODEL_ANTHROPIC, KONTXT_DIR } from '../constants'

const REQUEST_CACHE_PATH = path.join(KONTXT_DIR, 'request-cache.json')

const MODEL_ALIASES = new Map<string, string>([
  ['claude-3-5-haiku-latest', EXTRACTION_MODEL_ANTHROPIC],
  ['claude-3-haiku-20240307', EXTRACTION_MODEL_ANTHROPIC],
  ['claude-haiku-4-5-20251001', EXTRACTION_MODEL_ANTHROPIC],
])

const MAX_INPUT_CHARS: Record<RequestKind, number> = {
  extract: 7000,
  refresh: 7000,
  auto_refresh: 2500,
  init: 12000,
  synthesis: 5000,
  session: 2500,
}

const MAX_OUTPUT_TOKENS: Record<RequestKind, number> = {
  extract: 700,
  refresh: 900,
  auto_refresh: 220,
  init: 1200,
  synthesis: 300,
  session: 180,
}

export type RequestKind = 'extract' | 'refresh' | 'auto_refresh' | 'init' | 'synthesis' | 'session'

interface RequestCache {
  lastHashByScope: Record<string, string>
}

export function resolveAnthropicModel(model?: string): string {
  const requested = (model ?? EXTRACTION_MODEL_ANTHROPIC).trim()
  if (!requested) return EXTRACTION_MODEL_ANTHROPIC
  return MODEL_ALIASES.get(requested) ?? requested
}

export function prepareLlmInput(kind: RequestKind, text: string): {
  text: string
  maxOutputTokens: number
  truncated: boolean
} {
  const normalized = text.trim()
  const maxChars = MAX_INPUT_CHARS[kind]
  if (normalized.length <= maxChars) {
    return { text: normalized, maxOutputTokens: MAX_OUTPUT_TOKENS[kind], truncated: false }
  }

  const head = Math.floor(maxChars * 0.35)
  const tail = maxChars - head
  return {
    text: normalized.slice(0, head) + '\n\n[...]\n\n' + normalized.slice(-tail),
    maxOutputTokens: MAX_OUTPUT_TOKENS[kind],
    truncated: true,
  }
}

export function shouldSkipLlmCall(text: string, minChars = 80): boolean {
  return text.trim().length < minChars
}

export function isRepeatedRequest(scope: string, content: string): boolean {
  const cache = readRequestCache()
  return cache.lastHashByScope[scope] === hash(content)
}

export function rememberRequest(scope: string, content: string): void {
  const cache = readRequestCache()
  cache.lastHashByScope[scope] = hash(content)
  writeRequestCache(cache)
}

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)
}

function readRequestCache(): RequestCache {
  try {
    return JSON.parse(fs.readFileSync(REQUEST_CACHE_PATH, 'utf-8')) as RequestCache
  } catch {
    return { lastHashByScope: {} }
  }
}

function writeRequestCache(cache: RequestCache): void {
  try {
    if (!fs.existsSync(KONTXT_DIR)) fs.mkdirSync(KONTXT_DIR, { recursive: true })
    fs.writeFileSync(REQUEST_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8')
  } catch {}
}
