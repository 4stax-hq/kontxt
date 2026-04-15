import fs from 'fs'
import path from 'path'
import { getDb } from './vault/db.js'
import { ingestLivingMarkdownFile } from './living-md.js'

const CONTEXT_TEMPLATE = `---
kontxt-namespace: wip
kontxt-privacy: private
---

# Current focus

## Current focus

- What you are doing right now

## Active tasks

- [ ] Add the next concrete task

## Blockers

- None listed

## Updated

- Never
`

const DECISIONS_TEMPLATE = `---
kontxt-namespace: work
kontxt-type: decision
kontxt-privacy: private
---

# Decisions

## YYYY-MM-DD — Short title

Context and options considered.

**Decision:** What you chose.
`

const FACTS_TEMPLATE = `---
kontxt-namespace: work
kontxt-type: fact
kontxt-privacy: private
---

# Stable facts

- APIs, env var names, invariants the agent must not contradict
`

const TIMELINE_TEMPLATE = `---
kontxt-namespace: wip
kontxt-type: episodic
kontxt-privacy: private
---

# Timeline

## YYYY-MM-DD

- What changed today (human-readable)
`

export const LIVING_TEMPLATES: Record<string, string> = {
  'CONTEXT.md': CONTEXT_TEMPLATE,
  'DECISIONS.md': DECISIONS_TEMPLATE,
  'FACTS.md': FACTS_TEMPLATE,
  'TIMELINE.md': TIMELINE_TEMPLATE,
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function filePath(repoRoot: string, name: string): string {
  return path.join(repoRoot, '.kontxt', name)
}

export function ensureLivingFile(repoRoot: string, name: string): string {
  const target = filePath(repoRoot, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, LIVING_TEMPLATES[name] || `# ${name.replace(/\.md$/i, '')}\n`, 'utf-8')
  }
  return target
}

function replaceSection(markdown: string, heading: string, body: string): string {
  const normalized = normalizeNewlines(markdown).trimEnd()
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^## ${escaped}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`, 'm')
  if (pattern.test(normalized)) {
    return normalized.replace(pattern, `$1${body.trim()}\n\n`)
  }
  return `${normalized}\n\n## ${heading}\n\n${body.trim()}\n`
}

function appendUniqueBullet(markdown: string, heading: string, text: string, checkbox = false): string {
  const normalized = normalizeNewlines(markdown)
  const bullet = checkbox ? `- [ ] ${text}` : `- ${text}`
  if (normalized.includes(bullet)) return normalized

  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^## ${escaped}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`, 'm')
  if (pattern.test(normalized)) {
    return normalized.replace(pattern, (_, prefix, existing) => {
      const trimmed = String(existing)
        .trim()
        .split('\n')
        .filter((line: string) => {
          const clean = line.trim()
          return clean !== '- [ ] Add the next concrete task' &&
            clean !== '- APIs, env var names, invariants the agent must not contradict'
        })
        .join('\n')
      const next = trimmed ? `${trimmed}\n${bullet}` : bullet
      return `${prefix}${next}\n\n`
    })
  }
  return `${normalized.trimEnd()}\n\n## ${heading}\n\n${bullet}\n`
}

function appendDecision(markdown: string, title: string, decision: string, context?: string): string {
  const normalized = normalizeNewlines(markdown).trimEnd()
  const stamp = `${todayIso()} — ${title}`
  if (normalized.includes(`## ${stamp}`)) return normalized
  const block = [
    `## ${stamp}`,
    '',
    context?.trim() || 'Context not yet recorded.',
    '',
    `**Decision:** ${decision.trim()}`,
  ].join('\n')
  return `${normalized}\n\n${block}\n`
}

function appendTimeline(markdown: string, text: string, date = todayIso()): string {
  const normalized = normalizeNewlines(markdown)
  const bullet = `- ${text}`
  const heading = `## ${date}`
  const escaped = date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^## ${escaped}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`, 'm')

  if (pattern.test(normalized)) {
    return normalized.replace(pattern, (_, prefix, existing) => {
      const trimmed = String(existing).trim()
      if (trimmed.split('\n').includes(bullet)) return `${prefix}${trimmed}\n\n`
      const next = trimmed ? `${trimmed}\n${bullet}` : bullet
      return `${prefix}${next}\n\n`
    })
  }

  return `${normalized.trimEnd()}\n\n${heading}\n\n${bullet}\n`
}

async function ingest(repoRoot: string, absolutePath: string, project?: string) {
  const db = getDb()
  await ingestLivingMarkdownFile(db, repoRoot, absolutePath, { project })
}

export async function setLivingFocus(repoRoot: string, focus: string, project?: string) {
  const target = ensureLivingFile(repoRoot, 'CONTEXT.md')
  let body = fs.readFileSync(target, 'utf-8')
  body = replaceSection(body, 'Current focus', `- ${focus.trim()}`)
  body = replaceSection(body, 'Updated', `- ${todayIso()}`)
  fs.writeFileSync(target, body.trimEnd() + '\n', 'utf-8')
  await ingest(repoRoot, target, project)
  return target
}

export async function addLivingTask(repoRoot: string, task: string, project?: string) {
  const target = ensureLivingFile(repoRoot, 'CONTEXT.md')
  let body = fs.readFileSync(target, 'utf-8')
  body = appendUniqueBullet(body, 'Active tasks', task.trim(), true)
  body = replaceSection(body, 'Updated', `- ${todayIso()}`)
  fs.writeFileSync(target, body.trimEnd() + '\n', 'utf-8')
  await ingest(repoRoot, target, project)
  return target
}

export async function addLivingFact(repoRoot: string, fact: string, project?: string) {
  const target = ensureLivingFile(repoRoot, 'FACTS.md')
  const body = appendUniqueBullet(fs.readFileSync(target, 'utf-8'), 'Stable facts', fact.trim())
  fs.writeFileSync(target, body.trimEnd() + '\n', 'utf-8')
  await ingest(repoRoot, target, project)
  return target
}

export async function addLivingDecision(
  repoRoot: string,
  title: string,
  decision: string,
  context?: string,
  project?: string
) {
  const target = ensureLivingFile(repoRoot, 'DECISIONS.md')
  const body = appendDecision(fs.readFileSync(target, 'utf-8'), title.trim(), decision.trim(), context)
  fs.writeFileSync(target, body.trimEnd() + '\n', 'utf-8')
  await ingest(repoRoot, target, project)
  return target
}

export async function addLivingTimelineNote(repoRoot: string, text: string, project?: string, date?: string) {
  const target = ensureLivingFile(repoRoot, 'TIMELINE.md')
  const body = appendTimeline(fs.readFileSync(target, 'utf-8'), text.trim(), date || todayIso())
  fs.writeFileSync(target, body.trimEnd() + '\n', 'utf-8')
  await ingest(repoRoot, target, project)
  return target
}
