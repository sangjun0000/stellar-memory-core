import { randomUUID } from 'node:crypto';
import { getDatabase } from './database.js';
import type { Memory, MemoryType, OrbitZone, OrbitChange, SunState } from '../engine/types.js';
import { ORBIT_ZONES } from '../engine/types.js';
import type { DataSource } from '../scanner/types.js';

// ---------------------------------------------------------------------------
// Raw DB row shapes (everything comes back as primitives from node:sqlite)
// ---------------------------------------------------------------------------

interface RawMemoryRow {
  id: string;
  project: string;
  content: string;
  summary: string;
  type: string;
  tags: string;
  distance: number;
  importance: number;
  velocity: number;
  impact: number;
  access_count: number;
  last_accessed_at: string | null;
  metadata: string;
  source: string | null;
  source_path: string | null;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RawDataSourceRow {
  id: string;
  path: string;
  type: string;
  status: string;
  last_scanned_at: string | null;
  file_count: number;
  total_size: number;
  config: string;
  created_at: string;
  updated_at: string;
}

interface RawSunStateRow {
  project: string;
  content: string;
  current_work: string;
  recent_decisions: string;
  next_steps: string;
  active_errors: string;
  project_context: string;
  token_count: number;
  last_commit_at: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Deserializers — parse JSON fields coming out of SQLite
// ---------------------------------------------------------------------------

// Cast helpers — node:sqlite returns Record<string, SQLOutputValue> from .get()/.all().
// We cast through unknown because we know the schema guarantees the shape.
function asRawMemory(row: unknown): RawMemoryRow {
  return row as RawMemoryRow;
}

function asRawSunState(row: unknown): RawSunStateRow {
  return row as RawSunStateRow;
}

function deserializeMemory(row: RawMemoryRow): Memory {
  return {
    ...row,
    type: row.type as MemoryType,
    tags: parseJsonArray(row.tags),
    metadata: parseJsonObject(row.metadata),
    source: row.source ?? 'manual',
    source_path: row.source_path ?? null,
    source_hash: row.source_hash ?? null,
  };
}

function asRawDataSource(row: unknown): RawDataSourceRow {
  return row as RawDataSourceRow;
}

function deserializeDataSource(row: RawDataSourceRow): DataSource {
  return {
    ...row,
    type: row.type as DataSource['type'],
    status: row.status as DataSource['status'],
    config: parseJsonObject(row.config) as unknown as DataSource['config'],
  };
}

function deserializeSunState(row: RawSunStateRow): SunState {
  return {
    ...row,
    recent_decisions: parseJsonArray(row.recent_decisions),
    next_steps: parseJsonArray(row.next_steps),
    active_errors: parseJsonArray(row.active_errors),
  };
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Memory CRUD
// ---------------------------------------------------------------------------

export function insertMemory(memory: Partial<Memory>): Memory {
  const db = getDatabase();
  const now = new Date().toISOString();

  const id = memory.id ?? randomUUID();
  const project = memory.project ?? 'default';
  const content = memory.content ?? '';
  const summary = memory.summary ?? '';
  const type = memory.type ?? 'observation';
  const tags = JSON.stringify(memory.tags ?? []);
  const distance = memory.distance ?? 5.0;
  const importance = memory.importance ?? 0.5;
  const velocity = memory.velocity ?? 0.0;
  const impact = memory.impact ?? 0.5;
  const access_count = memory.access_count ?? 0;
  const last_accessed_at = memory.last_accessed_at ?? null;
  const metadata = JSON.stringify(memory.metadata ?? {});
  const source = memory.source ?? 'manual';
  const source_path = memory.source_path ?? null;
  const source_hash = memory.source_hash ?? null;
  const created_at = memory.created_at ?? now;
  const updated_at = memory.updated_at ?? now;
  const deleted_at = memory.deleted_at ?? null;

  db.prepare(`
    INSERT INTO memories (
      id, project, content, summary, type, tags,
      distance, importance, velocity, impact,
      access_count, last_accessed_at, metadata,
      source, source_path, source_hash,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, project, content, summary, type, tags,
    distance, importance, velocity, impact,
    access_count, last_accessed_at, metadata,
    source, source_path, source_hash,
    created_at, updated_at, deleted_at
  );

  // Return the fully resolved Memory object (no second DB hit needed)
  return {
    id, project, content, summary,
    type: type as MemoryType,
    tags: memory.tags ?? [],
    distance, importance, velocity, impact,
    access_count, last_accessed_at, metadata: memory.metadata ?? {},
    source, source_path, source_hash,
    created_at, updated_at, deleted_at,
  };
}

export function getMemoryById(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM memories WHERE id = ?
  `).get(id);

  return row ? deserializeMemory(asRawMemory(row)) : null;
}

export function getMemoryByIds(ids: string[]): Memory[] {
  if (ids.length === 0) return [];
  const db = getDatabase();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE id IN (${placeholders})
      AND deleted_at IS NULL
  `).all(...ids) as unknown[];
  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

export function getMemoriesByProject(
  project: string,
  includeDeleted = false
): Memory[] {
  const db = getDatabase();
  const sql = includeDeleted
    ? `SELECT * FROM memories WHERE project = ? ORDER BY distance ASC`
    : `SELECT * FROM memories WHERE project = ? AND deleted_at IS NULL ORDER BY distance ASC`;

  const rows = db.prepare(sql).all(project) as unknown[];
  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

export function getMemoriesInZone(project: string, zone: OrbitZone): Memory[] {
  const db = getDatabase();
  const { min, max } = ORBIT_ZONES[zone];

  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND distance >= ?
      AND distance < ?
    ORDER BY distance ASC
  `).all(project, min, max) as unknown[];

  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

export function updateMemoryOrbit(
  id: string,
  distance: number,
  importance: number,
  velocity: number
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE memories
    SET distance = ?, importance = ?, velocity = ?, updated_at = ?
    WHERE id = ?
  `).run(distance, importance, velocity, now, id);
}

export function updateMemoryAccess(id: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE memories
    SET access_count = access_count + 1,
        last_accessed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

export function softDeleteMemory(id: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE memories
    SET deleted_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

// ---------------------------------------------------------------------------
// Full-text search (FTS5)
// ---------------------------------------------------------------------------

export function searchMemories(
  project: string,
  query: string,
  limit = 20
): Memory[] {
  const db = getDatabase();

  // FTS5 MATCH uses its own query syntax; we join on rowid to get the full row
  const rows = db.prepare(`
    SELECT m.*
    FROM memories m
    JOIN memories_fts fts ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
      AND m.project = ?
      AND m.deleted_at IS NULL
    ORDER BY rank
    LIMIT ?
  `).all(query, project, limit) as unknown[];

  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

// ---------------------------------------------------------------------------
// Nearest memories (by orbital distance — closest to the "sun" first)
// ---------------------------------------------------------------------------

export function getNearestMemories(project: string, limit: number): Memory[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE project = ? AND deleted_at IS NULL
    ORDER BY distance ASC
    LIMIT ?
  `).all(project, limit) as unknown[];

  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

// ---------------------------------------------------------------------------
// Sun state
// ---------------------------------------------------------------------------

export function getSunState(project: string): SunState | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM sun_state WHERE project = ?
  `).get(project);

  return row ? deserializeSunState(asRawSunState(row)) : null;
}

export function upsertSunState(
  state: Partial<SunState> & { project: string }
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Fetch existing row so we can merge rather than blindly overwrite fields
  const existing = getSunState(state.project);

  const content = state.content ?? existing?.content ?? '';
  const current_work = state.current_work ?? existing?.current_work ?? '';
  const recent_decisions = JSON.stringify(
    state.recent_decisions ?? existing?.recent_decisions ?? []
  );
  const next_steps = JSON.stringify(
    state.next_steps ?? existing?.next_steps ?? []
  );
  const active_errors = JSON.stringify(
    state.active_errors ?? existing?.active_errors ?? []
  );
  const project_context = state.project_context ?? existing?.project_context ?? '';
  const token_count = state.token_count ?? existing?.token_count ?? 0;
  const last_commit_at = state.last_commit_at ?? existing?.last_commit_at ?? null;

  db.prepare(`
    INSERT INTO sun_state (
      project, content, current_work,
      recent_decisions, next_steps, active_errors,
      project_context, token_count, last_commit_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project) DO UPDATE SET
      content = excluded.content,
      current_work = excluded.current_work,
      recent_decisions = excluded.recent_decisions,
      next_steps = excluded.next_steps,
      active_errors = excluded.active_errors,
      project_context = excluded.project_context,
      token_count = excluded.token_count,
      last_commit_at = excluded.last_commit_at,
      updated_at = excluded.updated_at
  `).run(
    state.project, content, current_work,
    recent_decisions, next_steps, active_errors,
    project_context, token_count, last_commit_at, now
  );
}

// ---------------------------------------------------------------------------
// Orbit log
// ---------------------------------------------------------------------------

export function insertOrbitLog(change: OrbitChange): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO orbit_log (
      memory_id, project,
      old_distance, new_distance,
      old_importance, new_importance,
      trigger, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    change.memory_id,
    change.project,
    change.old_distance,
    change.new_distance,
    change.old_importance,
    change.new_importance,
    change.trigger,
    now
  );
}

// ---------------------------------------------------------------------------
// Source-path deduplication
// ---------------------------------------------------------------------------

/**
 * Check whether a memory already exists for the given source_path + source_hash.
 * Returns true if an identical (path, hash) pair is already stored and not deleted.
 */
export function memoryExistsForSource(sourcePath: string, sourceHash: string): boolean {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id FROM memories
    WHERE source_path = ? AND source_hash = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(sourcePath, sourceHash);
  return row !== undefined;
}

/**
 * Find a memory by source_path (regardless of hash). Used to update stale entries.
 */
export function getMemoryBySourcePath(sourcePath: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM memories
    WHERE source_path = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(sourcePath);
  return row ? deserializeMemory(asRawMemory(row)) : null;
}

// ---------------------------------------------------------------------------
// Data sources CRUD
// ---------------------------------------------------------------------------

export function insertDataSource(ds: Omit<DataSource, 'created_at' | 'updated_at'>): DataSource {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO data_sources (id, path, type, status, last_scanned_at, file_count, total_size, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ds.id, ds.path, ds.type, ds.status,
    ds.last_scanned_at ?? null,
    ds.file_count ?? 0,
    ds.total_size ?? 0,
    JSON.stringify(ds.config ?? {}),
    now, now
  );

  return { ...ds, config: ds.config ?? {}, created_at: now, updated_at: now };
}

export function updateDataSource(id: string, patch: Partial<Pick<DataSource, 'status' | 'last_scanned_at' | 'file_count' | 'total_size' | 'config'>>): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (patch.status !== undefined)          { sets.push('status = ?');           values.push(patch.status); }
  if (patch.last_scanned_at !== undefined) { sets.push('last_scanned_at = ?');  values.push(patch.last_scanned_at); }
  if (patch.file_count !== undefined)      { sets.push('file_count = ?');        values.push(patch.file_count); }
  if (patch.total_size !== undefined)      { sets.push('total_size = ?');        values.push(patch.total_size); }
  if (patch.config !== undefined)          { sets.push('config = ?');            values.push(JSON.stringify(patch.config)); }

  values.push(id);
  db.prepare(`UPDATE data_sources SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getAllDataSources(): DataSource[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM data_sources ORDER BY created_at DESC`).all() as unknown[];
  return rows.map((r) => deserializeDataSource(asRawDataSource(r)));
}

export function getDataSourceByPath(path: string): DataSource | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM data_sources WHERE path = ? LIMIT 1`).get(path);
  return row ? deserializeDataSource(asRawDataSource(row)) : null;
}
