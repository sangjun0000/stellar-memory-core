import { registerMigration } from '../migration.js';

registerMigration({
  version: 2,
  name: 'add-session-tables',
  up: (db) => {
    // Sessions table: tracks each MCP server process lifecycle
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        duration_seconds INTEGER,
        summary TEXT,
        memories_created INTEGER DEFAULT 0,
        memories_recalled INTEGER DEFAULT 0,
        decisions_made INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sessions_project_started
        ON sessions(project, started_at DESC);
    `);

    // Session ledger: chronological log of tool invocations in a session
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        tool_name TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        memory_id TEXT,
        metadata TEXT DEFAULT '{}',
        project TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_session ON session_ledger(session_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_project_time
        ON session_ledger(project, timestamp DESC);
    `);
  },
});
