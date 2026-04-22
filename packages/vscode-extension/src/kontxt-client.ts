import * as cp from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const PID_PATH = path.join(os.homedir(), '.kontxt', 'daemon.pid')
const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')
const KONTXT_DIR = path.join(os.homedir(), '.kontxt')

export function isDaemonRunning(): boolean {
  if (!fs.existsSync(PID_PATH)) return false
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function ensureKontxtDir(): void {
  if (!fs.existsSync(KONTXT_DIR)) {
    fs.mkdirSync(KONTXT_DIR, { recursive: true })
  }
}

export function syncApiKeys(anthropicKey: string, openaiKey: string): void {
  ensureKontxtDir()
  let config: Record<string, unknown> = {}
  if (fs.existsSync(CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch {}
  }
  if (anthropicKey) config.anthropicKey = anthropicKey
  if (openaiKey) config.openaiKey = openaiKey
  // Migrate: Haiku 4.5 is 3x more expensive than Haiku 3 for no extraction quality gain
  if (!config.extractionModel || config.extractionModel === 'claude-haiku-4-5-20251001') {
    config.extractionModel = 'claude-3-haiku-20240307'
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function hasApiKey(): boolean {
  if (!fs.existsSync(CONFIG_PATH)) return false
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return !!(config.anthropicKey || config.openaiKey)
  } catch {
    return false
  }
}

export function isAutoRefreshEnabled(): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return config.autoRefresh !== false   // default on
  } catch { return true }
}

export function setAutoRefresh(enabled: boolean): void {
  ensureKontxtDir()
  let config: Record<string, unknown> = {}
  if (fs.existsSync(CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch {}
  }
  config.autoRefresh = enabled
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function getLastAutoRefresh(workspacePath: string): number {
  const stateFile = path.join(os.homedir(), '.kontxt', 'refresh-state.json')
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
    return state.workspaces?.[workspacePath] ?? 0
  } catch { return 0 }
}

export interface KontxtConfig {
  autoRefresh: boolean
  autoRefreshQuietMinutes: number
  autoRefreshCooldownMinutes: number
  autoRefreshMinScore: number
  extractionModel: string
  maxContextTokens: number
}

export function getFullConfig(): KontxtConfig {
  const defaults: KontxtConfig = {
    autoRefresh: true,
    autoRefreshQuietMinutes: 5,
    autoRefreshCooldownMinutes: 30,
    autoRefreshMinScore: 4,
    extractionModel: 'claude-3-haiku-20240307',
    maxContextTokens: 800,
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return { ...defaults, ...raw }
  } catch { return defaults }
}

export function setConfigValue(key: string, value: unknown): void {
  ensureKontxtDir()
  let config: Record<string, unknown> = {}
  if (fs.existsSync(CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch {}
  }
  config[key] = value
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

const GITIGNORE_BLOCK = `
# kontxt — ephemeral files (MD files are safe to commit)
.kontxt/*.db
.kontxt/*.pid
.kontxt/*.sock
`

export function ensureGitignore(workspacePath: string): void {
  const gitignorePath = path.join(workspacePath, '.gitignore')
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : ''
  if (existing.includes('.kontxt/*.db')) return
  fs.writeFileSync(gitignorePath, existing.trimEnd() + '\n' + GITIGNORE_BLOCK, 'utf-8')
}

export function hasProjectContext(workspacePath: string): boolean {
  return fs.existsSync(path.join(workspacePath, '.kontxt', 'CONTEXT.md'))
}

export function readContextMd(workspacePath: string): string | null {
  const p = path.join(workspacePath, '.kontxt', 'CONTEXT.md')
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p, 'utf-8')
}

export function readDecisionsMd(workspacePath: string): string | null {
  const p = path.join(workspacePath, '.kontxt', 'DECISIONS.md')
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p, 'utf-8')
}

export function getEntryCount(workspacePath: string): number {
  // Count bullet points across the MD files as a proxy for entry count
  try {
    const ctx = readContextMd(workspacePath) ?? ''
    const dec = readDecisionsMd(workspacePath) ?? ''
    return (ctx.match(/^- /gm) ?? []).length + (dec.match(/^## /gm) ?? []).length
  } catch {
    return 0
  }
}

function resolveKontxtBin(): string {
  // VS Code / Cursor processes often have a stripped PATH — try common locations
  const candidates = [
    'kontxt',
    '/usr/local/bin/kontxt',
    '/opt/homebrew/bin/kontxt',
    `${os.homedir()}/.npm-packages/bin/kontxt`,
    `${os.homedir()}/.nvm/current/bin/kontxt`,
  ]
  for (const c of candidates) {
    try {
      cp.execSync(`${c} --version`, { stdio: 'ignore', timeout: 3000 })
      return c
    } catch {}
  }
  return 'kontxt'  // last resort — let it fail with a useful error
}

let _kontxtBin: string | null = null
function getKontxtBin(): string {
  if (!_kontxtBin) _kontxtBin = resolveKontxtBin()
  return _kontxtBin
}

export function runKontxtCli(args: string[], workspacePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = getKontxtBin()
    // Augment PATH so child process can find node/npm bins
    const augmentedPath = [
      '/usr/local/bin', '/opt/homebrew/bin',
      `${os.homedir()}/.npm-packages/bin`,
      process.env.PATH ?? '',
    ].join(':')

    const proc = cp.spawn(bin, args, {
      cwd: workspacePath,
      env: { ...process.env, PATH: augmentedPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err || out || `exit code ${code}`))
    })
    proc.on('error', (e) => reject(new Error(`Could not run kontxt: ${e.message}. Ensure it is installed: npm i -g @4stax/kontxt`))    )
  })
}

export function startDaemonDetached(workspacePath: string): void {
  const proc = cp.spawn('kontxt', ['start', '--workspace', workspacePath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  proc.unref()
}

export interface ParsedContext {
  project: string
  focus: string | null
  blockers: string[]
  decisions: string[]
  facts: string[]
  updatedAt: string | null
}

export function parseContextMd(md: string): ParsedContext {
  const result: ParsedContext = {
    project: 'unknown',
    focus: null,
    blockers: [],
    decisions: [],
    facts: [],
    updatedAt: null,
  }

  const lines = md.split('\n')
  let section = ''

  for (const line of lines) {
    if (line.startsWith('# ')) {
      result.project = line.slice(2).trim()
    } else if (line.startsWith('## ')) {
      section = line.slice(3).trim().toLowerCase()
    } else if (line.startsWith('- ') || (section === 'focus' && line.trim() && !line.startsWith('_'))) {
      const content = line.startsWith('- ') ? line.slice(2).trim() : line.trim()
      if (!content) continue
      if (section === 'focus') result.focus = content
      else if (section === 'active blockers') result.blockers.push(content)
      else if (section === 'recent decisions') result.decisions.push(content)
      else if (section === 'relevant facts') result.facts.push(content)
    } else if (line.startsWith('_updated:')) {
      result.updatedAt = line.replace('_updated:', '').replace(/_/g, '').trim()
    }
  }

  return result
}
