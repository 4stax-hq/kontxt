import chalk from 'chalk'
import path from 'path'
import fs from 'fs'
import chokidar from 'chokidar'
import ora from 'ora'
import { getDb, deleteMemoriesWithSourcePrefix } from '../../vault/db.js'
import {
  collectLivingMdFiles,
  ingestLivingMarkdownFile,
  isLivingMdPath,
  LIVING_MD_FILES,
} from '../../living-md.js'

export async function watchCommand(options: {
  dir?: string
  project?: string
  debounce?: string
  once?: boolean
}) {
  const repoRoot = path.resolve(options.dir || process.cwd())
  const projectName = options.project || path.basename(repoRoot)
  const debounceMs = Math.max(100, parseInt(options.debounce || '800', 10) || 800)

  if (!fs.existsSync(repoRoot)) {
    console.log(chalk.red('\n  directory not found: ' + repoRoot + '\n'))
    return
  }

  const db = getDb()

  const runIngest = async (absPath: string) => {
    if (!isLivingMdPath(repoRoot, absPath)) return
    try {
      const { chunks } = await ingestLivingMarkdownFile(db, repoRoot, absPath, {
        project: projectName,
      })
      const rel = path.relative(repoRoot, absPath)
      console.log(chalk.green('  ✓ ingested ') + rel + chalk.gray(` (${chunks} chunk(s))`))
    } catch (e) {
      console.log(chalk.red('  ✗ ingest failed: ' + (e as Error).message))
    }
  }

  const ingestAll = async () => {
    const files = collectLivingMdFiles(repoRoot)
    if (!files.length) {
      console.log(
        chalk.yellow('\n  no living markdown found — run ') +
          chalk.cyan('kontxt living init') +
          chalk.yellow(' or add .kontxt/*.md\n')
      )
      return
    }
    const spinner = ora('ingesting living markdown...').start()
    for (const f of files) {
      spinner.text = 'ingesting ' + path.relative(repoRoot, f)
      await runIngest(f)
    }
    spinner.succeed('living markdown sync complete')
  }

  if (options.once) {
    console.log(chalk.cyan('\n  kontxt watch --once: ') + repoRoot)
    console.log(chalk.gray('  project: ' + projectName + '\n'))
    await ingestAll()
    return
  }

  console.log(chalk.cyan('\n  kontxt watch — living workspace markdown'))
  console.log(chalk.gray('  root: ' + repoRoot))
  console.log(chalk.gray('  project: ' + projectName))
  console.log(chalk.gray('  debounce: ' + debounceMs + 'ms'))
  console.log(chalk.gray('  Ctrl+C to stop\n'))

  await ingestAll()

  fs.mkdirSync(path.join(repoRoot, '.kontxt'), { recursive: true })

  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  const schedule = (absPath: string) => {
    const prev = pending.get(absPath)
    if (prev) clearTimeout(prev)
    pending.set(
      absPath,
      setTimeout(async () => {
        pending.delete(absPath)
        await runIngest(absPath)
      }, debounceMs)
    )
  }

  const watcher = chokidar.watch(
    [
      path.join(repoRoot, '.kontxt', '*.md'),
      ...Object.keys(LIVING_MD_FILES).map(n => path.join(repoRoot, n)),
    ],
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    }
  )

  watcher.on('add', p => schedule(path.resolve(p)))
  watcher.on('change', p => schedule(path.resolve(p)))
  watcher.on('unlink', p => {
    const abs = path.resolve(p)
    if (!isLivingMdPath(repoRoot, abs)) return
    const rel = path.relative(repoRoot, abs)
    const norm = rel.split(path.sep).join('/')
    const n = deleteMemoriesWithSourcePrefix(db, `living-md:${norm}:`)
    console.log(chalk.gray('  removed vault entries for ') + rel + chalk.gray(` (${n})`))
  })

  const shutdown = async () => {
    await watcher.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}
