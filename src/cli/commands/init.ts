import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import type { RawEvent } from '../../types'
import { readExistingAgentFiles } from '../../daemon/agent-watcher'

// ─── file walker ─────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage',
  '__pycache__', '.venv', 'venv', 'env', '.tox', 'target', 'vendor', '.gradle',
  '.idea', '.vscode', 'tmp', 'temp', 'logs', 'public', 'static', 'assets', 'media',
])
const SKIP_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.avi',
  '.zip', '.tar', '.gz', '.bz2', '.rar',
  '.lock', '.sum',   // lockfiles: verbose, no signal
  '.map',            // sourcemaps
  '.min.js', '.min.css',
])

// Names that signal architectural centrality in any language/framework
const SIGNAL_NAMES = new Set([
  'main', 'app', 'server', 'index', 'init', 'bootstrap',
  'config', 'settings', 'constants', 'env',
  'schema', 'schemas', 'model', 'models', 'entity', 'entities',
  'types', 'type', 'interfaces',
  'routes', 'router', 'routing', 'api',
  'middleware', 'auth', 'authentication', 'authorization',
  'db', 'database', 'connection', 'migrate',
  // auth / identity patterns
  'session', 'token', 'jwt', 'oauth', 'login', 'signup', 'register',
  // infra / services
  'client', 'service', 'services', 'provider', 'handler', 'handlers',
  'store', 'context', 'actions', 'queries', 'mutations',
  // lib patterns
  'utils', 'helpers', 'hooks', 'lib',
])

function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 5) return []
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }

  const files: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example' && e.name !== '.env.sample') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) files.push(...walkFiles(full, depth + 1))
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase()
      // Skip by extension or compound extension (.min.js etc)
      if (SKIP_EXTS.has(ext) || e.name.endsWith('.min.js') || e.name.endsWith('.min.css')) continue
      files.push(full)
    }
  }
  return files
}

// ─── scoring ──────────────────────────────────────────────────────────────────

function scoreFile(
  filePath: string,
  workspacePath: string,
  recentFiles: Set<string>,
  entryPoints: Set<string>
): number {
  const rel = path.relative(workspacePath, filePath)
  const depth = rel.split(path.sep).length - 1
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase()
  let score = 0

  // Shallower files are more likely to be architectural
  score += Math.max(0, 50 - depth * 12)

  // Universal signal names
  if (SIGNAL_NAMES.has(base)) score += 35

  // Explicitly the entry point of the project
  if (entryPoints.has(rel)) score += 50

  // Recently touched = currently relevant
  if (recentFiles.has(rel)) score += 30

  // File size heuristic: skip empty and skip huge
  try {
    const { size } = fs.statSync(filePath)
    if (size < 80) return -1   // too small to carry signal
    if (size > 60_000) score -= 25  // huge files are usually generated
    if (size > 5_000 && size < 30_000) score += 10  // meaty but readable
  } catch { return -1 }

  return score
}

// ─── manifest reading ─────────────────────────────────────────────────────────

interface ManifestInfo {
  summary: string
  entryPoints: Set<string>
}

