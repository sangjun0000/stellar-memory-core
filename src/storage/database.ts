import { DatabaseSync } from 'node:sqlite';
import { loadVecExtension, VEC_DDL } from './vec.js';

// Singleton instance
let _db: DatabaseSync | null = null;

const DDL = `
-- Core memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'observation',
  tags TEXT DEFAULT '[]',
  distance REAL NOT NULL DEFAULT 5.0,
  importance REAL NOT NULL DEFAULT 0.5,
  velocity REAL NOT NULL DEFAULT 0.0,
  impact REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  metadata TEXT DEFAULT '{}',
  source TEXT DEFAULT 'manual',
  source_path TEXT,
  source_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Data sources table: tracks directories registered for scanning
CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'active',
  last_scanned_at TEXT,
  file_count INTEGER DEFAULT 0,
  total_size INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for deduplication lookup
CREATE INDEX IF NOT EXISTS idx_memories_source_path
  ON memories(source_path)
  WHERE source_path IS NOT NULL;

-- Sun state — one row per project, acts as the "star" context
CREATE TABLE IF NOT EXISTS sun_state (
  project TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  current_work TEXT DEFAULT '',
  recent_decisions TEXT DEFAULT '[]',
  next_steps TEXT DEFAULT '[]',
  active_errors TEXT DEFAULT '[]',
  project_context TEXT DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  last_commit_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit log of orbital position changes
CREATE TABLE IF NOT EXISTS orbit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  project TEXT NOT NULL,
  old_distance REAL NOT NULL,
  new_distance REAL NOT NULL,
  old_importance REAL NOT NULL,
  new_importance REAL NOT NULL,
  trigger TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, summary, tags,
  content='memories', content_rowid='rowid'
);

-- Keep FTS index in sync with the memories table
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, summary, tags)
  VALUES (new.rowid, new.content, new.summary, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
  VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
  VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
  INSERT INTO memories_fts(rowid, content, summary, tags)
  VALUES (new.rowid, new.content, new.summary, new.tags);
END;

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_memories_project
  ON memories(project);

CREATE INDEX IF NOT EXISTS idx_memories_project_distance
  ON memories(project, distance);

CREATE INDEX IF NOT EXISTS idx_memories_project_importance
  ON memories(project, importance DESC);

CREATE INDEX IF NOT EXISTS idx_memories_deleted
  ON memories(deleted_at);
`;

export function initDatabase(dbPath: string): DatabaseSync {
  // allowExtension is required for sqlite-vec to load its native module.
  const db = new DatabaseSync(dbPath, { allowExtension: true });

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');

  // Load sqlite-vec extension (must be before DDL that references vec0)
  try {
    loadVecExtension(db);
  } catch (err) {
    // Non-fatal: vec extension may be unavailable in some test environments.
    // Vector search will fall back to FTS5-only mode.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[stellar-memory] sqlite-vec not available: ${msg}\n`);
  }

  // Create all tables, triggers, and indexes
  db.exec(DDL);

  // Create vector tables (separated so they run after the extension loads)
  try {
    db.exec(VEC_DDL);
  } catch {
    // vec0 tables require the extension; skip silently if it wasn't loaded.
  }

  _db = db;
  return db;
}

export function getDatabase(): DatabaseSync {
  if (!_db) {
    throw new Error(
      'Database not initialized. Call initDatabase(dbPath) before using getDatabase().'
    );
  }
  return _db;
}

// Allow tests to reset the singleton (e.g., open an in-memory DB)
export function resetDatabase(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // Ignore close errors during reset
    }
  }
  _db = null;
}
