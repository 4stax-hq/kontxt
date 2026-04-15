import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import ora from 'ora'
import { getDb, getAllMemories } from '../../vault/db.js'
import { embedText } from '../../vault/embed.js'
import { rankMemories } from '../../retrieval.js'
import { prepareContinuityPacket, type ContinuityMode } from '../../continuity.js'
import { getSessionRecord, upsertSessionRecord } from '../../session-state.js'
import { extractMemoriesFromTranscript, type ExtractedMemory } from '../../extractor.js'
import { storeExtractedMemories } from '../../capture-store.js'
import {
  addLivingDecision,
  addLivingFact,
  addLivingTimelineNote,
  setLivingFocus,
} from '../../living-files.js'
import { readProjectState } from '../../project-state.js'

const CONFIG_PATH = path.join(os.homedir(), '.kontxt', 'config.json')

function resolveRepoRoot(dir?: string): string | undefined {
  if (!dir) return process.cwd()
  return path.resolve(dir)
}

function projectName(repoRoot?: string, explicit?: string): string {
  return explicit || (repoRoot ? path.basename(repoRoot) : 'default')
}

function readTranscript(file?: string): string {
  if (file) {
    if (!fs.existsSync(file)) throw new Error('file not found: ' + file)
    return fs.readFileSync(file, 'utf-8')
  }
  return fs.readFileSync('/dev/stdin', 'utf-8')
}

function getConfig(): any {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { return {} }
}

