import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Every known AI agent that writes memory/context files to disk
const AGENT_FILES: Array<{ pattern: string; agent: string }> = [
  { pattern: 'CLAUDE.md',                            agent: 'claude-code'   },
  { pattern: '.claude/memory.md',                    agent: 'claude-code'   },
  { pattern: '.cursor/rules',                        agent: 'cursor'        },
  { pattern: '.cursorrules',                         agent: 'cursor'        },
  { pattern: 'AGENTS.md',                            agent: 'openai-agents' },
  { pattern: '.github/copilot-instructions.md',      agent: 'copilot'       },
  { pattern: 'COPILOT_INSTRUCTIONS.md',              agent: 'copilot'       },
  { pattern: 'GEMINI.md',                            agent: 'gemini'        },
  { pattern: '.gemini/context.md',                   agent: 'gemini'        },
  { pattern: 'WINDSURF.md',                          agent: 'windsurf'      },
  { pattern: '.windsurfrules',                       agent: 'windsurf'      },
  { pattern: 'CONTEXT.md',                           agent: 'generic'       },
  { pattern: 'MEMORY.md',                            agent: 'generic'       },
  { pattern: '.ai/memory.md',                        agent: 'generic'       },
  { pattern: '.ai/context.md',                       agent: 'generic'       },
]

// Exclude our own kontxt files from re-ingestion
const KONTXT_OWNED = new Set([
  '.kontxt/CONTEXT.md',
  '.kontxt/DECISIONS.md',
  '.kontxt/FACTS.md',
  '.kontxt/TIMELINE.md',
])

export interface AgentFileChange {
  filePath:    string
  content:     string
  agent:       string
  workspacePath: string
}

type ChangeHandler = (change: AgentFileChange) => void

export function watchAgentFiles(
  workspacePath: string,
  onChange: ChangeHandler
): () => void {
  const seenHashes = new Map<string, string>()
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const watchers: fs.FSWatcher[] = []

  function contentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  function handleChange(filePath: string, agent: string) {
    const existing = debounceTimers.get(filePath)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      debounceTimers.delete(filePath)
      if (!fs.existsSync(filePath)) return

      let content: string
      try {
        content = fs.readFileSync(filePath, 'utf-8').trim()
      } catch {
        return
      }

      if (!content || content.length < 50) return // too short to have signal

      const hash = contentHash(content)
      if (seenHashes.get(filePath) === hash) return // unchanged
      seenHashes.set(filePath, hash)

      onChange({ filePath, content, agent, workspacePath })
    }, 4000) // 4s debounce — wait for agent to finish writing

    debounceTimers.set(filePath, timer)
  }

  for (const { pattern, agent } of AGENT_FILES) {
    const rel = pattern
    if (KONTXT_OWNED.has(rel)) continue

    const fullPath = path.join(workspacePath, rel)

    // Seed the hash if file already exists on startup (don't re-ingest on first watch)
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8').trim()
        seenHashes.set(fullPath, contentHash(content))
      } catch {}
    }

    // Watch the directory containing the file, not the file itself
    // (some editors write via rename, which file watchers miss)
    const dir = path.dirname(fullPath)
    const basename = path.basename(fullPath)

    try {
      if (!fs.existsSync(dir)) continue

      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (filename === basename) {
          handleChange(fullPath, agent)
        }
      })
      watcher.on('error', () => {})
      watchers.push(watcher)
    } catch {}
  }

  // Return cleanup function
  return () => {
    for (const t of debounceTimers.values()) clearTimeout(t)
    for (const w of watchers) { try { w.close() } catch {} }
  }
}

// Check a workspace for existing agent files and return their content
// Used by `kontxt init` to bootstrap from what agents already know
export function readExistingAgentFiles(workspacePath: string): Array<{ content: string; agent: string; file: string }> {
  const found: Array<{ content: string; agent: string; file: string }> = []

  for (const { pattern, agent } of AGENT_FILES) {
    if (KONTXT_OWNED.has(pattern)) continue
    const fullPath = path.join(workspacePath, pattern)
    if (!fs.existsSync(fullPath)) continue
    try {
      const content = fs.readFileSync(fullPath, 'utf-8').trim()
      if (content.length >= 50) {
        found.push({ content, agent, file: pattern })
      }
    } catch {}
  }

  return found
}
