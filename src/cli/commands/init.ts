import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { processEvent } from '../../pipeline/writer'
import type { RawEvent } from '../../types'

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, timeout: 5000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function readFileSafe(filePath: string, maxChars = 800): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content.length > maxChars ? content.slice(0, maxChars) + '...' : content
  } catch {
    return ''
  }
}

function buildRepoSummary(workspacePath: string): string {
  const parts: string[] = []

  // package.json — name, description, stack signals from deps
  const pkgPath = path.join(workspacePath, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const depKeys = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      parts.push(`package.json:
  name: ${pkg.name ?? 'unknown'}
  description: ${pkg.description ?? 'none'}
  scripts: ${Object.keys(pkg.scripts ?? {}).join(', ')}
  key dependencies: ${depKeys.slice(0, 20).join(', ')}`)
    } catch {}
  }

  // README — first 600 chars
  for (const name of ['README.md', 'readme.md', 'README']) {
    const readme = readFileSafe(path.join(workspacePath, name), 600)
    if (readme) {
      parts.push(`README:\n${readme}`)
      break
    }
  }

  // Top-level directory structure
  try {
    const entries = fs.readdirSync(workspacePath).filter(e => !e.startsWith('.') && e !== 'node_modules' && e !== 'dist' && e !== '.git')
    parts.push(`Top-level structure: ${entries.join(', ')}`)
  } catch {}

  // Recent git log
  const gitLog = safeExec('git log --oneline -15', workspacePath)
  if (gitLog) parts.push(`Recent commits:\n${gitLog}`)

  // What changed recently
  const diffStat = safeExec('git diff --stat HEAD~5..HEAD 2>/dev/null || git diff --stat HEAD', workspacePath)
  if (diffStat) parts.push(`Recent file changes:\n${diffStat}`)

  // Current branch and status
  const branch = safeExec('git branch --show-current', workspacePath)
  const status = safeExec('git status --short', workspacePath)
  if (branch) parts.push(`Current branch: ${branch}`)
  if (status) parts.push(`Uncommitted changes:\n${status}`)

  return parts.join('\n\n')
}

const INIT_SYSTEM_PROMPT = `You are analyzing repository metadata to extract durable developer knowledge for an AI memory system.

From the signals provided (package.json, README, git history, file structure), extract:
- fact: concrete truths about this project an AI agent must know (stack, key services, ports, env vars, architecture patterns)
- focus: what the developer is currently working on based on recent commits and branch name
- progress: recently completed things visible in git history
- decision: architectural choices evident from the stack or README

Be specific. Use the actual project name, real dependency names, real script names.
Do NOT extract generic things ("uses git", "has tests", "written in TypeScript").

Return ONLY a JSON array:
[{"type":"fact|focus|progress|decision","content":"...","confidence":0.0-1.0}]
Omit items with confidence below 0.7. If you cannot determine something specifically, omit it.`

export async function initCommand(workspacePath: string): Promise<void> {
  ensureKontxtDir()
  const config = loadConfig()

  if (!config.anthropicKey && !config.openaiKey) {
    console.error('No API key set. Run: kontxt config set anthropic-key <key>')
    process.exit(1)
  }

  const db = getDb()
  const summary = buildRepoSummary(workspacePath)

  if (!summary.trim()) {
    console.error('Could not read any project signals from this directory.')
    process.exit(1)
  }

  console.log('Analyzing repository...')

  // Use the extractor infrastructure but with our init-specific system prompt
  // by directly calling the API with the custom prompt
  let items: Array<{ type: string; content: string; confidence: number }> = []

  if (config.anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: config.anthropicKey })
      const response = await client.messages.create({
        model: config.extractionModel ?? 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: INIT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: summary }],
      })
      const content = response.content[0]
      if (content.type === 'text') {
        items = parseItems(content.text)
      }
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
        max_tokens: 1024,
      })
      items = parseItems(response.choices[0]?.message?.content ?? '')
    } catch (err) {
      console.error('Extraction failed:', err)
      process.exit(1)
    }
  }

  if (items.length === 0) {
    console.log('No high-confidence entries extracted. Try adding a README or more commit history.')
    return
  }

  // Write each item as a direct entry (bypass re-extraction)
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

  console.log(`\nInitialized: ${stored} entries written`)
  console.log(`Context file: ${workspacePath}/.kontxt/CONTEXT.md`)
}

function parseItems(raw: string): Array<{ type: string; content: string; confidence: number }> {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(i => i && typeof i.type === 'string' && typeof i.content === 'string' && (i.confidence ?? 1) >= 0.7)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      return JSON.parse(match[0])
    } catch {
      return []
    }
  }
}
