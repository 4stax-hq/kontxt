import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { Config } from '../config'
import { getLastAutoRefresh, markRefreshTriggered } from '../refresh-state'

const TRACK_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.sql', '.prisma', '.graphql', '.gql',
  '.json', '.toml', '.yaml', '.yml', '.env.example', '.env.sample',
  '.md', '.mdx',
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage',
  '__pycache__', '.venv', 'venv', 'env', '.tox', 'target', 'vendor', '.gradle',
  '.idea', '.vscode', 'tmp', 'temp', '.kontxt',
])

// High-signal names: architectural files worth 3 points each
const HIGH_SIGNAL = new Set([
  'auth', 'middleware', 'server', 'main', 'app', 'index',
  'schema', 'model', 'models', 'db', 'database', 'migrate',
  'router', 'routes', 'api', 'config', 'env', 'constants',
  'types', 'interfaces', 'actions', 'store',
])

// Medium-signal: feature/domain files worth 2 points
const MED_SIGNAL = new Set([
  'client', 'service', 'handler', 'provider', 'context',
  'hook', 'hooks', 'util', 'utils', 'helpers', 'lib',
  'layout', 'page', 'component',
])

function fileSignificance(filePath: string): number {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase()
  const ext = path.extname(filePath).toLowerCase()

  // Tests/stories/snapshots = 0 (don't count toward trigger threshold)
  if (base.endsWith('.test') || base.endsWith('.spec') || base.endsWith('.stories')) return 0
  if (filePath.includes('__snapshots__') || filePath.includes('/__tests__/')) return 0

  if (HIGH_SIGNAL.has(base)) return 3
  if (MED_SIGNAL.has(base)) return 2

  // All tracked source code counts for something
  const isCode = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.swift'].includes(ext)
  return isCode ? 1 : 0
}

// ─── cooldown state ───────────────────────────────────────────────────────────

function isCoolingDown(workspacePath: string, cooldownMs: number): boolean {
  return Date.now() - getLastAutoRefresh(workspacePath) < cooldownMs
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface WorkspaceChange {
  workspacePath: string
  changedFiles: string[]
}

type BatchHandler = (change: WorkspaceChange) => void

export function watchWorkspace(
  workspacePath: string,
  getConfig: () => Config,   // live config — re-read on every potential fire
  onBatch: BatchHandler
): () => void {
  const fileHashes = new Map<string, string>()
  const pendingChanges = new Map<string, number>()  // path → significance score
  const watchers: fs.FSWatcher[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function hashFile(filePath: string): string | null {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16)
    } catch { return null }
  }

  function shouldTrack(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    if (!TRACK_EXTS.has(ext)) return false
    if (filePath.endsWith('.min.js') || filePath.endsWith('.min.css')) return false
    const base = path.basename(filePath)
    if (base === 'package-lock.json' || base === 'yarn.lock' || base === 'pnpm-lock.yaml') return false
    return true
  }

  function tryFire() {
    const cfg = getConfig()

    if (cfg.capturePaused === true) {
      pendingChanges.clear()
      return
    }

    if (cfg.autoRefresh === false) {
      // Auto-refresh disabled — keep accumulating changes but don't fire
      return
    }

    const quietMs = (cfg.autoRefreshQuietMinutes ?? 5) * 60 * 1000
    const cooldownMs = (cfg.autoRefreshCooldownMinutes ?? 30) * 60 * 1000
    const minScore = cfg.autoRefreshMinScore ?? 4

    if (isCoolingDown(workspacePath, cooldownMs)) {
      const remaining = Math.ceil((cooldownMs - (Date.now() - getLastAutoRefresh(workspacePath))) / 60000)
      console.log(`[watcher] ${path.basename(workspacePath)}: cooldown — ${remaining}m remaining`)
      return
    }

    const totalScore = [...pendingChanges.values()].reduce((a, b) => a + b, 0)
    const maxScore = Math.max(0, ...pendingChanges.values())
    const fileCount = pendingChanges.size
    const shouldFire = totalScore >= minScore || maxScore >= 3 || fileCount >= 3
    if (!shouldFire) {
      console.log(`[watcher] ${path.basename(workspacePath)}: score ${totalScore} < threshold ${minScore}, skipping`)
      pendingChanges.clear()
      return
    }

    const changedFiles = [...pendingChanges.keys()].map(f => path.relative(workspacePath, f))
    pendingChanges.clear()

    markRefreshTriggered(workspacePath)
    onBatch({ workspacePath, changedFiles })
  }

  function handleFileChange(filePath: string) {
    if (!shouldTrack(filePath)) return

    const hash = hashFile(filePath)
    if (hash === null) return

    const prev = fileHashes.get(filePath)
    if (prev === hash) return   // content unchanged — editor touch, not a real change

    fileHashes.set(filePath, hash)

    const cfg = getConfig()
    if (cfg.capturePaused === true) {
      pendingChanges.delete(filePath)
      return
    }

    const score = fileSignificance(filePath)
    if (score > 0) {
      pendingChanges.set(filePath, Math.max(pendingChanges.get(filePath) ?? 0, score))
    }

    // Reset quiet-period debounce on every real change
    if (debounceTimer) clearTimeout(debounceTimer)
    const quietMs = (cfg.autoRefreshQuietMinutes ?? 5) * 60 * 1000
    debounceTimer = setTimeout(tryFire, quietMs)
  }

  // Seed hashes on startup so we only react to changes made after the watcher starts
  function seedDir(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) seedDir(full)
      } else if (e.isFile() && shouldTrack(full)) {
        const hash = hashFile(full)
        if (hash) fileHashes.set(full, hash)
      }
    }
  }

  seedDir(workspacePath)

  function watchDir(dir: string, depth = 0) {
    if (depth > 4) return
    try {
      if (!fs.existsSync(dir)) return
      const w = fs.watch(dir, { persistent: false }, (_, filename) => {
        if (filename) handleFileChange(path.join(dir, filename))
      })
      w.on('error', () => {})
      watchers.push(w)
    } catch {}

    if (depth === 0) {
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
        watchDir(path.join(dir, e.name), depth + 1)
      }
    }
  }

  watchDir(workspacePath)

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    for (const w of watchers) { try { w.close() } catch {} }
  }
}

// Build a compact summary of changed files for the LLM — head+tail truncation
export function buildChangeSummary(
  workspacePath: string,
  changedFiles: string[],
  options?: { compact?: boolean }
): string {
  const compact = options?.compact === true
  const parts: string[] = [`Changed files:\n${changedFiles.join('\n')}`, '']
  let budget = compact ? 2800 : 10000

  // Sort by significance so high-signal files get more of the budget
  const sorted = changedFiles
    .map(rel => ({ rel, score: fileSignificance(path.join(workspacePath, rel)) }))
    .sort((a, b) => b.score - a.score)

  const selected = compact ? sorted.slice(0, 4) : sorted

  for (const { rel } of selected) {
    if (budget <= 0) break
    const full = path.join(workspacePath, rel)
    if (!fs.existsSync(full)) continue
    try {
      let content = fs.readFileSync(full, 'utf-8')
      const cap = Math.min(compact ? 550 : 1800, budget)
      if (content.length > cap) {
        const head = Math.floor(cap * (compact ? 0.5 : 0.3))
        content = content.slice(0, head) + '\n...\n' + content.slice(-(cap - head))
      }
      parts.push(`--- ${rel} ---\n${content}`)
      budget -= content.length
    } catch {}
  }

  return parts.join('\n\n')
}
