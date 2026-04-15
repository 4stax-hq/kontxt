import chalk from 'chalk'
import path from 'path'
import {
  addLivingDecision,
  addLivingFact,
  addLivingTask,
  addLivingTimelineNote,
  setLivingFocus,
} from '../../living-files.js'

function resolveRepoRoot(dir?: string): string {
  return path.resolve(dir || process.cwd())
}

function defaultProjectName(repoRoot: string, project?: string): string {
  return project || path.basename(repoRoot)
}

export async function livingFocusCommand(focus: string, options: { dir?: string; project?: string }) {
  const repoRoot = resolveRepoRoot(options.dir)
  const target = await setLivingFocus(repoRoot, focus, defaultProjectName(repoRoot, options.project))
  console.log(chalk.green('\n  ✓ updated focus'))
  console.log(chalk.gray('  file: ' + path.relative(repoRoot, target)))
  console.log(chalk.gray('  focus: ' + focus + '\n'))
}

export async function livingTaskCommand(task: string, options: { dir?: string; project?: string }) {
  const repoRoot = resolveRepoRoot(options.dir)
  const target = await addLivingTask(repoRoot, task, defaultProjectName(repoRoot, options.project))
  console.log(chalk.green('\n  ✓ added task'))
  console.log(chalk.gray('  file: ' + path.relative(repoRoot, target)))
  console.log(chalk.gray('  task: ' + task + '\n'))
}

export async function livingFactCommand(fact: string, options: { dir?: string; project?: string }) {
  const repoRoot = resolveRepoRoot(options.dir)
  const target = await addLivingFact(repoRoot, fact, defaultProjectName(repoRoot, options.project))
  console.log(chalk.green('\n  ✓ added fact'))
  console.log(chalk.gray('  file: ' + path.relative(repoRoot, target)))
  console.log(chalk.gray('  fact: ' + fact + '\n'))
}

export async function livingDecisionCommand(
  title: string,
  options: { dir?: string; project?: string; decision: string; context?: string }
) {
  const repoRoot = resolveRepoRoot(options.dir)
  const target = await addLivingDecision(
    repoRoot,
    title,
    options.decision,
    options.context,
    defaultProjectName(repoRoot, options.project)
  )
  console.log(chalk.green('\n  ✓ added decision'))
  console.log(chalk.gray('  file: ' + path.relative(repoRoot, target)))
  console.log(chalk.gray('  title: ' + title))
  console.log(chalk.gray('  decision: ' + options.decision + '\n'))
}

export async function livingNoteCommand(
  text: string,
  options: { dir?: string; project?: string; date?: string }
) {
  const repoRoot = resolveRepoRoot(options.dir)
  const target = await addLivingTimelineNote(
    repoRoot,
    text,
    defaultProjectName(repoRoot, options.project),
    options.date
  )
  console.log(chalk.green('\n  ✓ added timeline note'))
  console.log(chalk.gray('  file: ' + path.relative(repoRoot, target)))
  console.log(chalk.gray('  note: ' + text + '\n'))
}
