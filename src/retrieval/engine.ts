import type { Database } from '../storage/db'
import { getAllActiveEntries, getLastSession, incrementAccessCount } from '../storage/db'
import { embedText, cosineSimilarity, isZeroVector } from '../storage/embeddings'
import { scoreEntry } from './scoring'
import type { Config } from '../config'
import type { ContextPacket, Entry } from '../types'

export async function buildContextPacket(
  db: Database.Database,
  project: string,
  taskDescription: string,
  config: Config
): Promise<ContextPacket> {
  const entries = getAllActiveEntries(db, project)

  let taskEmbedding: Float32Array | null = null
  if (taskDescription.trim() && config.openaiKey) {
    try {
      taskEmbedding = await embedText(taskDescription, config.openaiKey)
      if (isZeroVector(taskEmbedding)) taskEmbedding = null
    } catch {
      taskEmbedding = null
    }
  }

  const scored = entries.map(entry => {
    let sim: number | null = null
    if (taskEmbedding && entry.embedding && !isZeroVector(entry.embedding)) {
      sim = cosineSimilarity(taskEmbedding, entry.embedding)
    }
    return { entry, score: scoreEntry(entry, sim) }
  })

  scored.sort((a, b) => b.score - a.score)

  const byType = (type: string, limit: number): Entry[] =>
    scored
      .filter(s => s.entry.type === type)
      .slice(0, limit)
      .map(s => s.entry)

  const focusEntries = byType('focus', 1)
  let blockerEntries = byType('blocker', 3)
  let decisionEntries = byType('decision', 5)
  let factEntries = byType('fact', 5)

  const lastSession = getLastSession(db, project)

  const packet: ContextPacket = {
    project,
    focus: focusEntries[0]?.content ?? null,
    blockers: blockerEntries.map(e => e.content),
    recentDecisions: decisionEntries.map(e => e.content),
    relevantFacts: factEntries.map(e => e.content),
    lastSessionSummary: lastSession?.summary ?? null,
    tokenEstimate: 0,
  }

  packet.tokenEstimate = estimateTokens(packet)

  const maxTokens = config.maxContextTokens ?? 600
  while (packet.tokenEstimate > maxTokens) {
    if (packet.relevantFacts.length > 0) {
      factEntries = factEntries.slice(0, -1)
      packet.relevantFacts = factEntries.map(e => e.content)
    } else if (packet.recentDecisions.length > 0) {
      decisionEntries = decisionEntries.slice(0, -1)
      packet.recentDecisions = decisionEntries.map(e => e.content)
    } else if (packet.blockers.length > 0) {
      blockerEntries = blockerEntries.slice(0, -1)
      packet.blockers = blockerEntries.map(e => e.content)
    } else {
      break
    }
    packet.tokenEstimate = estimateTokens(packet)
  }

  const allIncluded = [...focusEntries, ...blockerEntries, ...decisionEntries, ...factEntries]
  for (const entry of allIncluded) {
    incrementAccessCount(db, entry.id)
  }

  return packet
}

function estimateTokens(packet: ContextPacket): number {
  const text = [
    packet.focus ?? '',
    ...packet.blockers,
    ...packet.recentDecisions,
    ...packet.relevantFacts,
    packet.lastSessionSummary ?? '',
  ].join(' ')
  return Math.ceil(text.split(/\s+/).length * 1.3)
}

export function formatContextPacket(packet: ContextPacket): string {
  const lines: string[] = [`# Context: ${packet.project}`, '']

  if (packet.focus) {
    lines.push(`## Current Focus`, packet.focus, '')
  }

  if (packet.blockers.length > 0) {
    lines.push('## Active Blockers')
    lines.push(...packet.blockers.map(b => `- ${b}`))
    lines.push('')
  }

  if (packet.recentDecisions.length > 0) {
    lines.push('## Recent Decisions')
    lines.push(...packet.recentDecisions.map(d => `- ${d}`))
    lines.push('')
  }

  if (packet.relevantFacts.length > 0) {
    lines.push('## Relevant Facts')
    lines.push(...packet.relevantFacts.map(f => `- ${f}`))
    lines.push('')
  }

  if (packet.lastSessionSummary) {
    lines.push('## Last Session', packet.lastSessionSummary, '')
  }

  lines.push(`_~${packet.tokenEstimate} tokens_`)

  return lines.join('\n')
}
