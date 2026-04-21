import type { Entry } from '../types'

const TYPE_PRIORITY: Record<string, number> = {
  focus: 1.0,
  blocker: 0.9,
  decision: 0.8,
  progress: 0.6,
  fact: 0.5,
}

export function recencyScore(updatedAt: string): number {
  const daysSince = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  return Math.exp(-daysSince / 30)
}

export function typePriority(type: string): number {
  return TYPE_PRIORITY[type] ?? 0.5
}

export function scoreEntry(
  entry: Entry,
  semanticSim: number | null
): number {
  const recency = recencyScore(entry.updatedAt)
  const priority = typePriority(entry.type)

  if (semanticSim !== null) {
    return semanticSim * 0.5 + recency * 0.3 + priority * 0.2
  }

  return recency * 0.6 + priority * 0.4
}
