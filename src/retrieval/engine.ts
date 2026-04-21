import type { Database } from '../storage/db'
import {
  getAllActiveEntries,
  getLastSession,
  incrementAccessCount,
  getSynthesis,
  countActiveEntries,
  getCrossProjectEntries,
} from '../storage/db'
import { embedText, cosineSimilarity, isZeroVector } from '../storage/embeddings'
import { scoreEntry } from './scoring'
import { synthesizeUserProfile, synthesizeProject, isStale, staleLabel } from '../pipeline/synthesizer'
import type { Config } from '../config'
import type { ContextPacket, Entry } from '../types'

const GLOBAL_PROJECT = '__global__'

// ─── context assembly ─────────────────────────────────────────────────────────
//
// Single source of truth: ~/.kontxt/vault.db
// All knowledge — personal, professional, every project — lives in one DB.
// The context packet is a ranked window into that DB, assembled in four tiers:
//
//   Tier 1  User profile   — who the person is, their goals, preferences
//                            synthesized into a paragraph once enough entries exist
//   Tier 2  Project state  — focus, blockers, decisions, facts for THIS project
//                            also synthesized into a paragraph once mature
//   Tier 3  Cross-project  — relevant knowledge from OTHER projects in the DB
//                            surfaces automatically when semantically relevant
//   Tier 4  Session        — last session summary
//
// Token budget enforced throughout. Profile and focus protected last.

export async function buildContextPacket(
  db: Database.Database,
  project: string,
  taskDescription: string,
  config: Config
): Promise<ContextPacket> {
  const maxTokens = config.maxContextTokens ?? 800

  // ── embedding for semantic ranking ───────────────────────────────────────
  // Used for both project entries AND cross-project search
  const queryText = taskDescription.trim() || undefined
  let taskEmbedding: Float32Array | null = null
  if (queryText && config.openaiKey) {
    try {
      const emb = await embedText(queryText, config.openaiKey)
      if (!isZeroVector(emb)) taskEmbedding = emb
    } catch {}
  }

  const semScore = (entry: Entry): number | null => {
    if (!taskEmbedding || !entry.embedding || isZeroVector(entry.embedding)) return null
    return cosineSimilarity(taskEmbedding, entry.embedding)
  }

  // ── tier 1: user profile ──────────────────────────────────────────────────
  let userProfile: string[] = []
  const globalCount = countActiveEntries(db, GLOBAL_PROJECT)

  if (globalCount >= 8) {
    const synthesis = await synthesizeUserProfile(db, config)
    if (synthesis) {
      userProfile = [synthesis]
    }
  }

  if (userProfile.length === 0) {
    // Not enough entries yet or synthesis failed — show raw global entries
    const globalEntries = getAllActiveEntries(db, GLOBAL_PROJECT).slice(0, 6)
    userProfile = globalEntries.map(e => `[${e.type}] ${e.content}`)
  }

  // ── tier 2: project knowledge ─────────────────────────────────────────────
  const projectEntries = getAllActiveEntries(db, project)

  const scored = projectEntries
    .map(e => ({ entry: e, score: scoreEntry(e, semScore(e)) }))
    .sort((a, b) => b.score - a.score)

  const byType = (type: string, limit: number): Entry[] =>
    scored.filter(s => s.entry.type === type).slice(0, limit).map(s => s.entry)

  const annotate = (e: Entry): string =>
    isStale(e) ? `${e.content} ${staleLabel(e)}` : e.content

  const focusEntries    = byType('focus',    1)
  let blockerEntries    = byType('blocker',  4)
  let decisionEntries   = byType('decision', 6)
  let factEntries       = byType('fact',     6)

  // Project synthesis — prepended as the first "fact" when mature
  const projectSynthesis = projectEntries.length >= 8 ? getSynthesis(db, project) : null

  // ── tier 3: cross-project context ─────────────────────────────────────────
  // Pull entries from other projects that are relevant to current task/project.
  // Only activated when we have semantic search or can use keyword overlap.
  let crossProjectItems: Array<{ content: string; project: string }> = []

  const crossEntries = getCrossProjectEntries(db, project, ['decision', 'fact'])

  if (taskEmbedding && crossEntries.length > 0) {
    // Semantic: find cross-project entries relevant to this task
    const CROSS_THRESHOLD = 0.72
    const crossScored = crossEntries
      .filter(e => e.embedding && !isZeroVector(e.embedding))
      .map(e => ({ e, sim: cosineSimilarity(taskEmbedding!, e.embedding!) }))
      .filter(({ sim }) => sim >= CROSS_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)

    crossProjectItems = crossScored.map(({ e }) => ({
      content: `[from ${e.project}] ${e.content}`,
      project: e.project,
    }))
  } else if (queryText && crossEntries.length > 0) {
    // Keyword fallback: token overlap between task description and cross-project entries
    const queryTokens = tokenize(queryText)
    const KEYWORD_THRESHOLD = 0.25
    const crossScored = crossEntries
      .map(e => ({ e, sim: jaccardWithSet(queryTokens, e.content) }))
      .filter(({ sim }) => sim >= KEYWORD_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 2)

    crossProjectItems = crossScored.map(({ e }) => ({
      content: `[from ${e.project}] ${e.content}`,
      project: e.project,
    }))
  }

  // ── assemble packet ───────────────────────────────────────────────────────
  const lastSession = getLastSession(db, project)

  let facts = factEntries.map(e => e.content)
  if (projectSynthesis) {
    facts = [projectSynthesis.content, ...facts.slice(0, 4)]
  }

  const packet: ContextPacket = {
    project,
    userProfile,
    focus:              focusEntries[0] ? annotate(focusEntries[0]) : null,
    blockers:           blockerEntries.map(annotate),
    recentDecisions:    decisionEntries.map(e => e.content),
    relevantFacts:      [...facts, ...crossProjectItems.map(c => c.content)],
    lastSessionSummary: lastSession?.summary ?? null,
    tokenEstimate:      0,
  }

  packet.tokenEstimate = estimateTokens(packet)

  // ── trim to budget ────────────────────────────────────────────────────────
  // Trim order: cross-project → facts → decisions → blockers → profile (never fully removed)
  while (packet.tokenEstimate > maxTokens) {
    if (crossProjectItems.length > 0) {
      crossProjectItems = crossProjectItems.slice(0, -1)
      const base = projectSynthesis ? [projectSynthesis.content, ...factEntries.map(e => e.content).slice(0, 4)] : factEntries.map(e => e.content)
      packet.relevantFacts = [...base, ...crossProjectItems.map(c => c.content)]
    } else if (packet.relevantFacts.length > (projectSynthesis ? 1 : 0)) {
      factEntries = factEntries.slice(0, -1)
      const base = projectSynthesis ? [projectSynthesis.content, ...factEntries.map(e => e.content).slice(0, 4)] : factEntries.map(e => e.content)
      packet.relevantFacts = base
    } else if (packet.recentDecisions.length > 0) {
      decisionEntries = decisionEntries.slice(0, -1)
      packet.recentDecisions = decisionEntries.map(e => e.content)
    } else if (packet.blockers.length > 1) {
      blockerEntries = blockerEntries.slice(0, -1)
      packet.blockers = blockerEntries.map(annotate)
    } else if (packet.userProfile.length > 1) {
      packet.userProfile = packet.userProfile.slice(0, -1)
    } else {
      break
    }
    packet.tokenEstimate = estimateTokens(packet)
  }

  // Track access
  const allIncluded = [...focusEntries, ...blockerEntries, ...decisionEntries, ...factEntries]
  for (const entry of allIncluded) incrementAccessCount(db, entry.id)

  return packet
}

