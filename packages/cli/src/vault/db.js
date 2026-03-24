"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.insertMemory = insertMemory;
exports.getAllMemories = getAllMemories;
exports.searchByKeyword = searchByKeyword;
exports.incrementAccess = incrementAccess;
exports.deleteMemory = deleteMemory;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const VAULT_DIR = path_1.default.join(os_1.default.homedir(), '.mnemix');
const DB_PATH = path_1.default.join(VAULT_DIR, 'vault.db');
function getDb() {
    if (!fs_1.default.existsSync(VAULT_DIR)) {
        fs_1.default.mkdirSync(VAULT_DIR, { recursive: true });
    }
    const db = new better_sqlite3_1.default(DB_PATH);
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
  `);
    return db;
}
function insertMemory(db, memory) {
    const stmt = db.prepare(`
    INSERT INTO memories VALUES (
      @id, @content, @summary, @source, @type,
      @embedding, @tags, @project, @related_ids,
      @privacy_level, @importance_score, @access_count,
      @created_at, @accessed_at
    )
  `);
    stmt.run({
        ...memory,
        embedding: Buffer.from(new Float32Array(memory.embedding).buffer),
        tags: JSON.stringify(memory.tags),
        related_ids: JSON.stringify(memory.related_ids),
    });
}
function getAllMemories(db) {
    const rows = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
    return rows.map(deserializeRow);
}
function searchByKeyword(db, query) {
    const rows = db.prepare(`
    SELECT * FROM memories 
    WHERE content LIKE ? OR summary LIKE ? OR tags LIKE ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(`%${query}%`, `%${query}%`, `%${query}%`);
    return rows.map(deserializeRow);
}
function incrementAccess(db, id) {
    db.prepare(`
    UPDATE memories 
    SET access_count = access_count + 1, accessed_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);
}
function deleteMemory(db, id) {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
}
function deserializeRow(row) {
    return {
        ...row,
        embedding: row.embedding
            ? Array.from(new Float32Array(row.embedding.buffer))
            : [],
        tags: JSON.parse(row.tags || '[]'),
        related_ids: JSON.parse(row.related_ids || '[]'),
    };
}
