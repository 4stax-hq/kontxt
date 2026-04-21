import * as fs from 'fs'
import * as path from 'path'
import type { Database } from './db'
import { getAllActiveEntries, getLastSession } from './db'
import type { Entry } from '../types'
import { MD_DIR_NAME, CONTEXT_MD, DECISIONS_MD, FACTS_MD, TIMELINE_MD, KONTXT_DIR } from '../constants'

function getMdDir(workspacePath: string): string {
  if (!workspacePath) {
    return KONTXT_DIR
  }
  return path.join(workspacePath, MD_DIR_NAME)
}

function ensureMdDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function writeAtomic(filePath: string, content: string): void {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, filePath)
}

export function regenerateMdFiles(db: Database.Database, project: string, workspacePath: string): void {
  const dir = getMdDir(workspacePath)
  ensureMdDir(dir)
  writeContextMd(db, project, dir)
  writeDecisionsMd(db, project, dir)
  writeFactsMd(db, project, dir)
  writeTimelineMd(db, project, dir)
}

function writeContextMd(db: Database.Database, project: string, dir: string): void {
  const entries = getAllActiveEntries(db, project)
  const now = new Date().toISOString()

  const focusEntries    = entries.filter(e => e.type === 'focus')
  const blockerEntries  = entries.filter(e => e.type === 'blocker').slice(0, 3)
  const decisionEntries = entries.filter(e => e.type === 'decision').slice(0, 5)
  const factEntries     = entries.filter(e => e.type === 'fact').sort((a, b) => b.accessCount - a.accessCount).slice(0, 5)
  const goalEntries     = entries.filter(e => e.type === 'goal').slice(0, 3)
  const identityEntries = entries.filter(e => e.type === 'identity').slice(0, 2)

  const lastSession = getLastSession(db, project)

  const focus = focusEntries.length > 0 ? focusEntries[0].content : 'not set'

  let md = `# ${project}\n\n`

  if (identityEntries.length > 0 || goalEntries.length > 0) {
    if (identityEntries.length > 0) {
      md += `## identity\n${identityEntries.map(e => e.content).join('\n')}\n\n`
    }
    if (goalEntries.length > 0) {
      md += `## goals\n${goalEntries.map(e => `- ${e.content}`).join('\n')}\n\n`
    }
  }

  md += `## focus\n${focus}\n\n`

  md += `## active blockers\n`
  if (blockerEntries.length > 0) {
    md += blockerEntries.map(e => `- ${e.content}`).join('\n') + '\n'
  } else {
    md += '_none_\n'
  }
  md += '\n'

  md += `## recent decisions\n`
  if (decisionEntries.length > 0) {
    md += decisionEntries.map(e => `- ${e.content}`).join('\n') + '\n'
  } else {
    md += '_none_\n'
  }
  md += '\n'

  md += `## relevant facts\n`
  if (factEntries.length > 0) {
    md += factEntries.map(e => `- ${e.content}`).join('\n') + '\n'
  } else {
    md += '_none_\n'
  }
  md += '\n'

  if (lastSession?.summary) {
    md += `## last session\n${lastSession.summary}\n\n`
  }

  md += `_updated: ${now}_\n`

  writeAtomic(path.join(dir, CONTEXT_MD), md)
}

function writeDecisionsMd(db: Database.Database, project: string, dir: string): void {
  const entries = getAllActiveEntries(db, project)
    .filter(e => e.type === 'decision')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  let md = `# Decisions — ${project}\n\n`

  if (entries.length === 0) {
    md += '_No decisions recorded yet._\n'
  } else {
    for (const entry of entries) {
      const date = entry.createdAt.slice(0, 10)
      md += `## ${date}\n${entry.content}\n\n`
    }
  }

  writeAtomic(path.join(dir, DECISIONS_MD), md)
}

const FACT_CATEGORIES: { label: string; keywords: string[] }[] = [
  { label: 'auth', keywords: ['auth', 'jwt', 'token', 'oauth', 'session', 'login', 'password', 'credential'] },
  { label: 'database', keywords: ['db', 'database', 'sql', 'postgres', 'mysql', 'sqlite', 'prisma', 'supabase', 'mongo', 'redis'] },
  { label: 'infra', keywords: ['port', 'env', 'docker', 'kubernetes', 'k8s', 'deploy', 'ci', 'aws', 'gcp', 'azure', 'server', 'host'] },
  { label: 'api', keywords: ['api', 'endpoint', 'route', 'rest', 'graphql', 'trpc', 'grpc', 'webhook'] },
  { label: 'frontend', keywords: ['ui', 'react', 'vue', 'svelte', 'component', 'css', 'tailwind', 'next', 'vite'] },
]

function categorizeFact(content: string): string {
  const lower = content.toLowerCase()
  for (const cat of FACT_CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) {
      return cat.label
    }
  }
  return 'general'
}

function writeFactsMd(db: Database.Database, project: string, dir: string): void {
  const entries = getAllActiveEntries(db, project).filter(e => e.type === 'fact')

  let md = `# Facts — ${project}\n\n`

  if (entries.length === 0) {
    md += '_No facts recorded yet._\n'
    writeAtomic(path.join(dir, FACTS_MD), md)
    return
  }

  const grouped = new Map<string, Entry[]>()
  for (const entry of entries) {
    const cat = categorizeFact(entry.content)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(entry)
  }

  const sortedCategories = ['auth', 'database', 'infra', 'api', 'frontend', 'general']
    .filter(cat => grouped.has(cat))

  for (const cat of sortedCategories) {
    const catEntries = grouped.get(cat)!
    md += `## ${cat}\n`
    md += catEntries.map(e => `- ${e.content}`).join('\n') + '\n\n'
  }

  writeAtomic(path.join(dir, FACTS_MD), md)
}

function writeTimelineMd(db: Database.Database, project: string, dir: string): void {
  const sessions = db.prepare(`
    SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC
  `).all(project) as Array<{
    id: string
    project: string
    started_at: string
    ended_at: string | null
    summary: string | null
    entry_count: number
  }>

  let md = `# Timeline — ${project}\n\n`

  if (sessions.length === 0) {
    md += '_No sessions recorded yet._\n'
  } else {
    for (const s of sessions) {
      const date = s.started_at.slice(0, 10)
      md += `## ${date}\n`
      if (s.summary) {
        md += `${s.summary}\n`
      }
      md += `_${s.entry_count} entries captured_\n\n`
    }
  }

  writeAtomic(path.join(dir, TIMELINE_MD), md)
}