function readManifests(workspacePath: string): ManifestInfo {
  const parts: string[] = []
  const entryPoints = new Set<string>()

  const manifests: Array<[string, (content: string) => void]> = [
    ['package.json', (raw) => {
      try {
        const pkg = JSON.parse(raw)
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
        parts.push(`package.json — ${pkg.name ?? 'unnamed'}
  description: ${pkg.description ?? 'none'}
  scripts: ${Object.keys(pkg.scripts ?? {}).join(', ')}
  deps: ${deps.slice(0, 25).join(', ')}`)
        if (pkg.main) entryPoints.add(pkg.main)
        if (pkg.module) entryPoints.add(pkg.module)
      } catch {}
    }],
    ['Cargo.toml', (raw) => {
      parts.push(`Cargo.toml:\n${raw.slice(0, 500)}`)
      entryPoints.add('src/main.rs')
      entryPoints.add('src/lib.rs')
    }],
    ['go.mod', (raw) => {
      parts.push(`go.mod:\n${raw.slice(0, 400)}`)
      entryPoints.add('main.go')
      entryPoints.add('cmd/main.go')
    }],
    ['pyproject.toml', (raw) => {
      parts.push(`pyproject.toml:\n${raw.slice(0, 500)}`)
    }],
    ['requirements.txt', (raw) => {
      const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      parts.push(`requirements.txt:\n${lines.slice(0, 20).join('\n')}`)
      for (const name of ['main.py', 'app.py', 'run.py', 'server.py', 'manage.py']) {
        entryPoints.add(name)
      }
    }],
    ['Gemfile', (raw) => {
      parts.push(`Gemfile:\n${raw.slice(0, 400)}`)
      entryPoints.add('config/routes.rb')
      entryPoints.add('app/models')
    }],
    ['pom.xml', (raw) => {
      parts.push(`pom.xml (Maven):\n${raw.slice(0, 400)}`)
    }],
    ['build.gradle', (raw) => {
      parts.push(`build.gradle:\n${raw.slice(0, 400)}`)
    }],
    ['composer.json', (raw) => {
      parts.push(`composer.json:\n${raw.slice(0, 400)}`)
    }],
    ['pubspec.yaml', (raw) => {
      parts.push(`pubspec.yaml (Flutter/Dart):\n${raw.slice(0, 400)}`)
      entryPoints.add('lib/main.dart')
    }],
  ]

  for (const [filename, handler] of manifests) {
    const fp = path.join(workspacePath, filename)
    try {
      if (fs.existsSync(fp)) handler(fs.readFileSync(fp, 'utf-8'))
    } catch {}
  }

  return { summary: parts.join('\n\n'), entryPoints }
}

// ─── main summary builder ─────────────────────────────────────────────────────

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, timeout: 5000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return '' }
}

