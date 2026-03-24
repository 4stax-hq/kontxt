import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { Memory, MemoryType, PrivacyLevel } from '@mnemix/core'

const VAULT_DIR = path.join(os.homedir(), '.mnemix')
const DB_PATH = path.join(VAULT_DIR, 'vault.db')

export function getDb(): Database.Database {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true })
  }

  const db = new Database(DB_PATH)

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      embedding BLOB,
      tags TEXT DEFAULT '[]',
      project TEXT,
      related_ids TEXT DEFAULT '[]',
      privacy_level TEXT DEFAULT 'private',
      importance_score REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      accessed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at);
  `)

  return db
}

export function insertMemory(db: Database.Database, memory: Memory): void {
  const stmt = db.prepare(`
    INSERT INTO memories VALUES (
      @id, @content, @summary, @source, @type,
      @embedding, @tags, @project, @related_ids,
      @privacy_level, @importance_score, @access_count,
      @created_at, @accessed_at
    )
  `)

  stmt.run({
    ...memory,
    embedding: Buffer.from(new Float32Array(memory.embedding).buffer),
    tags: JSON.stringify(memory.tags),
    related_ids: JSON.stringify(memory.related_ids),
  })
}

export function getAllMemories(db: Database.Database): Memory[] {
  const rows = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all() as any[]
  return rows.map(deserializeRow)
}

export function searchByKeyword(db: Database.Database, query: string): Memory[] {
  const rows = db.prepare(`
    SELECT * FROM memories 
    WHERE content LIKE ? OR summary LIKE ? OR tags LIKE ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(`%${query}%`, `%${query}%`, `%${query}%`) as any[]
  return rows.map(deserializeRow)
}

export function incrementAccess(db: Database.Database, id: string): void {
  db.prepare(`
    UPDATE memories 
    SET access_count = access_count + 1, accessed_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id)
}

export function deleteMemory(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM memories WHERE id = ?').run(id)
}

function deserializeRow(row: any): Memory {
  return {
    ...row,
    embedding: row.embedding
      ? Array.from(new Float32Array(row.embedding.buffer))
      : [],
    tags: JSON.parse(row.tags || '[]'),
    related_ids: JSON.parse(row.related_ids || '[]'),
  }
}
