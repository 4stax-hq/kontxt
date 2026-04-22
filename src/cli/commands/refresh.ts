import * as fs from 'fs'
import * as path from 'path'
import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { buildChangeSummary } from '../../daemon/workspace-watcher'
import type { RawEvent } from '../../types'

// Reuse the same system prompt logic as init — diff-focused variant
const REFRESH_SYSTEM_PROMPT = `You are analyzing recent changes to a software project to extract new developer knowledge for an AI memory system.

You have been given the files that changed in the most recent work session (written by a developer or AI agent).

Extract only NEW knowledge — things that weren't obvious before these changes:
- fact: new services, APIs, env vars, data models, routes, integrations, URL patterns, config values
- decision: architectural choices visible in the new code — why this approach was taken
- progress: features or milestones that were just completed (what got built)
- focus: what is clearly being worked on right now (incomplete work, TODOs, partial implementations)

Rules:
- Be specific. Real names, real paths, real function names, real env var names.
- Infer decisions from code patterns (e.g. "chose X over Y because the code does Z").
- Do NOT extract trivial things ("added a file", "imported a library").
- Extract at 0.5+ confidence — better to capture than miss.
- One entry per distinct piece of knowledge.

Return ONLY a JSON array:
[{"type":"fact|focus|progress|decision","content":"...","confidence":0.0-1.0}]`

export async function refreshCommand(workspacePath: string, changedFiles?: string[]): Promise<number> {
  ensureKontxtDir()
  const config = loadConfig()

  if (!config.anthropicKey && !config.openaiKey) {
    console.error('No API key set. Run: kontxt config set anthropic-key <key>')
    process.exit(1)
  }

  // If no specific files given, find recently modified source files (last 24h)
  if (!changedFiles || changedFiles.length === 0) {
    changedFiles = findRecentlyModified(workspacePath)
    if (changedFiles.length === 0) {
      console.log('No recently modified source files found.')
      return 0
    }
    console.log(`Found ${changedFiles.length} recently modified file(s)`)
  }

  const summary = buildChangeSummary(workspacePath, changedFiles)

  let items: Array<{ type: string; content: string; confidence: number }> = []

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: config.extractionModel ?? 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: REFRESH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: summary }],
      })
      const block = response.content[0]
      if (block.type === 'text') items = parseItems(block.text)
    } catch (err) {
      console.error('Extraction failed:', err)
      return 0
    }
  } else if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: REFRESH_SYSTEM_PROMPT },
          { role: 'user', content: summary },
        ],
      })
      items = parseItems(response.choices[0]?.message?.content ?? '')
    } catch (err) {
      console.error('Extraction failed:', err)
      return 0
    }
  }

  if (items.length === 0) return 0

  const db = getDb()
  const { processDirectEntry } = await import('../../pipeline/writer')
  const validTypes = new Set(['decision', 'fact', 'blocker', 'progress', 'focus'])
  const event: RawEvent = {
    text: '',
    source: 'cli',
    workspacePath,
    timestamp: new Date().toISOString(),
  }

  let stored = 0
  for (const item of items) {
    if (!validTypes.has(item.type)) continue
    await processDirectEntry(item.type as import('../../types').EntryType, item.content, event, db, config)
    stored++
    console.log(`  [${item.type}] ${item.content}`)
  }

  return stored
}

// Find source files modified in the last 24 hours
function findRecentlyModified(workspacePath: string, windowHours = 24): string[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000
  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage',
    '__pycache__', '.venv', 'venv', '.tox', 'target', 'vendor', '.kontxt',
  ])
  const TRACK_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
    '.sql', '.prisma', '.graphql',
    '.json', '.toml', '.yaml', '.yml',
    '.md', '.mdx',
  ])

  const found: Array<{ rel: string; mtime: number }> = []

  function walk(dir: string) {
    let entries: import('fs').Dirent[]
    try { entries = require('fs').readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (e.name === 'package-lock.json' || e.name === 'yarn.lock') continue
      const full = require('path').join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full)
      } else if (e.isFile()) {
        const ext = require('path').extname(e.name).toLowerCase()
        if (!TRACK_EXTS.has(ext)) continue
        try {
          const { mtimeMs } = require('fs').statSync(full)
          if (mtimeMs >= cutoff) {
            found.push({ rel: require('path').relative(workspacePath, full), mtime: mtimeMs })
          }
        } catch {}
      }
    }
  }

  walk(workspacePath)
  // Sort most recently modified first, cap at 20 files
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 20)
    .map(f => f.rel)
}

function parseItems(raw: string): Array<{ type: string; content: string; confidence: number }> {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(i => i && typeof i.type === 'string' && typeof i.content === 'string' && (i.confidence ?? 1) >= 0.5)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) return []
    try { return JSON.parse(match[0]) } catch { return [] }
  }
}