function buildRepoSummary(workspacePath: string): string {
  const parts: string[] = []

  // 1. Language manifests + entry point detection
  const { summary: manifestSummary, entryPoints } = readManifests(workspacePath)
  if (manifestSummary) parts.push(manifestSummary)

  // 2. Top-level structure — shows the project shape at a glance
  try {
    const topLevel = fs.readdirSync(workspacePath)
      .filter(e => !e.startsWith('.') && !SKIP_DIRS.has(e))
    parts.push(`Top-level: ${topLevel.join(', ')}`)
  } catch {}

  // 3. Git signals
  const gitLog = safeExec('git log --oneline -20', workspacePath)
  if (gitLog) parts.push(`Recent commits:\n${gitLog}`)

  const branch = safeExec('git branch --show-current', workspacePath)
  if (branch) parts.push(`Branch: ${branch}`)

  const status = safeExec('git status --short', workspacePath)
  if (status) parts.push(`Uncommitted:\n${status}`)

  // Recently changed files from git — these tell us what's actively being worked on
  const recentChanged = safeExec('git diff --name-only HEAD~5..HEAD 2>/dev/null', workspacePath)
  const recentFiles = new Set(recentChanged.split('\n').filter(Boolean))

  // Also add uncommitted files
  safeExec('git status --short', workspacePath)
    .split('\n')
    .map(l => l.trim().replace(/^\S+\s+/, ''))
    .filter(Boolean)
    .forEach(f => recentFiles.add(f))

  // 4. Walk and score all source files
  const allFiles = walkFiles(workspacePath)
  const scored = allFiles
    .map(f => ({ f, score: scoreFile(f, workspacePath, recentFiles, entryPoints) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)

  // Take top files, budget 12000 chars for code content
  // Use smart truncation: first 30% + last 70% to capture both imports AND implementations
  let codeCharsUsed = 0
  const CODE_BUDGET = 12000
  const MAX_FILES = 12
  const picked: Array<{ rel: string; content: string }> = []

  for (const { f } of scored) {
    if (picked.length >= MAX_FILES || codeCharsUsed >= CODE_BUDGET) break
    const rel = path.relative(workspacePath, f)
    const remaining = CODE_BUDGET - codeCharsUsed
    const perFileCap = Math.min(1800, remaining)
    try {
      let content = fs.readFileSync(f, 'utf-8')
      if (content.length > perFileCap) {
        // Keep head (imports/setup) + tail (implementations/exports)
        const headLen = Math.floor(perFileCap * 0.3)
        const tailLen = perFileCap - headLen
        content = content.slice(0, headLen) + '\n...\n' + content.slice(-tailLen)
      }
      picked.push({ rel, content })
      codeCharsUsed += content.length
    } catch {}
  }

  if (picked.length > 0) {
    parts.push('--- Key source files ---')
    for (const { rel, content } of picked) {
      parts.push(`${rel}:\n${content}`)
    }
  }

  const full = parts.join('\n\n')
  return full.length > 16000 ? full.slice(0, 16000) + '\n...' : full
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

const INIT_SYSTEM_PROMPT = `You are analyzing a software repository to extract durable developer knowledge for an AI memory system.

You have been given: project manifest(s), directory structure, git history, and the highest-signal source files (entry points, schemas, config, models).

Extract:
- fact: concrete truths an AI must know — stack, services, ports, env vars, auth mechanism, key file locations, data model shape, external integrations, URL patterns, required env var names, API routes
- focus: what the developer is actively working on right now (from branch name, uncommitted files, recent commits)
- progress: recently completed milestones or features (from git log)
- decision: architectural choices — why this approach, notable patterns visible in the code

Rules:
- Be specific. Real names, real paths, real ports, real env var names, real function names, real schemas.
- If you see Supabase/Firebase/Auth0, note the provider and what it does. If you see env vars referenced, name them. If you see routes/pages, note the URL structure.
- Extract everything visible — it is better to extract a fact at 0.5 confidence than to miss it.
- Do NOT extract generic things ("uses version control", "has a src directory", "uses TypeScript").
- One entry per distinct fact. Don't bundle unrelated things in one entry.
- Works for any language and framework.

Return ONLY a JSON array:
[{"type":"fact|focus|progress|decision","content":"...","confidence":0.0-1.0}]
Omit items with confidence below 0.5.`

export async function initCommand(workspacePath: string): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()

  if (!config.anthropicKey && !config.openaiKey) {
    console.error('No API key set. Run: kontxt config set anthropic-key <key>')
    process.exit(1)
  }

  const db = getDb()
  let summary = buildRepoSummary(workspacePath)

  if (!summary.trim()) {
    console.error('Could not read any signals from this directory.')
    process.exit(1)
  }

  // Prepend any existing agent memory files — they carry curated project knowledge
  const agentFiles = readExistingAgentFiles(workspacePath)
  if (agentFiles.length > 0) {
    const agentSection = agentFiles
      .map(({ file, agent, content }) => `--- ${file} (${agent}) ---\n${content.slice(0, 2000)}`)
      .join('\n\n')
    summary = `${agentSection}\n\n--- Repository Analysis ---\n${summary}`
    console.log(`Found ${agentFiles.length} agent file(s): ${agentFiles.map(f => f.file).join(', ')}`)
  }

  console.log('Analyzing repository...')

  let items: Array<{ type: string; content: string; confidence: number }> = []

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: config.extractionModel ?? 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        system: INIT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: summary }],
      })
      const content = response.content[0]
      if (content.type === 'text') items = parseItems(content.text)
    } catch (err) {
      console.error('Extraction failed:', err)
      process.exit(1)
    }
  } else if (config.openaiKey) {
    try {
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: config.openaiKey })
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: INIT_SYSTEM_PROMPT },
          { role: 'user', content: summary },
        ],
        max_tokens: 2500,
      })
      items = parseItems(response.choices[0]?.message?.content ?? '')
    } catch (err) {
      console.error('Extraction failed:', err)
      process.exit(1)
    }
  }

  if (items.length === 0) {
    console.log('Nothing extracted with high confidence.')
    console.log('Tip: the project may be very new or the files may be empty.')
    return
  }

  const { processDirectEntry } = await import('../../pipeline/writer')
  const validTypes = new Set(['decision', 'fact', 'blocker', 'progress', 'focus'])
  const event: RawEvent = {
    text: '', source: 'cli', workspacePath,
    timestamp: new Date().toISOString(),
  }

  let stored = 0
  for (const item of items) {
    if (!validTypes.has(item.type)) continue
    await processDirectEntry(item.type as import('../../types').EntryType, item.content, event, db, config)
    stored++
    console.log(`  [${item.type}] ${item.content}`)
  }

  console.log(`\nInitialized: ${stored} entries written`)
  console.log(`Context file: ${workspacePath}/.kontxt/CONTEXT.md`)
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
