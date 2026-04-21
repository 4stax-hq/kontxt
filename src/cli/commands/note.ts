import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { processDirectEntry } from '../../pipeline/writer'
import type { EntryType, RawEvent } from '../../types'

const VALID_TYPES = new Set<EntryType>([
  'decision', 'fact', 'blocker', 'progress', 'focus',
  'identity', 'goal', 'preference',
])

export async function noteCommand(
  text: string,
  type: string,
  workspacePath?: string,
  global = false
): Promise<void> {
  const entryType: EntryType = VALID_TYPES.has(type as EntryType) ? (type as EntryType) : 'fact'

  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  const event: RawEvent = {
    text,
    source: 'cli',
    // Global flag or global types get no workspace — classifier assigns __global__ project
    workspacePath: global ? undefined : (workspacePath ?? process.cwd()),
    projectName: global ? '__global__' : undefined,
    timestamp: new Date().toISOString(),
  }

  await processDirectEntry(entryType, text, event, db, config)
  console.log(`Recorded [${entryType}]${global ? ' (global)' : ''}: ${text}`)
}
