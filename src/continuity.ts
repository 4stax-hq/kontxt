import type { SearchResult } from './types.js'
import { readProjectState } from './project-state.js'
import type { SessionRecord } from './session-state.js'

export type ContinuityMode = 'auto' | 'ask' | 'fresh'
export type ContinuityAction = 'inject' | 'ask' | 'skip'

export interface ContinuityPacket {
  action: ContinuityAction
  confidence: number
  reason: string
  text: string
  preview: string
}

function continuationCue(query: string): boolean {
  return /\b(continue|continuing|pick up|resume|where were we|what changed|what did we do|what's next|status|progress|follow up)\b/i.test(query)
}

function freshCue(query: string): boolean {
  return /\b(fresh start|from scratch|ignore previous|start over|clean slate)\b/i.test(query)
}

function trimList(values: string[], max = 4): string[] {
  return values.map(v => v.trim()).filter(Boolean).slice(0, max)
}

function memoryLines(results: SearchResult[]): string[] {
  return results
    .slice(0, 6)
    .map(({ memory }) => memory.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function buildText(args: {
  project: string
  query: string
  focus: string[]
  tasks: string[]
  blockers: string[]
  timeline: string[]
  decisions: string[]
  facts: string[]
  memories: string[]
}): string {
  const sections: string[] = []
  sections.push(`KONTXT CONTINUITY SUMMARY`)
  sections.push(`Project: ${args.project}`)
  sections.push(`Task: ${args.query}`)
  sections.push(`Use only if relevant. If the user wants a clean start, ignore all prior context.`)

  if (args.focus.length) {
    sections.push(`Current focus:\n${args.focus.map(item => `- ${item}`).join('\n')}`)
  }
  if (args.tasks.length) {
    sections.push(`Active tasks:\n${args.tasks.map(item => `- ${item}`).join('\n')}`)
  }
  if (args.blockers.length && !args.blockers.every(item => /none listed/i.test(item))) {
    sections.push(`Blockers:\n${args.blockers.map(item => `- ${item}`).join('\n')}`)
  }
  if (args.timeline.length) {
    sections.push(`Recent timeline:\n${args.timeline.map(item => `- ${item}`).join('\n')}`)
  }
  if (args.decisions.length) {
    sections.push(`Recent decisions:\n${args.decisions.map(item => `- ${item}`).join('\n')}`)
  }
  if (args.facts.length) {
    sections.push(`Critical facts:\n${args.facts.map(item => `- ${item}`).join('\n')}`)
  }
  if (args.memories.length) {
    sections.push(`Other relevant memory:\n${args.memories.map(item => `- ${item}`).join('\n')}`)
  }

  return sections.join('\n\n')
}

export function prepareContinuityPacket(args: {
  repoRoot?: string
  project: string
  query: string
  mode: ContinuityMode
  results: SearchResult[]
  session: SessionRecord | null
}): ContinuityPacket {
  const snapshot = args.repoRoot ? readProjectState(args.repoRoot) : {
    repoRoot: '',
    focus: [],
    tasks: [],
    blockers: [],
    facts: [],
    decisions: [],
    timeline: [],
  }

  const focus = trimList(snapshot.focus, 2)
  const tasks = trimList(snapshot.tasks, 5)
  const blockers = trimList(snapshot.blockers, 3)
  const timeline = trimList(snapshot.timeline, 5)
  const facts = trimList(snapshot.facts, 5)
  const decisions = trimList(snapshot.decisions.map(entry => entry.decision ? `${entry.title}: ${entry.decision}` : entry.title), 4)
  const memories = trimList(memoryLines(args.results), 5)

  const topScore = args.results[0]?.score || 0
  const hasProjectState = focus.length > 0 || tasks.length > 0 || timeline.length > 0 || decisions.length > 0
  const hasSessionHistory = Boolean(args.session?.last_ended_at)
  const wantsFresh = freshCue(args.query) || args.mode === 'fresh'
  const wantsContinuation = continuationCue(args.query)

  let action: ContinuityAction = 'skip'
  let reason = 'No strong continuity signal'
  let confidence = Math.max(0, Math.min(1, topScore))

  if (wantsFresh) {
    action = 'skip'
    reason = 'Fresh-start mode requested'
    confidence = 1
  } else if (args.mode === 'ask') {
    action = hasProjectState || memories.length ? 'ask' : 'skip'
    reason = action === 'ask' ? 'Context found; ask before injecting' : 'No useful context found'
  } else if (
    wantsContinuation ||
    topScore >= 0.42 ||
    (topScore >= 0.28 && hasProjectState) ||
    (hasSessionHistory && (hasProjectState || topScore >= 0.22))
  ) {
    action = 'inject'
    reason = wantsContinuation ? 'Continuation cue detected' : 'Relevant project context found'
  } else if (hasProjectState && topScore >= 0.18) {
    action = 'ask'
    reason = 'Project context exists but confidence is moderate'
  }

  const text = buildText({
    project: args.project,
    query: args.query,
    focus,
    tasks,
    blockers,
    timeline: args.session?.last_ended_at ? timeline.filter(Boolean) : timeline,
    decisions,
    facts,
    memories,
  })

  const previewLines = [
    ...focus.slice(0, 1),
    ...timeline.slice(-2),
    ...decisions.slice(-1),
    ...memories.slice(0, 2),
  ].filter(Boolean)

  return {
    action,
    confidence,
    reason,
    text,
    preview: previewLines.join(' | ').slice(0, 240),
  }
}
