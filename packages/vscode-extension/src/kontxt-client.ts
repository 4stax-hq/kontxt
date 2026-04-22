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
  // Keep extraction on the cheaper narrow model path unless the user explicitly changes it.
  if (
    !config.extractionModel ||
    config.extractionModel === 'claude-3-5-haiku-latest' ||
    config.extractionModel === 'claude-3-haiku-20240307' ||
    config.extractionModel === 'claude-haiku-4-5-20251001' ||
    config.extractionModel === 'claude-haiku-4-5'
  ) {
    config.extractionModel = 'claude-haiku-4-5'
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

export function isCapturePaused(): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return config.capturePaused === true
  } catch { return false }
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
    const raw = state.workspaces?.[workspacePath]
    if (typeof raw === 'number') return raw
    return raw?.lastFire ?? raw?.lastSuccess ?? 0
  } catch { return 0 }
}

export interface RefreshStatus {
  lastAttempt: number
  lastSuccess: number
  lastOutcome: string
  lastError: string
}

export function getRefreshStatus(workspacePath: string): RefreshStatus | null {
  const stateFile = path.join(os.homedir(), '.kontxt', 'refresh-state.json')
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
    const raw = state.workspaces?.[workspacePath]
    if (!raw || typeof raw === 'number') return null
    return {
      lastAttempt: raw.lastAttempt ?? 0,
      lastSuccess: raw.lastSuccess ?? 0,
      lastOutcome: raw.lastOutcome ?? '',
      lastError: raw.lastError ?? '',
    }
  } catch { return null }
}

export interface KontxtConfig {
  capturePaused: boolean
  autoRefresh: boolean
  autoRefreshQuietMinutes: number
  autoRefreshCooldownMinutes: number
  autoRefreshMinScore: number
  extractionModel: string
  maxContextTokens: number
}

export function getFullConfig(): KontxtConfig {
  const defaults: KontxtConfig = {
    capturePaused: false,
    autoRefresh: true,
    autoRefreshQuietMinutes: 5,
    autoRefreshCooldownMinutes: 30,
    autoRefreshMinScore: 4,
    extractionModel: 'claude-haiku-4-5',
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
    '/usr/local/bin/kontxt',
    '/opt/homebrew/bin/kontxt',
    `${os.homedir()}/.npm-global/bin/kontxt`,
    `${os.homedir()}/.npm-packages/bin/kontxt`,
    `${os.homedir()}/.nvm/current/bin/kontxt`,
    'kontxt',
  ]
  for (const c of candidates) {
    try {
      const resolved = resolveCommandPath(c)
      cp.execFileSync(resolved, ['--version'], { stdio: 'ignore', timeout: 3000 })
      return resolved
    } catch {}
  }
  return 'kontxt'  // last resort — let it fail with a useful error
}

let _kontxtBin: string | null = null
function getKontxtBin(): string {
  if (!_kontxtBin) _kontxtBin = resolveKontxtBin()
  return _kontxtBin
}

let _cliPreflightOk = false

function resolveNodeBin(): string {
  const candidates = [
    '/opt/homebrew/opt/node@20/bin/node',
    '/usr/local/opt/node@20/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    process.execPath,
    'node',
  ]
  for (const c of candidates) {
    try {
      cp.execFileSync(c, ['-p', 'process.versions.modules'], { stdio: 'ignore', timeout: 3000 })
      return c
    } catch {}
  }
  return 'node'
}

export interface CliDiagnostics {
  extensionVersion: string
  cliBin: string
  nodeBin: string
  nodeVersion: string
  nodeModulesVersion: string
  cliPackageRoot: string
  nativeStatus: 'ok' | 'error' | 'unknown'
  nativeMessage: string
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  const resolved = fs.existsSync(filePath) ? fs.realpathSync(filePath) : filePath
  return /\.(?:c?js|mjs)$/i.test(resolved)
}

function normalizeCliError(message: string): string {
  if (!message.includes('NODE_MODULE_VERSION')) return message
  return `${message}\n\nkontxt is being launched with a different Node.js runtime than the one used to build better-sqlite3. Rebuild for the active runtime with \`npm rebuild better-sqlite3\`, or run the extension using the same Node version that built kontxt dependencies.`
}

function getKontxtPackageRoot(bin: string): string | null {
  try {
    const resolved = resolveCommandPath(bin)
    return path.resolve(path.dirname(resolved), '..')
  } catch {
    return null
  }
}

