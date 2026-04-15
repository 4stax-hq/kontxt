import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import type Database from 'better-sqlite3'
import type { MemoryType, PrivacyLevel } from './types.js'
import { deleteMemoriesWithSourcePrefix, insertMemory } from './vault/db.js'
import { embedText } from './vault/embed.js'

/** Tracked filenames (basename) and default memory types. */
export const LIVING_MD_FILES: Record<string, MemoryType> = {
  'CONTEXT.md': 'project',
  'DECISIONS.md': 'decision',
  'FACTS.md': 'fact',
  'TIMELINE.md': 'episodic',
}

export interface LivingMdFrontmatter {
  namespace?: string
  ttlHours?: number
  typeOverride?: MemoryType
  privacy?: PrivacyLevel
}

const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseSimpleYamlLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
  if (!m) return null
  return { key: m[1], value: m[2].trim() }
}

export function parseLivingMdFrontmatter(raw: string): { frontmatter: LivingMdFrontmatter; body: string } {
  const match = raw.match(FM_BLOCK)
  if (!match) {
    return { frontmatter: {}, body: raw.trim() }
  }
  const block = match[1]
  const body = raw.slice(match[0].length).trim()
  const fm: LivingMdFrontmatter = {}
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parsed = parseSimpleYamlLine(trimmed)
    if (!parsed) continue
    const k = parsed.key.toLowerCase()
    if (k === 'kontxt-namespace') fm.namespace = parsed.value
    else if (k === 'kontxt-ttl') {
      const n = parseInt(parsed.value, 10)
      if (!Number.isNaN(n)) fm.ttlHours = n
    } else if (k === 'kontxt-type') {
      const t = parsed.value as MemoryType
      if (
        ['preference', 'fact', 'project', 'decision', 'skill', 'episodic'].includes(t)
      ) {
        fm.typeOverride = t
      }
    } else if (k === 'kontxt-privacy') {
      const p = parsed.value as PrivacyLevel
      if (['private', 'anonymizable', 'shareable'].includes(p)) fm.privacy = p
    }
  }
  return { frontmatter: fm, body }
}

export function inferLivingMdMemoryType(relPath: string): MemoryType {
  const base = path.basename(relPath)
  if (LIVING_MD_FILES[base]) return LIVING_MD_FILES[base]
  return 'fact'
}

/** Split markdown into chunks by headings and size cap. */
export function chunkMarkdownBody(body: string, maxChars = 1800): string[] {
  const lines = body.split(/\r?\n/)
  const chunks: string[] = []
  let current: string[] = []
  let currentLen = 0

  const flush = () => {
    const t = current.join('\n').trim()
    if (t) chunks.push(t)
    current = []
    currentLen = 0
  }

  for (const line of lines) {
    const isHeading = /^(#{1,6})\s/.test(line)
    if (isHeading && currentLen > 200) flush()

    if (line.length + currentLen > maxChars && currentLen > 400) {
      flush()
    }
    current.push(line)
    currentLen += line.length + 1
  }
  flush()
  return chunks.length ? chunks : body.trim() ? [body.trim()] : []
}

function sourcePrefixForRelPath(relPath: string): string {
  const norm = relPath.split(path.sep).join('/')
  return `living-md:${norm}:`
}

/**
 * Re-ingest a single living markdown file: remove prior chunks for this path, embed and store.
 */
export async function ingestLivingMarkdownFile(
  db: Database.Database,
  repoRoot: string,
  absoluteFilePath: string,
  options: {
    project?: string
    defaultPrivacy?: PrivacyLevel
  } = {}
): Promise<{ chunks: number }> {
  const relPath = path.relative(repoRoot, absoluteFilePath)
  const raw = fs.readFileSync(absoluteFilePath, 'utf-8')
  const { frontmatter, body } = parseLivingMdFrontmatter(raw)
  if (!body.trim()) {
    deleteMemoriesWithSourcePrefix(db, sourcePrefixForRelPath(relPath))
    return { chunks: 0 }
  }

  const memType = frontmatter.typeOverride ?? inferLivingMdMemoryType(relPath)
  const privacy: PrivacyLevel = frontmatter.privacy ?? options.defaultPrivacy ?? 'private'
  const tags: string[] = ['living-md', relPath.split(path.sep).join('/')]
  if (frontmatter.namespace) tags.push(`ns:${frontmatter.namespace}`)

  deleteMemoriesWithSourcePrefix(db, sourcePrefixForRelPath(relPath))

  const chunks = chunkMarkdownBody(body)
  const now = new Date().toISOString()
  let stored = 0
  const prefix = sourcePrefixForRelPath(relPath)

  for (let i = 0; i < chunks.length; i++) {
    const piece = chunks[i]
    const content =
      chunks.length > 1
        ? `[${path.basename(relPath)} §${i + 1}/${chunks.length}]\n${piece}`
        : `[${path.basename(relPath)}]\n${piece}`

    const { embedding, tier } = await embedText(content)
    const id = uuid()
    insertMemory(db, {
      id,
      content,
      summary: content.slice(0, 100),
      source: `${prefix}${i}`,
      type: memType,
      embedding,
      embedding_tier: tier,
      superseded_by: null,
      tags,
      project: options.project,
      related_ids: [],
      privacy_level: privacy,
      importance_score: 0.75,
      access_count: 0,
      created_at: now,
      accessed_at: now,
    })
    stored++
  }

  return { chunks: stored }
}

export function isLivingMdPath(repoRoot: string, absolutePath: string): boolean {
  const rel = path.relative(repoRoot, absolutePath)
  if (rel.startsWith('..')) return false
  const norm = rel.split(path.sep).join('/')
  if (!norm.toLowerCase().endsWith('.md')) return false
  if (norm.startsWith('.kontxt/')) return true
  const base = path.basename(norm)
  return base in LIVING_MD_FILES
}

export function collectLivingMdFiles(repoRoot: string): string[] {
  const out: string[] = []
  const kontxtDir = path.join(repoRoot, '.kontxt')
  if (fs.existsSync(kontxtDir) && fs.statSync(kontxtDir).isDirectory()) {
    for (const name of fs.readdirSync(kontxtDir)) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const full = path.join(kontxtDir, name)
      if (fs.statSync(full).isFile()) out.push(full)
    }
  }
  for (const name of Object.keys(LIVING_MD_FILES)) {
    const full = path.join(repoRoot, name)
    if (fs.existsSync(full) && fs.statSync(full).isFile()) out.push(full)
  }
  return out
}
