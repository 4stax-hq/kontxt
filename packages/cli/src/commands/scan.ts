import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { getDb, insertMemory, findSimilarMemory, updateMemoryContent } from '../vault/db.js'
import { embedText } from '../vault/embed.js'
import { extractMemoriesFromTranscript } from '@mnemix/core'
import { MemoryType } from '@mnemix/core'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.mnemix', 'config.json')
function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

// Files worth reading for project context
const PRIORITY_FILES = [
  'README.md', 'readme.md',
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
  'docker-compose.yml', 'docker-compose.yaml',
  'Dockerfile',
  '.env.example', '.env.sample',
  'ARCHITECTURE.md', 'CONTRIBUTING.md', 'DESIGN.md',
]

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', 'tmp', 'temp', '__pycache__', '.venv',
  'venv', 'vendor', 'target', '.turbo', 'out'
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.java', '.rb', '.php', '.swift', '.kt', '.cs'
])

function readFileSafe(filePath: string, maxBytes = 8000): string {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 100000) return '' // skip huge files
    const content = fs.readFileSync(filePath, 'utf-8')
    return content.slice(0, maxBytes)
  } catch { return '' }
}

function collectFiles(dir: string, depth = 0, maxDepth = 3): string[] {
  if (depth > maxDepth) return []
  const files: string[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
      if (SKIP_DIRS.has(entry.name)) continue

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath, depth + 1, maxDepth))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        if (CODE_EXTENSIONS.has(ext) || PRIORITY_FILES.includes(entry.name)) {
          files.push(fullPath)
        }
      }
    }
  } catch {}

  return files
}

function buildProjectContext(dir: string): string {
  const parts: string[] = []
  const projectName = path.basename(dir)
  parts.push(`Project directory: ${projectName}`)

  // Priority files first — most signal per token
  for (const name of PRIORITY_FILES) {
    const filePath = path.join(dir, name)
    if (fs.existsSync(filePath)) {
      const content = readFileSafe(filePath, 4000)
      if (content) {
        parts.push(`\n--- ${name} ---\n${content}`)
      }
    }
  }

  // Collect source files, limit total context
  const allFiles = collectFiles(dir)
  const sourceFiles = allFiles.filter(f => {
    const name = path.basename(f)
    return !PRIORITY_FILES.includes(name) && CODE_EXTENSIONS.has(path.extname(f))
  })

  let totalChars = parts.join('').length
  const maxTotal = 20000

  for (const file of sourceFiles) {
    if (totalChars >= maxTotal) break
    const rel = path.relative(dir, file)
    const content = readFileSafe(file, 2000)
    if (!content.trim()) continue
    const chunk = `\n--- ${rel} ---\n${content}`
    parts.push(chunk)
    totalChars += chunk.length
  }

  return parts.join('\n')
}

async function storeMemories(
  extracted: { content: string; type: string }[],
  project?: string
): Promise<{ stored: number; updated: number; skipped: number }> {
  const db = getDb()
  let stored = 0, updated = 0, skipped = 0

  for (const item of extracted) {
    if (!item.content || !item.type) { skipped++; continue }
    try {
      const embedding = await embedText(item.content)
      const duplicate = findSimilarMemory(db, embedding, 0.92)

      if (duplicate) {
        updateMemoryContent(db, duplicate.id, item.content, embedding)
        console.log(chalk.yellow('  ~ updated  ' + item.content.slice(0, 70)))
        updated++
      } else {
        const now = new Date().toISOString()
        insertMemory(db, {
          id: uuid(),
          content: item.content,
          summary: item.content.slice(0, 100),
          source: 'scanned',
          type: item.type as MemoryType,
          embedding,
          tags: [],
          project,
          related_ids: [],
          privacy_level: 'private',
          importance_score: 0.8,
          access_count: 0,
          created_at: now,
          accessed_at: now,
        })
        console.log(chalk.green('  + ' + '[' + item.type + '] ' + item.content.slice(0, 70)))
        stored++
      }
    } catch { skipped++ }
  }

  return { stored, updated, skipped }
}

export async function scanCommand(options: { dir?: string; project?: string }) {
  const dir = path.resolve(options.dir || process.cwd())
  const projectName = options.project || path.basename(dir)

  if (!fs.existsSync(dir)) {
    console.log(chalk.red('\n  directory not found: ' + dir + '\n'))
    return
  }

  console.log(chalk.cyan('\n  scanning: ' + dir))
  console.log(chalk.gray('  project: ' + projectName + '\n'))

  const spinner = ora('reading project files...').start()

  const context = buildProjectContext(dir)
  const fileCount = (context.match(/^--- /gm) || []).length

  spinner.text = 'extracting facts from ' + fileCount + ' files...'

  const config = getConfig()
  const extracted = await extractMemoriesFromTranscript(context, config.openai_api_key)

  spinner.stop()

  if (!extracted.length) {
    console.log(chalk.yellow('  no facts extracted — try running ollama or setting an OpenAI key\n'))
    return
  }

  console.log(chalk.cyan('  found ' + extracted.length + ' facts — storing...\n'))

  const { stored, updated, skipped } = await storeMemories(extracted, projectName)

  console.log(chalk.cyan(
    '\n  scan complete: ' + stored + ' stored, ' + updated + ' updated, ' + skipped + ' skipped'
  ))
  console.log(chalk.gray('  project tagged as: ' + projectName))
  console.log(chalk.gray('  run: mnemix list --project ' + projectName + '\n'))
}
