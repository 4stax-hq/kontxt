import type { ExtractedItem } from '../types'
import { MIN_CONFIDENCE, MAX_INPUT_CHARS, EXTRACTION_MODEL_ANTHROPIC, EXTRACTION_MODEL_OPENAI } from '../constants'

const SYSTEM_PROMPT = `You extract durable developer knowledge from AI conversation transcripts.

ONLY extract items that will still matter in a future session — things a developer's
AI agent needs to know to not give wrong or redundant advice.

Extract these types:
- decision: an architectural or technical choice made, always include brief rationale
  good: "switched from REST to tRPC because nested data shapes caused too many round trips"
  bad: "using TypeScript" (too generic, not a decision)
- fact: a concrete truth specific to this project an agent must not contradict
  good: "auth service runs on port 3001, JWT secret from env SUPABASE_JWT_SECRET"
  bad: "the app has authentication" (too vague)
- blocker: an unresolved problem explicitly named
  good: "Prisma won't generate correct type for self-referential user-manager relation"
  bad: "having trouble with Prisma" (too vague)
- progress: something completed this session worth remembering
  good: "finished profile endpoint, all 14 tests passing"
  bad: "made some progress" (not specific)
- focus: what the developer is currently working on right now
  good: "implementing refresh token rotation in auth middleware"
  bad: "working on auth" (too vague)

DO NOT extract:
- Questions the developer asked (not knowledge)
- Generic explanations the AI gave that aren't project-specific
- Things obvious from any codebase (using git, having tests, etc.)
- Debugging steps that were resolved in the same session
- Anything the developer already knew before the session

Return ONLY a JSON array. No markdown, no explanation, no preamble.
[{"type":"decision|fact|blocker|progress|focus","content":"...","confidence":0.0-1.0}]
Omit items with confidence below 0.7.
If nothing durable exists, return [].`

function parseExtractionResponse(raw: string): ExtractedItem[] {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
    if (!arrayMatch) return []
    try {
      parsed = JSON.parse(arrayMatch[0])
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  const validTypes = new Set(['decision', 'fact', 'blocker', 'progress', 'focus'])
  return parsed
    .filter((item): item is ExtractedItem => {
      return (
        item !== null &&
        typeof item === 'object' &&
        typeof item.type === 'string' &&
        validTypes.has(item.type) &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0 &&
        typeof item.confidence === 'number' &&
        item.confidence >= MIN_CONFIDENCE
      )
    })
    .map(item => ({
      type: item.type,
      content: item.content.trim(),
      confidence: item.confidence,
    }))
}

export async function extractFromText(
  text: string,
  config: { anthropicKey?: string; openaiKey?: string }
): Promise<ExtractedItem[]> {
  const truncated = text.length > MAX_INPUT_CHARS ? text.slice(-MAX_INPUT_CHARS) : text

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: EXTRACTION_MODEL_ANTHROPIC,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: truncated }],
      })
      const content = response.content[0]
      if (content.type !== 'text') return []
      return parseExtractionResponse(content.text)
    } catch (err) {
      console.error('[extractor] Anthropic extraction failed:', err)
    }
  }

  if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const response = await client.chat.completions.create({
        model: EXTRACTION_MODEL_OPENAI,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: truncated },
        ],
        max_tokens: 1024,
      })
      const text = response.choices[0]?.message?.content ?? ''
      return parseExtractionResponse(text)
    } catch (err) {
      console.error('[extractor] OpenAI extraction failed:', err)
    }
  }

  console.warn('[extractor] No API key available. Extraction requires an Anthropic or OpenAI API key.')
  console.warn('[extractor] Set a key with: kontxt config set anthropic-key <key>')
  return []
}