// ─── synthesis trigger ────────────────────────────────────────────────────────
// Non-blocking. Called after writes — never holds up the response.

export function triggerSynthesisIfNeeded(
  db: Database.Database,
  project: string,
  config: Config
): void {
  if (countActiveEntries(db, project) >= 8) {
    synthesizeProject(db, project, config).catch(() => {})
  }
  if (countActiveEntries(db, GLOBAL_PROJECT) >= 8) {
    synthesizeUserProfile(db, config).catch(() => {})
  }
}

// ─── token estimation ─────────────────────────────────────────────────────────

function estimateTokens(packet: ContextPacket): number {
  const text = [
    ...packet.userProfile,
    packet.focus ?? '',
    ...packet.blockers,
    ...packet.recentDecisions,
    ...packet.relevantFacts,
    packet.lastSessionSummary ?? '',
  ].join(' ')
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3)
}

// ─── keyword helpers ──────────────────────────────────────────────────────────

const STOP = new Set(['the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','to','of','in','on','at','by','for',
  'with','and','or','but','not','this','that','it','its','i','we','they','from','as'])

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t => t.length > 2 && !STOP.has(t)))
}

function jaccardWithSet(queryTokens: Set<string>, text: string): number {
  const textTokens = tokenize(text)
  const intersection = [...queryTokens].filter(t => textTokens.has(t)).length
  const union = new Set([...queryTokens, ...textTokens]).size
  return union === 0 ? 0 : intersection / union
}

// ─── formatting ───────────────────────────────────────────────────────────────

export function formatContextPacket(packet: ContextPacket): string {
  const lines: string[] = [`# ${packet.project}`, '']

  if (packet.userProfile.length > 0) {
    lines.push('## About You')
    if (packet.userProfile.length === 1 && packet.userProfile[0].length > 120) {
      lines.push(packet.userProfile[0])
    } else {
      lines.push(...packet.userProfile.map(p => `- ${p}`))
    }
    lines.push('')
  }

  if (packet.focus) {
    lines.push('## Current Focus', packet.focus, '')
  }

  if (packet.blockers.length > 0) {
    lines.push('## Active Blockers')
    lines.push(...packet.blockers.map(b => `- ${b}`))
    lines.push('')
  }

  if (packet.recentDecisions.length > 0) {
    lines.push('## Decisions')
    lines.push(...packet.recentDecisions.map(d => `- ${d}`))
    lines.push('')
  }

  if (packet.relevantFacts.length > 0) {
    const [first, ...rest] = packet.relevantFacts
    if (first && first.length > 200 && !first.startsWith('[from ')) {
      lines.push('## Project Context', first, '')
      if (rest.length > 0) {
        lines.push('## Key Facts')
        lines.push(...rest.map(f => `- ${f}`))
        lines.push('')
      }
    } else {
      lines.push('## Key Facts')
      lines.push(...packet.relevantFacts.map(f => `- ${f}`))
      lines.push('')
    }
  }

  if (packet.lastSessionSummary) {
    lines.push('## Last Session', packet.lastSessionSummary, '')
  }

  lines.push(`_~${packet.tokenEstimate} tokens_`)
  return lines.join('\n')
}
