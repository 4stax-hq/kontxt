import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { LIVING_MD_FILES } from '../../living-md.js'
import { LIVING_TEMPLATES } from '../../living-files.js'

export async function livingInitCommand(options: { dir?: string; force?: boolean }) {
  const repoRoot = path.resolve(options.dir || process.cwd())
  const dir = path.join(repoRoot, '.kontxt')

  if (!fs.existsSync(repoRoot)) {
    console.log(chalk.red('\n  directory not found: ' + repoRoot + '\n'))
    return
  }

  fs.mkdirSync(dir, { recursive: true })
  console.log(chalk.cyan('\n  kontxt living init — ') + dir + '\n')

  for (const name of Object.keys(LIVING_MD_FILES)) {
    const target = path.join(dir, name)
    if (fs.existsSync(target) && !options.force) {
      console.log(chalk.gray('  skip (exists): ') + path.relative(repoRoot, target))
      continue
    }
    const body = LIVING_TEMPLATES[name] || `# ${name.replace(/\.md$/i, '')}\n\n`
    fs.writeFileSync(target, body, 'utf-8')
    console.log(chalk.green('  ✓ wrote ') + path.relative(repoRoot, target))
  }

  console.log(
    chalk.cyan('\n  next: ') +
      chalk.gray('run ') +
      chalk.white('kontxt watch --dir .') +
      chalk.gray(' or ') +
      chalk.white('kontxt watch --once') +
      chalk.gray(' to ingest.\n')
  )
}