function normalizeSentence(value: string): string {
  return value
    .replace(/^The user\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function focusSentence(value: string): string {
  return normalizeSentence(value)
    .replace(/^(is|uses|used|prefers|wants|needs|will)\s+/i, '')
    .replace(/^\bbuilding\b/i, 'Building')
    .replace(/^\bworking on\b/i, 'Working on')
}

function sentenceToTitle(value: string): string {
  const cleaned = normalizeSentence(value)
    .replace(/\.$/, '')
    .replace(/^(is|uses|prefers|wants|needs|will|decided to|decided on)\s+/i, '')
    .trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 72)
}

async function updateLivingStateFromExtracted(
  extracted: ExtractedMemory[],
  repoRoot?: string,
  project?: string
): Promise<{ facts: number; decisions: number; timeline: number; focusUpdated: boolean }> {
  if (!repoRoot || !fs.existsSync(repoRoot)) {
    return { facts: 0, decisions: 0, timeline: 0, focusUpdated: false }
  }

  let facts = 0
  let decisions = 0
  let timeline = 0
  let focusUpdated = false

  const focusCandidate =
    extracted.find(item => item.type === 'project')?.content ||
    extracted.find(item => item.type === 'episodic')?.content

  if (focusCandidate) {
    await setLivingFocus(repoRoot, focusSentence(focusCandidate), project)
    focusUpdated = true
  }

  for (const item of extracted) {
    if (item.type === 'fact') {
      await addLivingFact(repoRoot, normalizeSentence(item.content), project)
      facts++
    } else if (item.type === 'decision') {
      await addLivingDecision(
        repoRoot,
        sentenceToTitle(item.content),
        normalizeSentence(item.content),
        'Captured from a completed AI session.',
        project
      )
      decisions++
    } else if (item.type === 'episodic' || item.type === 'project') {
      await addLivingTimelineNote(repoRoot, normalizeSentence(item.content), project)
      timeline++
    }
  }

  return { facts, decisions, timeline, focusUpdated }
}

export async function sessionStartCommand(
  query: string,
  options: {
    dir?: string
    project?: string
    mode?: ContinuityMode
    provider?: string
    limit?: string
    json?: boolean
  }
) {
  const repoRoot = resolveRepoRoot(options.dir)
  const project = projectName(repoRoot, options.project)
  const mode = options.mode || 'ask'
  const limit = Math.max(1, Number(options.limit || '8'))

  const spinner = ora('preparing continuity context...').start()
  try {
    const db = getDb()
    const all = getAllMemories(db)
    const { embedding: queryEmbedding, tier: queryTier } = await embedText(query)
    const results = rankMemories(all, { query, queryEmbedding, queryTier, limit, project })
    const session = getSessionRecord(repoRoot, project)
    const packet = prepareContinuityPacket({
      repoRoot,
      project,
      query,
      mode,
      results,
      session,
    })

    upsertSessionRecord({
      repo_root: repoRoot,
      project,
      provider: options.provider,
      last_started_at: new Date().toISOString(),
      last_query: query,
      last_action: packet.action,
      last_injection_preview: packet.preview,
    })

    spinner.stop()

    if (options.json) {
      console.log(JSON.stringify({
        action: packet.action,
        confidence: Number(packet.confidence.toFixed(3)),
        reason: packet.reason,
        project,
        query,
        text: packet.text,
        preview: packet.preview,
      }, null, 2))
      return
    }

    console.log(chalk.cyan('\n  kontxt session start\n'))
    console.log(chalk.gray('  project: ' + project))
    console.log(chalk.gray('  mode: ' + mode))
    if (options.provider) console.log(chalk.gray('  provider: ' + options.provider))
    console.log(chalk.gray('  action: ' + packet.action + ` (${packet.reason}, confidence=${packet.confidence.toFixed(2)})`))

    if (packet.action === 'skip') {
      console.log(chalk.yellow('\n  no context injected\n'))
      return
    }

    if (packet.action === 'ask') {
      console.log(chalk.yellow('\n  suggested context found — inject only if this session should continue prior work.\n'))
    } else {
      console.log(chalk.green('\n  continuity context prepared for injection.\n'))
    }

    console.log(packet.text + '\n')
  } catch (err: any) {
    spinner.fail(chalk.red('session start failed: ' + err.message))
  }
}

export async function sessionEndCommand(options: {
  file?: string
  dir?: string
  project?: string
  provider?: string
  limit?: string
  json?: boolean
}) {
  const repoRoot = resolveRepoRoot(options.dir)
  const project = projectName(repoRoot, options.project)
  const limit = Math.max(1, Number(options.limit || '50'))
  const transcript = readTranscript(options.file)

  if (!transcript.trim()) {
    console.log(chalk.red('no transcript provided'))
    return
  }

  const spinner = ora('finalizing session continuity...').start()
  try {
    const config = getConfig()
    const extracted = await extractMemoriesFromTranscript(transcript, config.openai_api_key)
    const stored = await storeExtractedMemories(extracted, {
      project,
      source: 'session-end',
      importanceScore: 0.72,
      limit,
    })
    const living = await updateLivingStateFromExtracted(stored.items, repoRoot, project)
    const snapshot = repoRoot && fs.existsSync(repoRoot) ? readProjectState(repoRoot) : null

    const summaryParts: string[] = []
    if (living.focusUpdated && snapshot?.focus[0]) summaryParts.push('focus=' + snapshot.focus[0])
    if (living.timeline) summaryParts.push(`timeline+${living.timeline}`)
    if (living.decisions) summaryParts.push(`decisions+${living.decisions}`)
    if (living.facts) summaryParts.push(`facts+${living.facts}`)
    const sessionSummary = summaryParts.join(' | ') || 'session captured'

    upsertSessionRecord({
      repo_root: repoRoot,
      project,
      provider: options.provider,
      last_ended_at: new Date().toISOString(),
      last_session_summary: sessionSummary,
    })

    spinner.stop()

    if (options.json) {
      console.log(JSON.stringify({
        project,
        extracted: stored.items.length,
        stored: stored.stored,
        updated: stored.updated,
        skipped: stored.skipped,
        living,
        summary: sessionSummary,
      }, null, 2))
      return
    }

    console.log(chalk.cyan('\n  kontxt session end\n'))
    console.log(chalk.gray('  project: ' + project))
    if (options.provider) console.log(chalk.gray('  provider: ' + options.provider))
    console.log(chalk.green(`  memories: stored=${stored.stored}, updated=${stored.updated}, skipped=${stored.skipped}`))
    console.log(chalk.green(`  living md: focus=${living.focusUpdated ? 'updated' : 'unchanged'}, timeline=${living.timeline}, decisions=${living.decisions}, facts=${living.facts}`))
    if (sessionSummary) console.log(chalk.gray('  summary: ' + sessionSummary))
    console.log()
  } catch (err: any) {
    spinner.fail(chalk.red('session end failed: ' + err.message))
  }
}
