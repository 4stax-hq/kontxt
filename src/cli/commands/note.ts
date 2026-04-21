import { getDb } from '../../storage/db'
import { loadConfig, ensureKontxtDir } from '../../config'
import { processDirectEntry } from '../../pipeline/writer'
import type { EntryType, RawEvent } from '../../types'

const VALID_TYPES = new Set<EntryType>(['decision', 'fact', 'blocker', 'progress', 'focus'])

export async function noteCommand(text: string, type: string, workspacePath?: string): Promise<void> {
  const entryType: EntryType = VALID_TYPES.has(type as EntryType) ? (type as EntryType) : 'fact'

  ensureKontxtDir()
  const config = loadConfig()
  const db = getDb()

  const event: RawEvent = {
    text,
    source: 'cli',
    workspacePath: workspacePath ?? process.cwd(),
    timestamp: new Date().toISOString(),
  }

  await processDirectEntry(entryType, text, event, db, config)
  console.log(`Recorded [${entryType}]: ${text}`)
}
