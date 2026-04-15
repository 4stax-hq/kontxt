import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { Memory, MemoryType, PrivacyLevel, EmbeddingTier } from '../types.js'

const VAULT_DIR = path.join(os.homedir(), '.kontxt')
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
      embedding_tier TEXT DEFAULT 'pseudo',
      superseded_by TEXT DEFAULT NULL,
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

  // Backfill embedding_tier for existing vaults.
  try {
    db.exec(`ALTER TABLE memories ADD COLUMN embedding_tier TEXT DEFAULT 'pseudo'`)
  } catch {}

  // Backfill superseded_by for existing vaults.
  try {
    db.exec(`ALTER TABLE memories ADD COLUMN superseded_by TEXT DEFAULT NULL`)
  } catch {}

  return db
}

export function insertMemory(db: Database.Database, memory: Memory): void {
  const stmt = db.prepare(`
    INSERT INTO memories VALUES (
      @id, @content, @summary, @source, @type,
      @embedding, @embedding_tier, @superseded_by, @tags, @project, @related_ids,
      @privacy_level, @importance_score, @access_count,
      @created_at, @accessed_at
    )
  `)

  stmt.run({
    ...memory,
    embedding: Buffer.from(new Float32Array(memory.embedding).buffer),
    embedding_tier: memory.embedding_tier || 'pseudo',
    superseded_by: memory.superseded_by ?? null,
    tags: JSON.stringify(memory.tags),
    related_ids: JSON.stringify(memory.related_ids),
  })
}

export function getAllMemories(db: Database.Database): Memory[] {
  const rows = db.prepare('SELECT * FROM memories WHERE superseded_by IS NULL ORDER BY created_at DESC').all() as any[]
  return rows.map(deserializeRow)
}

function normalizeMemoryContent(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s:/.-]/g, '')
    .trim()
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
  try {
    db.prepare(`
      UPDATE memories 
      SET access_count = access_count + 1, accessed_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id)
  } catch {
    // Retrieval should still work even when the DB is temporarily read-only.
  }
}

export function deleteMemory(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM memories WHERE id = ?').run(id)
}

/** Remove all memories whose source starts with prefix (e.g. living-md rel path key). */
export function deleteMemoriesWithSourcePrefix(db: Database.Database, prefix: string): number {
  const result = db.prepare('DELETE FROM memories WHERE source LIKE ?').run(prefix + '%')
  return result.changes
}

export function supersedeMemory(db: Database.Database, id: string, supersededById: string): void {
  db.prepare(`
    UPDATE memories
    SET superseded_by = ?
    WHERE id = ?
      AND (superseded_by IS NULL OR superseded_by = '')
  `).run(supersededById, id)
}

function deserializeRow(row: any): Memory {
  return {
    ...row,
    embedding: row.embedding
      ? Array.from(new Float32Array(row.embedding.buffer))
      : [],
    embedding_tier: row.embedding_tier || 'pseudo',
    superseded_by: row.superseded_by ?? null,
    tags: JSON.parse(row.tags || '[]'),
    related_ids: JSON.parse(row.related_ids || '[]'),
  }
}

export function findSimilarMemory(
  db: Database.Database,
  embedding: number[],
  threshold = 0.92,
  embeddingTier?: EmbeddingTier
): Memory | null {
  const all = getAllMemories(db)
  if (all.length === 0) return null

  let best: Memory | null = null
  let bestScore = 0

  for (const memory of all) {
    if (embeddingTier && memory.embedding_tier !== embeddingTier) continue
    if (memory.embedding.length === 0) continue
    const len = Math.min(embedding.length, memory.embedding.length)
    const dot = embedding.slice(0, len).reduce((sum, v, i) => sum + v * memory.embedding[i], 0)
    const magA = Math.sqrt(embedding.slice(0, len).reduce((s, v) => s + v * v, 0))
    const magB = Math.sqrt(memory.embedding.slice(0, len).reduce((s, v) => s + v * v, 0))
    const sim = magA && magB ? dot / (magA * magB) : 0
    if (sim > bestScore) { bestScore = sim; best = memory }
  }

  return bestScore >= threshold ? best : null
}

export function findMemoryByContent(db: Database.Database, content: string): Memory | null {
  const normalized = normalizeMemoryContent(content)
  return getAllMemories(db).find(memory => normalizeMemoryContent(memory.content) === normalized) || null
}

export function updateMemoryContent(
  db: Database.Database,
  id: string,
  content: string,
  embedding: number[],
  embeddingTier: EmbeddingTier
): void {
  db.prepare(`
    UPDATE memories
    SET content = ?, summary = ?, embedding = ?, embedding_tier = ?, accessed_at = ?
    WHERE id = ?
  `).run(
    content,
    content.slice(0, 100),
    Buffer.from(new Float32Array(embedding).buffer),
    embeddingTier,
    new Date().toISOString(),
    id
  )
}
