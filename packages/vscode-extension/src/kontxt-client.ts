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
  // Always ensure model is current
  if (!config.extractionModel || config.extractionModel === 'claude-3-haiku-20240307') {
    config.extractionModel = 'claude-haiku-4-5-20251001'
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

export function runKontxtCli(args: string[], workspacePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn('kontxt', args, {
      cwd: workspacePath,
      env: { ...process.env },
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
    proc.on('error', reject)
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
