import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { buildChangeSummary } from '../../daemon/workspace-watcher'
import type { RawEvent } from '../../types'
import { isRepeatedRequest, prepareLlmInput, rememberRequest, resolveAnthropicModel, shouldSkipLlmCall } from '../../llm/guards'
import { getWorkspaceRefreshState, markRefreshAttempt, markRefreshError, markRefreshNoChange, markRefreshSkipped, markRefreshSuccess } from '../../refresh-state'

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

const INCREMENTAL_REFRESH_SYSTEM_PROMPT = `You are analyzing a small batch of recent file changes to update an AI memory system for a software project.

Extract only HIGH-VALUE new knowledge from these changes:
- fact: concrete new APIs, env vars, routes, model fields, ports, config values
- decision: visible architectural choices and why
- progress: meaningful completed work
- focus: clearly active in-progress work

Rules:
- Treat this as an incremental update, not a full repo refresh.
- Return at most 3 items.
- Prefer omission over weak guesses.
- Bias toward developer-relevant project status for now: shipped features, infra/config changes, schema changes, route/API changes, tooling changes, migrations, test coverage changes, and recent implementation milestones.
- Ignore trivial edits, formatting, pure refactors, renames, tests, and small local implementation details.
- Use git status, diff stats, and recent commit messages as strong signals for progress/status when they clearly describe what changed.
- Be specific: use real paths, identifiers, env vars, route names, or config keys when present.

Return ONLY a JSON array:
[{"type":"fact|focus|progress|decision","content":"...","confidence":0.0-1.0}]`

export async function refreshCommand(
  workspacePath: string,
  changedFiles?: string[],
  options?: { auto?: boolean; incremental?: boolean; lookbackHours?: number; sinceTimestamp?: number }
): Promise<number> {
  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()
  markRefreshAttempt(workspacePath)
  const isAutoRefresh = options?.auto === true
  const isIncremental = options?.incremental === true || isAutoRefresh
  const refreshState = getWorkspaceRefreshState(workspacePath)

  if (!config.anthropicKey && !config.openaiKey) {
    console.error('No API key set. Run: kontxt config set anthropic-key <key>')
    process.exit(1)
  }

  // If no specific files given, find recently modified source files (last 24h)
  if (!changedFiles || changedFiles.length === 0) {
    changedFiles = findRecentlyModified(workspacePath, {
      windowHours: options?.lookbackHours ?? 24,
      sinceTimestamp: options?.sinceTimestamp,
    })
    if (changedFiles.length === 0) {
      console.log('No recently modified source files found.')
      markRefreshSkipped(workspacePath)
      return 0
    }
    console.log(`Found ${changedFiles.length} recently modified file(s)`)
  }

  const summary = buildRefreshSummary(workspacePath, changedFiles, {
    compact: isIncremental,
    sinceTimestamp: options?.sinceTimestamp ?? refreshState.lastSuccess ?? refreshState.lastAttempt ?? 0,
  })
  const prepared = prepareLlmInput(isIncremental ? 'auto_refresh' : 'refresh', summary)
  const requestScope = `${isIncremental ? 'update' : 'refresh'}:${workspacePath}`
  if (shouldSkipLlmCall(prepared.text, isIncremental ? 60 : 120)) {
    console.log('Recent changes were too small to justify a paid refresh.')
    markRefreshSkipped(workspacePath)
    return 0
  }
  if (isRepeatedRequest(requestScope, prepared.text)) {
    console.log('No meaningful change since the last successful refresh. Skipping paid call.')
    markRefreshSkipped(workspacePath)
    return 0
  }

  let items: Array<{ type: string; content: string; confidence: number }> = []

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: resolveAnthropicModel(config.extractionModel),
        max_tokens: prepared.maxOutputTokens,
        system: isIncremental ? INCREMENTAL_REFRESH_SYSTEM_PROMPT : REFRESH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prepared.text }],
      })
      const block = response.content[0]
      if (block.type === 'text') items = parseItems(block.text)
    } catch (err) {
      markRefreshError(workspacePath, err)
      throw err
    }
  } else if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: prepared.maxOutputTokens,
        messages: [
          { role: 'system', content: isIncremental ? INCREMENTAL_REFRESH_SYSTEM_PROMPT : REFRESH_SYSTEM_PROMPT },
          { role: 'user', content: prepared.text },
        ],
      })
      items = parseItems(response.choices[0]?.message?.content ?? '')
    } catch (err) {
      markRefreshError(workspacePath, err)
      throw err
    }
  }

  if (items.length === 0) {
    markRefreshNoChange(workspacePath)
    return 0
  }
  rememberRequest(requestScope, prepared.text)

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

  markRefreshSuccess(workspacePath)
  return stored
}

// Find source files modified in the last 24 hours
function findRecentlyModified(
  workspacePath: string,
  options?: { windowHours?: number; sinceTimestamp?: number }
): string[] {
  const cutoff = options?.sinceTimestamp && options.sinceTimestamp > 0
    ? options.sinceTimestamp
    : Date.now() - (options?.windowHours ?? 24) * 60 * 60 * 1000
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

function buildRefreshSummary(
  workspacePath: string,
  changedFiles: string[],
  options?: { compact?: boolean; sinceTimestamp?: number }
): string {
  const parts: string[] = []
  const gitContext = buildGitContext(workspacePath, changedFiles, options)
  if (gitContext) parts.push(gitContext)
  parts.push(buildChangeSummary(workspacePath, changedFiles, { compact: options?.compact === true }))
  return parts.join('\n\n')
}

function buildGitContext(
  workspacePath: string,
  changedFiles: string[],
  options?: { compact?: boolean; sinceTimestamp?: number }
): string {
  const parts: string[] = []
  const fileArgs = changedFiles.length > 0 ? ['--', ...changedFiles] : []

  const status = safeGit(['status', '--short', ...fileArgs], workspacePath)
  if (status) {
    const lines = status.split('\n').filter(Boolean)
    parts.push(`Git status:\n${lines.slice(0, options?.compact ? 6 : 12).join('\n')}`)
  }

  const diffStat = safeGit(['diff', '--shortstat', ...fileArgs], workspacePath)
  if (diffStat) parts.push(`Uncommitted diff:\n${diffStat}`)

  const sinceIso = options?.sinceTimestamp && options.sinceTimestamp > 0
    ? new Date(options.sinceTimestamp).toISOString()
    : ''
  const recentCommits = sinceIso
    ? safeGit(['log', '--oneline', `--since=${sinceIso}`, '-5'], workspacePath)
    : ''
  const fallbackCommits = recentCommits || safeGit(['log', '--oneline', '-3', ...fileArgs], workspacePath)
  if (fallbackCommits) {
    const lines = fallbackCommits.split('\n').filter(Boolean)
    parts.push(`Recent commits:\n${lines.slice(0, options?.compact ? 3 : 5).join('\n')}`)
  }

  return parts.join('\n\n')
}

function safeGit(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.map(shellQuote).join(' ')}`, {
      cwd,
      timeout: 4000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
