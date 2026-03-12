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
  content_hash TEXT,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by TEXT,
  consolidated_into TEXT,
  quality_score REAL DEFAULT 0.5,
  is_universal INTEGER DEFAULT 0,
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

-- Index for content-hash deduplication
CREATE INDEX IF NOT EXISTS idx_memories_content_hash
  ON memories(project, content_hash)
  WHERE content_hash IS NOT NULL;

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

-- FTS5 virtual table for full-text search.
-- Uses the trigram tokenizer for reliable CJK (Korean/Japanese/Chinese) support
-- and substring matching. Trigram creates a larger index than the default
-- unicode61 tokenizer but handles all scripts without language-specific tuning.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, summary, tags,
  content='memories', content_rowid='rowid',
  tokenize='trigram'
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

CREATE INDEX IF NOT EXISTS idx_memories_project_created
  ON memories(project, created_at);

-- Knowledge Graph: Constellation edges
CREATE TABLE IF NOT EXISTS constellation_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memories(id),
  target_id TEXT NOT NULL REFERENCES memories(id),
  relation TEXT NOT NULL DEFAULT 'related_to',
  weight REAL NOT NULL DEFAULT 0.5,
  project TEXT NOT NULL DEFAULT 'default',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, target_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_constellation_source ON constellation_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_constellation_target ON constellation_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_constellation_project ON constellation_edges(project);

-- Conflict Detection
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  conflicting_memory_id TEXT NOT NULL REFERENCES memories(id),
  severity TEXT NOT NULL DEFAULT 'medium',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  project TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conflicts_project ON memory_conflicts(project);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON memory_conflicts(status);

-- Observation Log
CREATE TABLE IF NOT EXISTS observation_log (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  extracted_memories TEXT DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'conversation',
  project TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_observations_project ON observation_log(project);
`;

// Migrate existing databases that lack newer columns.
// Each entry: [column_name, column_definition]
const MIGRATIONS: Array<[string, string]> = [
  ['source', "TEXT DEFAULT 'manual'"],
  ['source_path', 'TEXT'],
  ['source_hash', 'TEXT'],
  ['content_hash', 'TEXT'],
  ['valid_from', 'TEXT'],
  ['valid_until', 'TEXT'],
  ['superseded_by', 'TEXT'],
  ['consolidated_into', 'TEXT'],
  ['quality_score', 'REAL DEFAULT 0.5'],
  ['is_universal', 'INTEGER DEFAULT 0'],
];

function migrateMemoriesTable(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));
  for (const [col, def] of MIGRATIONS) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE memories ADD COLUMN ${col} ${def};`);
    }
  }
}

/**
 * Migrate the FTS5 table from the old default (unicode61) tokenizer to the
 * trigram tokenizer, which provides reliable CJK and substring search support.
 *
 * Detection: query the FTS config table for the tokenize setting.
 * If it already says 'trigram' (or the table doesn't exist yet), do nothing.
 * Otherwise drop the old table + its triggers and let the main DDL recreate them.
 *
 * Dropping and recreating loses the FTS index but it is rebuilt automatically
 * from the content='memories' backing table on first query.
 */
function migrateFtsTokenizer(db: DatabaseSync): void {
  // Check whether the FTS table exists at all
  const tableRow = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'`
  ).get() as { name: string } | undefined;

  if (!tableRow) {
    // Table does not exist yet — main DDL will create it with the correct tokenizer.
    return;
  }

  // Read the tokenizer setting from the FTS config shadow table
  let currentTokenizer = '';
  try {
    const configRow = db.prepare(
      `SELECT v FROM memories_fts_config WHERE k = 'tokenize'`
    ).get() as { v: string } | undefined;
    currentTokenizer = configRow?.v ?? '';
  } catch {
    // The config shadow table may not be queryable this way in all SQLite builds.
    // Fall through to the recreation path to be safe.
  }

  if (currentTokenizer === 'trigram') {
    // Already on the correct tokenizer — nothing to do.
    return;
  }

  // Drop the sync triggers first so SQLite doesn't complain about references
  db.exec('DROP TRIGGER IF EXISTS memories_ai;');
  db.exec('DROP TRIGGER IF EXISTS memories_ad;');
  db.exec('DROP TRIGGER IF EXISTS memories_au;');

  // Drop the old FTS table (this also drops its shadow tables)
  db.exec('DROP TABLE IF EXISTS memories_fts;');

  // Recreate with trigram tokenizer
  db.exec(`
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      content, summary, tags,
      content='memories', content_rowid='rowid',
      tokenize='trigram'
    );
  `);

  // Recreate the sync triggers
  db.exec(`
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END;
  `);
  db.exec(`
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
    END;
  `);
  db.exec(`
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      INSERT INTO memories_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END;
  `);

  // Rebuild the FTS index from the existing memories table
  db.exec(`INSERT INTO memories_fts(memories_fts) VALUES ('rebuild');`);
}

export function initDatabase(dbPath: string): DatabaseSync {
  // allowExtension is required for sqlite-vec to load its native module.
  const db = new DatabaseSync(dbPath, { allowExtension: true });

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
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

  // Migrate existing tables that predate newer columns
  try { migrateMemoriesTable(db); } catch { /* ignore migration errors */ }

  // Migrate FTS5 table to trigram tokenizer if it was created with the old default
  try { migrateFtsTokenizer(db); } catch { /* ignore migration errors */ }

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

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside a SQLite transaction.
 * Commits on success, rolls back and re-throws on any error.
 */
export function withTransaction<T>(fn: () => T): T {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
