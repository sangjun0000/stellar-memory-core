/**
 * migration.ts — Schema versioning and migration runner
 *
 * Manages sequential, forward-only migrations for the stellar.db schema.
 * Each migration has a version number, a human-readable name, and an `up` function.
 *
 * On startup:
 *   1. Ensure schema_version table exists
 *   2. Read current version (0 if fresh DB)
 *   3. Run all migrations with version > current, in order
 *   4. Backup the DB file before the first migration that modifies data
 */

import { type DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';

const log = createLogger('migration');

// ---------------------------------------------------------------------------
// Schema version table DDL
// ---------------------------------------------------------------------------

const SCHEMA_VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ---------------------------------------------------------------------------
// Migration definition
// ---------------------------------------------------------------------------

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

const migrations: Migration[] = [];

/** Register a migration. Versions must be strictly ascending. */
export function registerMigration(migration: Migration): void {
  const last = migrations[migrations.length - 1];
  if (last && migration.version <= last.version) {
    throw new Error(
      `Migration version ${migration.version} must be > ${last.version}`,
    );
  }
  migrations.push(migration);
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/** Read the current schema version. Returns 0 for a fresh DB. */
export function getCurrentSchemaVersion(db: DatabaseSync): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as v FROM schema_version')
      .get() as { v: number | null } | undefined;
    return row?.v ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Backup the database file before running migrations.
 * Creates: <dbPath>.v<currentVersion>.bak
 */
export function backupDatabase(
  dbPath: string,
  currentVersion: number,
): string | null {
  if (!dbPath || dbPath === ':memory:' || dbPath.startsWith(':')) {
    return null;
  }
  if (!existsSync(dbPath)) {
    return null;
  }

  const backupPath = `${dbPath}.v${currentVersion}.bak`;

  if (existsSync(backupPath)) {
    log.debug('Backup already exists, skipping', { backupPath });
    return backupPath;
  }

  copyFileSync(dbPath, backupPath);
  log.info('Database backed up before migration', {
    from: dbPath,
    to: backupPath,
    currentVersion,
  });
  return backupPath;
}

/**
 * Run all pending migrations.
 *
 * Returns the number of migrations applied.
 * Each migration runs in its own transaction.
 */
export function runMigrations(db: DatabaseSync, dbPath: string): number {
  // Ensure schema_version table exists
  db.exec(SCHEMA_VERSION_DDL);

  const currentVersion = getCurrentSchemaVersion(db);
  const pending = migrations.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    return 0;
  }

  // Backup before first migration
  backupDatabase(dbPath, currentVersion);

  let applied = 0;

  for (const migration of pending) {
    log.info('Applying migration', {
      version: migration.version,
      name: migration.name,
    });

    db.exec('BEGIN');
    try {
      migration.up(db);

      db.prepare(
        'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());

      db.exec('COMMIT');
      applied++;

      log.info('Migration applied successfully', {
        version: migration.version,
        name: migration.name,
      });
    } catch (err) {
      db.exec('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        `Migration failed, rolled back: v${migration.version} ${migration.name} — ${msg}`,
      );
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${msg}`,
      );
    }
  }

  return applied;
}
