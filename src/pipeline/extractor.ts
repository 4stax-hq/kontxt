import type { ExtractedItem } from '../types'
import { MIN_CONFIDENCE } from '../constants'
import { prepareLlmInput, resolveAnthropicModel, shouldSkipLlmCall } from '../llm/guards'

const SYSTEM_PROMPT = `You extract durable knowledge from conversations that will help an AI assistant understand a person's situation, goals, and context in future sessions.

This works for ANY domain — coding, business, personal, learning, research, creative work. Extract what matters regardless of topic.

TYPES TO EXTRACT:

identity — who this person is: role, expertise, background, what they're building or doing
  good: "Founder and engineer building 4StaX, an AI memory product, pre-revenue and bootstrapped"
  good: "PhD researcher in computational biology at Stanford, focus on protein folding"
  bad: "is a software engineer" (too generic, not specific to this person)

goal — what they are working toward: specific objectives, targets, timelines
  good: "Targeting 100 paying customers for kontxt by end of Q2 2026"
  good: "Learning Rust to rewrite the performance-critical parts of the data pipeline"
  bad: "wants to improve the product" (not specific enough)

preference — how they like to work, communicate, or make decisions
  good: "Prefers shipping over perfect architecture — will refactor when pain is real"
  good: "Wants direct answers with no preamble, no filler, no restating the question"
  bad: "likes good code" (not actionable)

decision — a choice made with rationale, technical OR personal OR strategic
  good: "Switched from REST to tRPC because nested data shapes caused too many round trips"
  good: "Chose B2B over B2C because enterprise contracts give predictable revenue"
  bad: "decided to use a framework" (no rationale, not specific)

fact — a concrete truth an AI must not contradict or get wrong
  good: "Auth service on port 3001, JWT secret from env SUPABASE_JWT_SECRET"
  good: "Company is 2 co-founders, bootstrapped, no outside investors, 3 paying pilots"
  bad: "has authentication" (too vague)

blocker — something unresolved and actively stuck
  good: "Visa application pending 3 months, blocking the planned move to the US"
  good: "Prisma won't generate correct types for self-referential user-manager relation"
  bad: "having some trouble" (not specific)

progress — something recently completed worth knowing about in future sessions
  good: "Shipped the onboarding flow — completion rate went from 12% to 40%"
  good: "Finished the profile endpoint, all 14 tests passing"
  bad: "made some progress" (not specific)

focus — what they are actively working on right now
  good: "Building the browser extension to capture web conversations for kontxt"
  good: "Preparing pitch deck for seed round, targeting $1.5M"
  bad: "working on stuff" (not specific)

DO NOT EXTRACT:
- Generic advice or explanations the AI gave that aren't specific to this person
- Things obvious about anyone in their field ("developer who writes tests")
- Hypotheticals, options being considered but not chosen, or things explicitly rejected
- Anything fully resolved within this same conversation (debugging steps that worked, etc.)
- Questions the person asked without answers

EFFICIENCY RULES:
- One entry per distinct piece of knowledge. Don't bundle unrelated facts.
- If the same fact appears multiple times, extract it once.
- Prefer specific over general. If you're unsure, omit rather than guess.

Return ONLY a JSON array — no markdown, no preamble, no explanation:
[{"type":"identity|goal|preference|decision|fact|blocker|progress|focus","content":"...","confidence":0.0-1.0}]
Confidence reflects how specific and durable this knowledge is. Omit items below 0.7.
If nothing durable exists, return [].`

function parseResponse(raw: string): ExtractedItem[] {
  const cleaned = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) return []
    try { parsed = JSON.parse(match[0]) } catch { return [] }
  }

  if (!Array.isArray(parsed)) return []

  const validTypes = new Set(['decision', 'fact', 'blocker', 'progress', 'focus', 'identity', 'goal', 'preference'])
  return parsed.filter((item): item is ExtractedItem => (
    item !== null &&
    typeof item === 'object' &&
    typeof item.type === 'string' &&
    validTypes.has(item.type) &&
    typeof item.content === 'string' &&
    item.content.trim().length > 0 &&
    typeof item.confidence === 'number' &&
    item.confidence >= MIN_CONFIDENCE
  )).map(item => ({
    type: item.type,
    content: item.content.trim(),
    confidence: item.confidence,
  }))
}

export async function extractFromText(
  text: string,
  config: { anthropicKey?: string; openaiKey?: string; extractionModel?: string }
): Promise<ExtractedItem[]> {
  const prepared = prepareLlmInput('extract', text)
  if (shouldSkipLlmCall(prepared.text)) return []
  const input = prepared.text

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: resolveAnthropicModel(config.extractionModel),
        max_tokens: prepared.maxOutputTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: input }],
      })
      const content = response.content[0]
      if (content.type !== 'text') return []
      return parseResponse(content.text)
    } catch (err) {
      console.error('[extractor] Anthropic failed:', (err as Error).message)
    }
  }

  if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        max_tokens: prepared.maxOutputTokens,
      })
      return parseResponse(response.choices[0]?.message?.content ?? '')
    } catch (err) {
      console.error('[extractor] OpenAI failed:', (err as Error).message)
    }
  }

  console.warn('[extractor] No API key — set one with: kontxt config set anthropic-key <key>')
  return []
}
