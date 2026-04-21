import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Database } from '../storage/db'
import { getProject, upsertProject } from '../storage/db'
import type { ExtractedItem, RawEvent, Project, EntryScope } from '../types'

export interface ClassifyResult {
  project: string
  scope: EntryScope
  projectRecord: Project
}

export function classify(
  item: ExtractedItem,
  event: RawEvent,
  db: Database.Database
): ClassifyResult {
  void item
  const now = new Date().toISOString()

  let projectRecord: Project

  if (event.projectName) {
    const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get(event.projectName) as Record<string, unknown> | undefined
    if (existing) {
      projectRecord = {
        id: existing.id as string,
        name: existing.name as string,
        workspacePath: existing.workspace_path as string,
        currentFocus: existing.current_focus as string | null,
        createdAt: existing.created_at as string,
        lastActiveAt: now,
      }
    } else {
      projectRecord = {
        id: uuidv4(),
        name: event.projectName,
        workspacePath: event.workspacePath ?? '',
        currentFocus: null,
        createdAt: now,
        lastActiveAt: now,
      }
    }
  } else if (event.workspacePath) {
    const existing = getProject(db, event.workspacePath)
    if (existing) {
      projectRecord = { ...existing, lastActiveAt: now }
    } else {
      const name = path.basename(event.workspacePath)
      projectRecord = {
        id: uuidv4(),
        name,
        workspacePath: event.workspacePath,
        currentFocus: null,
        createdAt: now,
        lastActiveAt: now,
      }
    }
  } else {
    const defaultName = 'default'
    const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get(defaultName) as Record<string, unknown> | undefined
    if (existing) {
      projectRecord = {
        id: existing.id as string,
        name: defaultName,
        workspacePath: '',
        currentFocus: existing.current_focus as string | null,
        createdAt: existing.created_at as string,
        lastActiveAt: now,
      }
    } else {
      projectRecord = {
        id: uuidv4(),
        name: defaultName,
        workspacePath: '',
        currentFocus: null,
        createdAt: now,
        lastActiveAt: now,
      }
    }
  }

  upsertProject(db, projectRecord)

  const scope: EntryScope = event.source === 'browser' ? 'global' : 'project'

  return {
    project: projectRecord.name,
    scope,
    projectRecord,
  }
}
