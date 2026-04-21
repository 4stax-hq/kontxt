import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { DB_PATH, KONTXT_DIR } from '../constants'
import type { Entry, EntryType, Project, Session } from '../types'

export type { Database }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  project TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project',
  source_surface TEXT NOT NULL,
  session_id TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  embedding BLOB,
  superseded_by TEXT DEFAULT NULL,
  version_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_project ON entries(project);
CREATE INDEX IF NOT EXISTS idx_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_updated ON entries(updated_at);
CREATE INDEX IF NOT EXISTS idx_superseded ON entries(superseded_by);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS syntheses (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  entry_snapshot INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_syntheses_scope ON syntheses(scope);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_path TEXT NOT NULL UNIQUE,
  current_focus TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);
`

export function getDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_PATH
  if (!fs.existsSync(path.dirname(resolvedPath))) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  }
  const db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

function entryFromRow(row: Record<string, unknown>): Entry {
  return {
    id: row.id as string,
    content: row.content as string,
    type: row.type as EntryType,
    project: row.project as string,
    scope: row.scope as 'project' | 'global',
    sourceSurface: row.source_surface as Entry['sourceSurface'],
    sessionId: row.session_id as string | null,
    confidence: row.confidence as number,
    embedding: row.embedding ? new Float32Array((row.embedding as Buffer).buffer) : null,
    supersededBy: row.superseded_by as string | null,
    versionCount: row.version_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    accessCount: row.access_count as number,
  }
}

export function insertEntry(db: Database.Database, entry: Entry): void {
  const embeddingBuffer = entry.embedding ? Buffer.from(entry.embedding.buffer) : null
  db.prepare(`
    INSERT INTO entries (id, content, type, project, scope, source_surface, session_id,
      confidence, embedding, superseded_by, version_count, created_at, updated_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id, entry.content, entry.type, entry.project, entry.scope,
    entry.sourceSurface, entry.sessionId, entry.confidence, embeddingBuffer,
    entry.supersededBy, entry.versionCount, entry.createdAt, entry.updatedAt, entry.accessCount
  )
}

export function mergeEntry(
  db: Database.Database,
  id: string,
  newContent: string,
  newEmbedding: Float32Array
): void {
  const embeddingBuffer = Buffer.from(newEmbedding.buffer)
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE entries
    SET content = ?, embedding = ?, version_count = version_count + 1, updated_at = ?
    WHERE id = ?
  `).run(newContent, embeddingBuffer, now, id)
}

export function getEntriesForProject(
  db: Database.Database,
  project: string,
  types?: EntryType[]
): Entry[] {
  if (types && types.length > 0) {
    const placeholders = types.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT * FROM entries WHERE project = ? AND type IN (${placeholders})
      ORDER BY updated_at DESC
    `).all(project, ...types) as Record<string, unknown>[]
    return rows.map(entryFromRow)
  }
  const rows = db.prepare(`
    SELECT * FROM entries WHERE project = ? ORDER BY updated_at DESC
  `).all(project) as Record<string, unknown>[]
  return rows.map(entryFromRow)
}

export function getAllActiveEntries(db: Database.Database, project: string): Entry[] {
  const rows = db.prepare(`
    SELECT * FROM entries
    WHERE project = ? AND superseded_by IS NULL
    ORDER BY updated_at DESC
  `).all(project) as Record<string, unknown>[]
  return rows.map(entryFromRow)
}

export function upsertProject(db: Database.Database, project: Project): void {
  db.prepare(`
    INSERT INTO projects (id, name, workspace_path, current_focus, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_path) DO UPDATE SET
      name = excluded.name,
      current_focus = excluded.current_focus,
      last_active_at = excluded.last_active_at
  `).run(
    project.id, project.name, project.workspacePath,
    project.currentFocus, project.createdAt, project.lastActiveAt
  )
}

export function getProject(db: Database.Database, workspacePath: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE workspace_path = ?').get(workspacePath) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    name: row.name as string,
    workspacePath: row.workspace_path as string,
    currentFocus: row.current_focus as string | null,
    createdAt: row.created_at as string,
    lastActiveAt: row.last_active_at as string,
  }
}

export function getProjectByName(db: Database.Database, name: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    name: row.name as string,
    workspacePath: row.workspace_path as string,
    currentFocus: row.current_focus as string | null,
    createdAt: row.created_at as string,
    lastActiveAt: row.last_active_at as string,
  }
}

export function insertSession(db: Database.Database, session: Session): void {
  db.prepare(`
    INSERT INTO sessions (id, project, started_at, ended_at, summary, entry_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session.id, session.project, session.startedAt, session.endedAt, session.summary, session.entryCount)
}

export function updateSessionEnd(
  db: Database.Database,
  id: string,
  endedAt: string,
  summary: string | null,
  entryCount: number
): void {
  db.prepare(`
    UPDATE sessions SET ended_at = ?, summary = ?, entry_count = ? WHERE id = ?
  `).run(endedAt, summary, entryCount, id)
}

export function getLastSession(db: Database.Database, project: string): Session | null {
  const row = db.prepare(`
    SELECT * FROM sessions WHERE project = ? AND ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1
  `).get(project) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    project: row.project as string,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string | null,
    summary: row.summary as string | null,
    entryCount: row.entry_count as number,
  }
}

export function incrementAccessCount(db: Database.Database, id: string): void {
  db.prepare('UPDATE entries SET access_count = access_count + 1 WHERE id = ?').run(id)
}

export interface Synthesis {
  id: string
  scope: string
  content: string
  entrySnapshot: number
  createdAt: string
  expiresAt: string
}

export function getSynthesis(db: Database.Database, scope: string): Synthesis | null {
  const now = new Date().toISOString()
  const row = db.prepare(
    'SELECT * FROM syntheses WHERE scope = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1'
  ).get(scope, now) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    scope: row.scope as string,
    content: row.content as string,
    entrySnapshot: row.entry_snapshot as number,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  }
}

export function upsertSynthesis(db: Database.Database, scope: string, content: string, entryCount: number): void {
  const now = new Date()
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  db.prepare('DELETE FROM syntheses WHERE scope = ?').run(scope)
  db.prepare(
    'INSERT INTO syntheses (id, scope, content, entry_snapshot, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(require('uuid').v4(), scope, content, entryCount, now.toISOString(), expires)
}

export function countActiveEntries(db: Database.Database, project: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as n FROM entries WHERE project = ? AND superseded_by IS NULL'
  ).get(project) as { n: number }
  return row?.n ?? 0
}

export function getCrossProjectEntries(
  db: Database.Database,
  excludeProject: string,
  types?: import('../types').EntryType[]
): import('../types').Entry[] {
  let rows: Record<string, unknown>[]

  if (types && types.length > 0) {
    const placeholders = types.map(() => '?').join(',')
    rows = db.prepare(`
      SELECT * FROM entries
      WHERE project != ?
        AND project != '__global__'
        AND scope = 'project'
        AND superseded_by IS NULL
        AND type IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT 200
    `).all(excludeProject, ...types) as Record<string, unknown>[]
  } else {
    rows = db.prepare(`
      SELECT * FROM entries
      WHERE project != ?
        AND project != '__global__'
        AND scope = 'project'
        AND superseded_by IS NULL
      ORDER BY updated_at DESC
      LIMIT 200
    `).all(excludeProject) as Record<string, unknown>[]
  }

  return rows.map(entryFromRow)
}
