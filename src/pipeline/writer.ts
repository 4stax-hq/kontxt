import { v4 as uuidv4 } from 'uuid'
import type { Database } from '../storage/db'
import { insertEntry, mergeEntry } from '../storage/db'
import { regenerateMdFiles } from '../storage/md-writer'
import { extractFromText } from './extractor'
import { classify } from './classifier'
import { deduplicate } from './deduplicator'
import type { Config } from '../config'
import type { RawEvent, Entry } from '../types'
import { MIN_CONFIDENCE } from '../constants'

export interface ProcessResult {
  stored: number
  merged: number
  skipped: number
}

export async function processEvent(
  event: RawEvent,
  db: Database.Database,
  config: Config,
  sessionId?: string
): Promise<ProcessResult> {
  const items = await extractFromText(event.text, {
    anthropicKey: config.anthropicKey,
    openaiKey: config.openaiKey,
  })

  let stored = 0
  let merged = 0
  let skipped = 0
  let lastProject = ''
  let lastWorkspacePath = ''

  for (const item of items) {
    if (item.confidence < MIN_CONFIDENCE) {
      skipped++
      continue
    }

    const { project, scope, projectRecord } = classify(item, event, db)
    lastProject = project
    lastWorkspacePath = projectRecord.workspacePath

    const { action, existingId, embedding } = await deduplicate(
      { ...item, project, scope },
      db,
      { openaiKey: config.openaiKey }
    )

    if (action === 'skip') {
      skipped++
    } else if (action === 'merge' && existingId) {
      mergeEntry(db, existingId, item.content, embedding)
      merged++
    } else {
      const now = new Date().toISOString()
      const entry: Entry = {
        id: uuidv4(),
        content: item.content,
        type: item.type,
        project,
        scope,
        sourceSurface: event.source,
        sessionId: sessionId ?? null,
        confidence: item.confidence,
        embedding,
        supersededBy: null,
        versionCount: 1,
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
      }
      insertEntry(db, entry)
      stored++
    }
  }

  if ((stored > 0 || merged > 0) && lastProject) {
    regenerateMdFiles(db, lastProject, lastWorkspacePath)
  }

  return { stored, merged, skipped }
}

export async function processDirectEntry(
  type: import('../types').EntryType,
  content: string,
  event: RawEvent,
  db: Database.Database,
  config: Config,
  sessionId?: string
): Promise<void> {
  const item = { type, content, confidence: 1.0 }
  const { project, scope, projectRecord } = classify(item, event, db)

  const { action, existingId, embedding } = await deduplicate(
    { ...item, project, scope },
    db,
    { openaiKey: config.openaiKey }
  )

  if (action === 'merge' && existingId) {
    mergeEntry(db, existingId, content, embedding)
  } else if (action === 'insert') {
    const now = new Date().toISOString()
    const entry: Entry = {
      id: uuidv4(),
      content,
      type,
      project,
      scope,
      sourceSurface: event.source,
      sessionId: sessionId ?? null,
      confidence: 1.0,
      embedding,
      supersededBy: null,
      versionCount: 1,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    }
    insertEntry(db, entry)
  }

  regenerateMdFiles(db, project, projectRecord.workspacePath)
}
