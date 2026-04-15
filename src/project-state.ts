import fs from 'fs'
import path from 'path'

export interface DecisionEntry {
  title: string
  decision?: string
}

export interface ProjectStateSnapshot {
  repoRoot: string
  focus: string[]
  tasks: string[]
  blockers: string[]
  facts: string[]
  decisions: DecisionEntry[]
  timeline: string[]
}

function readIfExists(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return ''
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function sectionBody(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalize(markdown).match(new RegExp(`^## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'))
  return match?.[1]?.trim() || ''
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function bullets(block: string): string[] {
  return block
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.replace(/^- \[ \]\s*/, '').replace(/^- /, '').trim())
    .filter(Boolean)
    .filter(line =>
      line !== 'Add the next concrete task' &&
      line !== 'APIs, env var names, invariants the agent must not contradict' &&
      line !== 'What changed today (human-readable).' &&
      line !== 'None listed'
    )
}

function parseFacts(markdown: string): string[] {
  const body = sectionBody(markdown, 'Stable facts')
  return bullets(body)
}

function parseContext(markdown: string) {
  return {
    focus: bullets(sectionBody(markdown, 'Current focus')),
    tasks: bullets(sectionBody(markdown, 'Active tasks')),
    blockers: bullets(sectionBody(markdown, 'Blockers')),
  }
}

function parseDecisions(markdown: string): DecisionEntry[] {
  const normalized = normalize(markdown)
  const matches = Array.from(normalized.matchAll(/^## ([^\n]+)\n\n([\s\S]*?)(?=^## |\s*$)/gm))
  return matches
    .map(match => {
      const title = match[1].trim()
      if (title === 'YYYY-MM-DD — Short title') return null
      const body = match[2].trim()
      const decisionMatch = body.match(/\*\*Decision:\*\*\s*(.+)/)
      return {
        title,
        decision: decisionMatch?.[1]?.trim(),
      }
    })
    .filter(Boolean) as DecisionEntry[]
}

function parseTimeline(markdown: string): string[] {
  const normalized = normalize(markdown)
  const matches = Array.from(normalized.matchAll(/^## ([0-9]{4}-[0-9]{2}-[0-9]{2})\n\n([\s\S]*?)(?=^## |\s*$)/gm))
  const notes: string[] = []
  for (const match of matches.slice(-5)) {
    const date = match[1]
    const items = bullets(match[2]).map(item => `${date}: ${item}`)
    notes.push(...items)
  }
  return notes.slice(-8)
}

export function readProjectState(repoRoot: string): ProjectStateSnapshot {
  const context = readIfExists(path.join(repoRoot, '.kontxt', 'CONTEXT.md'))
  const facts = readIfExists(path.join(repoRoot, '.kontxt', 'FACTS.md'))
  const decisions = readIfExists(path.join(repoRoot, '.kontxt', 'DECISIONS.md'))
  const timeline = readIfExists(path.join(repoRoot, '.kontxt', 'TIMELINE.md'))

  const ctx = parseContext(context)
  return {
    repoRoot,
    focus: ctx.focus.slice(0, 3),
    tasks: ctx.tasks.slice(0, 6),
    blockers: ctx.blockers.slice(0, 4),
    facts: parseFacts(facts).slice(0, 8),
    decisions: parseDecisions(decisions).slice(-6),
    timeline: parseTimeline(timeline),
  }
}