function resolveCommandPath(command: string): string {
  if (command.includes(path.sep) || path.isAbsolute(command)) {
    return fs.realpathSync(command)
  }
  const out = cp.execFileSync('which', [command], { encoding: 'utf-8', timeout: 3000 }).trim()
  if (!out) throw new Error(`Could not resolve command: ${command}`)
  return fs.realpathSync(out)
}

export function preflightKontxtCli(): string | null {
  if (_cliPreflightOk) return null

  const bin = resolveCommandPath(getKontxtBin())
  const nodeBin = resolveNodeBin()
  const packageRoot = getKontxtPackageRoot(bin)
  if (!packageRoot) return null

  try {
    cp.execFileSync(nodeBin, ['-e', `require(${JSON.stringify(path.join(packageRoot, 'node_modules', 'better-sqlite3'))})`], {
      stdio: 'ignore',
      timeout: 5000,
    })
    _cliPreflightOk = true
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return normalizeCliError(message)
  }
}

export function getCliDiagnostics(extensionVersion: string): CliDiagnostics {
  const cliBin = resolveCommandPath(getKontxtBin())
  const nodeBin = resolveNodeBin()
  const cliPackageRoot = getKontxtPackageRoot(cliBin) ?? ''
  let nodeVersion = ''
  let nodeModulesVersion = ''
  let nativeStatus: CliDiagnostics['nativeStatus'] = 'unknown'
  let nativeMessage = ''

  try {
    nodeVersion = cp.execFileSync(nodeBin, ['-p', 'process.versions.node'], { encoding: 'utf-8', timeout: 3000 }).trim()
  } catch {}
  try {
    nodeModulesVersion = cp.execFileSync(nodeBin, ['-p', 'process.versions.modules'], { encoding: 'utf-8', timeout: 3000 }).trim()
  } catch {}

  const preflightError = preflightKontxtCli()
  if (preflightError) {
    nativeStatus = 'error'
    nativeMessage = preflightError
  } else if (cliPackageRoot) {
    nativeStatus = 'ok'
    nativeMessage = 'better-sqlite3 loaded successfully'
  }

  return {
    extensionVersion,
    cliBin,
    nodeBin,
    nodeVersion,
    nodeModulesVersion,
    cliPackageRoot,
    nativeStatus,
    nativeMessage,
  }
}

export function runKontxtCli(args: string[], workspacePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const preflightError = preflightKontxtCli()
    if (preflightError) {
      reject(new Error(preflightError))
      return
    }
    const bin = resolveCommandPath(getKontxtBin())
    const nodeBin = resolveNodeBin()
    const command = isJavaScriptEntrypoint(bin) ? nodeBin : bin
    const commandArgs = isJavaScriptEntrypoint(bin) ? [fs.realpathSync(bin), ...args] : args
    // Augment PATH so child process can find node/npm bins
    const augmentedPath = [
      '/usr/local/bin', '/opt/homebrew/bin',
      '/usr/local/opt/node@20/bin', '/opt/homebrew/opt/node@20/bin',
      `${os.homedir()}/.npm-global/bin`,
      `${os.homedir()}/.npm-packages/bin`,
      process.env.PATH ?? '',
    ].join(':')

    const proc = cp.spawn(command, commandArgs, {
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
      else reject(new Error(normalizeCliError(err || out || `exit code ${code}`)))
    })
    proc.on('error', (e) => reject(new Error(`Could not run kontxt: ${e.message}. Ensure it is installed: npm i -g @4stax/kontxt`))    )
  })
}

export function startDaemonDetached(workspacePath: string): void {
  const bin = resolveCommandPath(getKontxtBin())
  const nodeBin = resolveNodeBin()
  const command = isJavaScriptEntrypoint(bin) ? nodeBin : bin
  const commandArgs = isJavaScriptEntrypoint(bin)
    ? [fs.realpathSync(bin), 'start', '--workspace', workspacePath]
    : ['start', '--workspace', workspacePath]
  const proc = cp.spawn(command, commandArgs, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: [
        '/usr/local/bin', '/opt/homebrew/bin',
        '/usr/local/opt/node@20/bin', '/opt/homebrew/opt/node@20/bin',
        `${os.homedir()}/.npm-global/bin`,
        `${os.homedir()}/.npm-packages/bin`,
        process.env.PATH ?? '',
      ].join(':'),
    },
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
