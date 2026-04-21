import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Database } from '../storage/db'
import { getProject, upsertProject } from '../storage/db'
import type { ExtractedItem, RawEvent, Project, EntryScope } from '../types'

export const GLOBAL_PROJECT = '__global__'

// Types that are always user-level, never project-specific
const GLOBAL_TYPES = new Set(['identity', 'goal', 'preference'])

export interface ClassifyResult {
  project: string
  scope: EntryScope
  projectRecord: Project
}

function ensureGlobalProject(db: Database.Database, now: string): Project {
  const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get(GLOBAL_PROJECT) as Record<string, unknown> | undefined
  if (existing) {
    return {
      id:           existing.id as string,
      name:         GLOBAL_PROJECT,
      workspacePath: '',
      currentFocus: null,
      createdAt:    existing.created_at as string,
      lastActiveAt: now,
    }
  }
  return {
    id:           uuidv4(),
    name:         GLOBAL_PROJECT,
    workspacePath: '',
    currentFocus: null,
    createdAt:    now,
    lastActiveAt: now,
  }
}

export function classify(
  item: ExtractedItem,
  event: RawEvent,
  db: Database.Database
): ClassifyResult {
  const now = new Date().toISOString()

  // Global types and browser-source entries always go to __global__
  // Browser conversations are not reliably project-specific
  const isGlobal = GLOBAL_TYPES.has(item.type) || event.source === 'browser'

  if (isGlobal) {
    const projectRecord = ensureGlobalProject(db, now)
    upsertProject(db, projectRecord)
    return { project: GLOBAL_PROJECT, scope: 'global', projectRecord }
  }

  // Project-specific entries — resolve project from event
  let projectRecord: Project

  if (event.projectName && event.projectName !== GLOBAL_PROJECT) {
    const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get(event.projectName) as Record<string, unknown> | undefined
    if (existing) {
      projectRecord = {
        id:           existing.id as string,
        name:         existing.name as string,
        workspacePath: existing.workspace_path as string,
        currentFocus: existing.current_focus as string | null,
        createdAt:    existing.created_at as string,
        lastActiveAt: now,
      }
    } else {
      projectRecord = {
        id:           uuidv4(),
        name:         event.projectName,
        workspacePath: event.workspacePath ?? '',
        currentFocus: null,
        createdAt:    now,
        lastActiveAt: now,
      }
    }
  } else if (event.workspacePath) {
    const existing = getProject(db, event.workspacePath)
    if (existing) {
      projectRecord = { ...existing, lastActiveAt: now }
    } else {
      projectRecord = {
        id:           uuidv4(),
        name:         path.basename(event.workspacePath),
        workspacePath: event.workspacePath,
        currentFocus: null,
        createdAt:    now,
        lastActiveAt: now,
      }
    }
  } else {
    const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get('default') as Record<string, unknown> | undefined
    if (existing) {
      projectRecord = {
        id:           existing.id as string,
        name:         'default',
        workspacePath: '',
        currentFocus: existing.current_focus as string | null,
        createdAt:    existing.created_at as string,
        lastActiveAt: now,
      }
    } else {
      projectRecord = {
        id:           uuidv4(),
        name:         'default',
        workspacePath: '',
        currentFocus: null,
        createdAt:    now,
        lastActiveAt: now,
      }
    }
  }

  upsertProject(db, projectRecord)
  return { project: projectRecord.name, scope: 'project', projectRecord }
}
