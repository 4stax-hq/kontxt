import type { Database } from '../storage/db'
import { getAllActiveEntries, getSynthesis, upsertSynthesis, countActiveEntries } from '../storage/db'

const GLOBAL_PROJECT = '__global__'
import type { Config } from '../config'
import type { Entry } from '../types'

// Synthesize when there are enough entries to warrant it
const SYNTHESIS_THRESHOLD = 8

const USER_PROFILE_PROMPT = `You are building a concise, rich profile of a person from accumulated knowledge entries.
Synthesize these entries into 3-5 sentences that capture who this person is, what they are building or working toward, and how they operate.
Write in third person. Be specific — use real names, real goals, real constraints.
This profile will be injected at the top of every AI session this person has, so make it immediately useful to an AI assistant.
Do not use bullet points. Write a coherent paragraph.`

const PROJECT_PROMPT = `You are summarizing the accumulated knowledge about a software project.
Synthesize these entries into a compact paragraph (4-6 sentences) covering:
- What the project is and does
- Key architectural decisions made and why
- Current state (what's done, what's blocked, what's in focus)
- Critical facts any AI agent must know (ports, env vars, patterns, constraints)
Write it as context an AI needs at the start of a session on this project. Be specific.`

async function callLlm(
  prompt: string,
  content: string,
  config: Config
): Promise<string | null> {
  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: config.extractionModel ?? 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: prompt,
        messages: [{ role: 'user', content }],
      })
      const block = response.content[0]
      return block.type === 'text' ? block.text.trim() : null
    } catch { return null }
  }
  if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const res = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content },
        ],
      })
      return res.choices[0]?.message?.content?.trim() ?? null
    } catch { return null }
  }
  return null
}

function formatEntriesForSynthesis(entries: Entry[]): string {
  return entries
    .map(e => `[${e.type}] ${e.content}`)
    .join('\n')
}

// ─── user profile synthesis ───────────────────────────────────────────────────

export async function synthesizeUserProfile(
  db: Database.Database,
  config: Config,
  force = false
): Promise<string | null> {
  const entryCount = countActiveEntries(db, GLOBAL_PROJECT)

  if (entryCount < SYNTHESIS_THRESHOLD) return null

  if (!force) {
    const cached = getSynthesis(db, GLOBAL_PROJECT)
    if (cached && Math.abs(cached.entrySnapshot - entryCount) < 5) {
      return cached.content
    }
  }

  // All global entries live in __global__ project with scope='global'
  const entries = getAllActiveEntries(db, GLOBAL_PROJECT).slice(0, 30)
  if (entries.length === 0) return null

  const synthesis = await callLlm(USER_PROFILE_PROMPT, formatEntriesForSynthesis(entries), config)
  if (!synthesis) return null

  upsertSynthesis(db, GLOBAL_PROJECT, synthesis, entryCount)
  return synthesis
}

// ─── project synthesis ────────────────────────────────────────────────────────

export async function synthesizeProject(
  db: Database.Database,
  project: string,
  config: Config,
  force = false
): Promise<string | null> {
  const entryCount = countActiveEntries(db, project)

  if (entryCount < SYNTHESIS_THRESHOLD) return null

  if (!force) {
    const cached = getSynthesis(db, project)
    if (cached && Math.abs(cached.entrySnapshot - entryCount) < 5) {
      return cached.content
    }
  }

  const entries = getAllActiveEntries(db, project).slice(0, 40)
  if (entries.length === 0) return null

  const synthesis = await callLlm(PROJECT_PROMPT, formatEntriesForSynthesis(entries), config)
  if (!synthesis) return null

  upsertSynthesis(db, project, synthesis, entryCount)
  return synthesis
}

// ─── staleness check ──────────────────────────────────────────────────────────

export function isStale(entry: Entry): boolean {
  const daysSince = (Date.now() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  if (entry.type === 'blocker')  return daysSince > 45
  if (entry.type === 'focus')    return daysSince > 14
  if (entry.type === 'progress') return daysSince > 90
  return false
}

export function staleLabel(entry: Entry): string {
  const days = Math.floor((Date.now() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
  return ` (${days}d old — may be resolved)`
}
