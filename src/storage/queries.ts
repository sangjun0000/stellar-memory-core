import { randomUUID } from 'node:crypto';
import { getDatabase } from './database.js';
import type {
  Memory,
  MemoryType,
  OrbitZone,
  OrbitChange,
  SunState,
  ConstellationEdge,
  RelationType,
  MemoryConflict,
  MemoryAnalytics,
  ObservationEntry,
} from '../engine/types.js';
import { ORBIT_ZONES } from '../engine/types.js';
import type { DataSource } from '../scanner/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('queries');

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
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  superseded_by: string | null;
  consolidated_into: string | null;
  quality_score: number | null;
  is_universal: number | null;
}

interface RawConstellationEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  project: string;
  metadata: string;
  created_at: string;
}

interface RawConflictRow {
  id: string;
  memory_id: string;
  conflicting_memory_id: string;
  severity: string;
  description: string;
  status: string;
  resolution: string | null;
  project: string;
  created_at: string;
  resolved_at: string | null;
}

interface RawObservationRow {
  id: string;
  content: string;
  extracted_memories: string;
  source: string;
  project: string;
  created_at: string;
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
    content_hash: row.content_hash ?? null,
    valid_from: row.valid_from ?? undefined,
    valid_until: row.valid_until ?? undefined,
    superseded_by: row.superseded_by ?? undefined,
    consolidated_into: row.consolidated_into ?? undefined,
    quality_score: row.quality_score ?? undefined,
    is_universal: row.is_universal ? Boolean(row.is_universal) : undefined,
  };
}

function deserializeConstellationEdge(row: RawConstellationEdgeRow): ConstellationEdge {
  return {
    ...row,
    relation: row.relation as RelationType,
    metadata: parseJsonObject(row.metadata),
  };
}

function deserializeConflict(row: RawConflictRow): MemoryConflict {
  return {
    ...row,
    severity: row.severity as MemoryConflict['severity'],
    status: row.status as MemoryConflict['status'],
    resolution: row.resolution ?? undefined,
    resolved_at: row.resolved_at ?? undefined,
  };
}

function deserializeObservation(row: RawObservationRow): ObservationEntry {
  return {
    ...row,
    extracted_memories: parseJsonArray(row.extracted_memories),
    source: row.source as ObservationEntry['source'],
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
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn('JSON array parse failed', { raw: String(value).slice(0, 100) });
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (typeof value !== 'string' || value === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    log.warn('JSON object parse failed', { raw: String(value).slice(0, 100) });
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
  const content_hash = memory.content_hash ?? null;
  const created_at = memory.created_at ?? now;
  const updated_at = memory.updated_at ?? now;
  const deleted_at = memory.deleted_at ?? null;

  db.prepare(`
    INSERT INTO memories (
      id, project, content, summary, type, tags,
      distance, importance, velocity, impact,
      access_count, last_accessed_at, metadata,
      source, source_path, source_hash, content_hash,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, project, content, summary, type, tags,
    distance, importance, velocity, impact,
    access_count, last_accessed_at, metadata,
    source, source_path, source_hash, content_hash,
    created_at, updated_at, deleted_at
  );

  // Return the fully resolved Memory object (no second DB hit needed)
  return {
    id, project, content, summary,
    type: type as MemoryType,
    tags: memory.tags ?? [],
    distance, importance, velocity, impact,
    access_count, last_accessed_at, metadata: memory.metadata ?? {},
    source, source_path, source_hash, content_hash,
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

/**
 * Get memories created within the last `hoursAgo` hours for a project.
 * Used by auto-commit on shutdown to summarize the current session.
 */
export function getRecentMemories(project: string, hoursAgo: number = 3): Memory[] {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND created_at > ?
    ORDER BY created_at DESC
  `).all(project, cutoff) as unknown[];

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

/**
 * Escape a user-supplied string for use in an FTS5 MATCH clause.
 * Wraps the entire query in double-quotes and escapes internal double-quotes
 * so it is treated as a literal phrase rather than FTS5 query syntax.
 */
function escapeFtsQuery(query: string): string {
  // Split into individual words, quote each one to escape FTS5 operators,
  // then join with spaces (implicit AND). This avoids phrase-matching issues
  // while still preventing FTS5 syntax errors from special characters.
  const words = query.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '""';
  return words.map(w => '"' + w.replace(/"/g, '""') + '"').join(' ');
}

export function searchMemories(
  project: string,
  query: string,
  limit = 20
): Memory[] {
  const db = getDatabase();
  const escapedQuery = escapeFtsQuery(query);

  // FTS5 MATCH uses its own query syntax; we join on rowid to get the full row
  const rows = db.prepare(`
    SELECT m.*
    FROM memories m
    JOIN memories_fts fts ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
      AND m.project = ?
      AND m.deleted_at IS NULL
      AND (m.valid_until IS NULL OR m.valid_until > datetime('now'))
    ORDER BY rank
    LIMIT ?
  `).all(escapedQuery, project, limit) as unknown[];

  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

// ---------------------------------------------------------------------------
// Distance-ranged FTS5 search (used by tiered recall pipeline)
// ---------------------------------------------------------------------------

export function searchMemoriesInRange(
  project: string,
  query: string,
  minDistance: number,
  maxDistance: number,
  limit: number,
): Memory[] {
  const db = getDatabase();
  const escapedQuery = escapeFtsQuery(query);

  const rows = db.prepare(`
    SELECT m.*
    FROM memories m
    JOIN memories_fts fts ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
      AND m.project = ?
      AND m.deleted_at IS NULL
      AND (m.valid_until IS NULL OR m.valid_until > datetime('now'))
      AND m.distance >= ?
      AND m.distance < ?
    ORDER BY rank
    LIMIT ?
  `).all(escapedQuery, project, minDistance, maxDistance, limit) as unknown[];

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

export function cleanupOrbitLog(retentionDays: number = 90): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM orbit_log WHERE created_at < ?').run(cutoff);
  return Number(result.changes);
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

/**
 * Find a non-deleted memory in the given project that has the same content hash.
 * Used by createMemory() for content-level deduplication.
 */
export function getMemoryByContentHash(project: string, contentHash: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM memories
    WHERE project = ? AND content_hash = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(project, contentHash);
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

// ---------------------------------------------------------------------------
// Constellation queries (Knowledge Graph)
// ---------------------------------------------------------------------------

export function createEdge(edge: ConstellationEdge): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO constellation_edges (id, source_id, target_id, relation, weight, project, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
      weight = excluded.weight,
      metadata = excluded.metadata
  `).run(
    edge.id,
    edge.source_id,
    edge.target_id,
    edge.relation,
    edge.weight,
    edge.project,
    JSON.stringify(edge.metadata ?? {}),
    edge.created_at,
  );
}

export function getEdges(memoryId: string, project: string): ConstellationEdge[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM constellation_edges
    WHERE (source_id = ? OR target_id = ?) AND project = ?
    ORDER BY weight DESC
  `).all(memoryId, memoryId, project) as unknown[];
  return rows.map((r) => deserializeConstellationEdge(r as RawConstellationEdgeRow));
}

export function getConstellation(
  memoryId: string,
  project: string,
  depth = 1
): { nodes: Memory[]; edges: ConstellationEdge[] } {
  const db = getDatabase();

  const visitedNodeIds = new Set<string>([memoryId]);
  const allEdges: ConstellationEdge[] = [];
  let frontier = [memoryId];

  for (let d = 0; d < depth; d++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => '?').join(', ');
    const edgeRows = db.prepare(`
      SELECT * FROM constellation_edges
      WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
        AND project = ?
    `).all(...frontier, ...frontier, project) as unknown[];

    for (const r of edgeRows) {
      const edge = deserializeConstellationEdge(r as RawConstellationEdgeRow);
      allEdges.push(edge);
      visitedNodeIds.add(edge.source_id);
      visitedNodeIds.add(edge.target_id);
    }

    frontier = [...visitedNodeIds].filter((id) => !frontier.includes(id) && id !== memoryId);
  }

  const nodes = getMemoryByIds([...visitedNodeIds]);
  return { nodes, edges: allEdges };
}

/**
 * Get all constellation neighbors for a batch of memory IDs.
 * Returns a map from memory ID → set of neighbor IDs.
 */
export function getEdgesForBatch(
  memoryIds: string[],
  project: string,
): Map<string, Set<string>> {
  if (memoryIds.length === 0) return new Map();
  const db = getDatabase();
  const placeholders = memoryIds.map(() => '?').join(', ');

  const rows = db.prepare(`
    SELECT source_id, target_id FROM constellation_edges
    WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      AND project = ?
  `).all(...memoryIds, ...memoryIds, project) as unknown[];

  const idSet = new Set(memoryIds);
  const result = new Map<string, Set<string>>();

  for (const r of rows) {
    const row = r as { source_id: string; target_id: string };
    // For each memory in our batch, record its neighbor
    if (idSet.has(row.source_id)) {
      const neighbors = result.get(row.source_id) ?? new Set();
      neighbors.add(row.target_id);
      result.set(row.source_id, neighbors);
    }
    if (idSet.has(row.target_id)) {
      const neighbors = result.get(row.target_id) ?? new Set();
      neighbors.add(row.source_id);
      result.set(row.target_id, neighbors);
    }
  }

  return result;
}

export function deleteEdge(id: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM constellation_edges WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Conflict queries
// ---------------------------------------------------------------------------

export function createConflict(conflict: MemoryConflict): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO memory_conflicts (
      id, memory_id, conflicting_memory_id, severity,
      description, status, resolution, project, created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conflict.id,
    conflict.memory_id,
    conflict.conflicting_memory_id,
    conflict.severity,
    conflict.description,
    conflict.status,
    conflict.resolution ?? null,
    conflict.project,
    conflict.created_at,
    conflict.resolved_at ?? null,
  );
}

export function getConflicts(project: string, status?: string): MemoryConflict[] {
  const db = getDatabase();
  const rows = status
    ? db.prepare(`
        SELECT * FROM memory_conflicts
        WHERE project = ? AND status = ?
        ORDER BY created_at DESC
      `).all(project, status) as unknown[]
    : db.prepare(`
        SELECT * FROM memory_conflicts
        WHERE project = ?
        ORDER BY created_at DESC
      `).all(project) as unknown[];
  return rows.map((r) => deserializeConflict(r as RawConflictRow));
}

export function getConflictsForMemory(memoryId: string): MemoryConflict[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM memory_conflicts
    WHERE memory_id = ? OR conflicting_memory_id = ?
    ORDER BY created_at DESC
  `).all(memoryId, memoryId) as unknown[];
  return rows.map((r) => deserializeConflict(r as RawConflictRow));
}

export function resolveConflict(id: string, resolution: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memory_conflicts
    SET status = 'resolved', resolution = ?, resolved_at = ?
    WHERE id = ?
  `).run(resolution, now, id);
}

// ---------------------------------------------------------------------------
// Observation queries
// ---------------------------------------------------------------------------

export function createObservation(entry: ObservationEntry): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO observation_log (id, content, extracted_memories, source, project, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.content,
    JSON.stringify(entry.extracted_memories),
    entry.source,
    entry.project,
    entry.created_at,
  );
}

export function getObservations(project: string, limit = 20): ObservationEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM observation_log
    WHERE project = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(project, limit) as unknown[];
  return rows.map((r) => deserializeObservation(r as RawObservationRow));
}

// ---------------------------------------------------------------------------
// Temporal queries
// ---------------------------------------------------------------------------

export function getMemoriesAtTime(project: string, timestamp: string): Memory[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_until IS NULL OR valid_until > ?)
    ORDER BY distance ASC
  `).all(project, timestamp, timestamp) as unknown[];
  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

export function supersedMemory(memoryId: string, newMemoryId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memories
    SET superseded_by = ?, valid_until = ?, updated_at = ?
    WHERE id = ?
  `).run(newMemoryId, now, now, memoryId);
}

export function getSupersessionChain(memoryId: string): Memory[] {
  const db = getDatabase();
  const chain: Memory[] = [];
  let currentId: string | null = memoryId;

  while (currentId) {
    const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(currentId);
    if (!row) break;
    const mem = deserializeMemory(asRawMemory(row));
    chain.push(mem);
    currentId = mem.superseded_by ?? null;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Consolidation queries
// ---------------------------------------------------------------------------

export function consolidateMemories(sourceIds: string[], targetId: string): void {
  if (sourceIds.length === 0) return;
  const db = getDatabase();
  const now = new Date().toISOString();
  const placeholders = sourceIds.map(() => '?').join(', ');
  db.prepare(`
    UPDATE memories
    SET consolidated_into = ?, updated_at = ?
    WHERE id IN (${placeholders})
  `).run(targetId, now, ...sourceIds);
}

export function getConsolidationHistory(memoryId: string): Memory[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE consolidated_into = ?
    ORDER BY created_at ASC
  `).all(memoryId) as unknown[];
  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

// ---------------------------------------------------------------------------
// Multi-project queries
// ---------------------------------------------------------------------------

export function getUniversalMemories(limit = 50): Memory[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE is_universal = 1 AND deleted_at IS NULL
    ORDER BY importance DESC
    LIMIT ?
  `).all(limit) as unknown[];
  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

export function setUniversal(memoryId: string, isUniversal: boolean): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memories SET is_universal = ?, updated_at = ? WHERE id = ?
  `).run(isUniversal ? 1 : 0, now, memoryId);
}

export function listProjects(): Array<{ project: string; count: number }> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT project, COUNT(*) as count
    FROM memories
    WHERE deleted_at IS NULL
    GROUP BY project
    ORDER BY count DESC
  `).all() as unknown[];
  return rows.map((r) => {
    const row = r as { project: string; count: number };
    return { project: row.project, count: row.count };
  });
}

// ---------------------------------------------------------------------------
// Quality queries
// ---------------------------------------------------------------------------

export function updateMemoryContent(id: string, content: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memories SET content = ?, updated_at = ? WHERE id = ?
  `).run(content, now, id);
}

export function updateQualityScore(memoryId: string, score: number): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memories SET quality_score = ?, updated_at = ? WHERE id = ?
  `).run(score, now, memoryId);
}

export function getMemoriesByQuality(
  project: string,
  minScore = 0.0,
  maxScore = 1.0
): Memory[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND quality_score >= ?
      AND quality_score <= ?
    ORDER BY quality_score DESC
  `).all(project, minScore, maxScore) as unknown[];
  return rows.map((r) => deserializeMemory(asRawMemory(r)));
}

// ---------------------------------------------------------------------------
// Analytics queries
// ---------------------------------------------------------------------------

export function getTopTags(project: string, limit = 20): Array<{ tag: string; count: number }> {
  const db = getDatabase();
  // Tags are stored as JSON arrays — we use the memories table and parse in JS
  const rows = db.prepare(`
    SELECT tags FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).all(project) as unknown[];

  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    const row = r as { tags: string };
    const tags = parseJsonArray(row.tags);
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function getActivityTimeline(
  project: string,
  days = 30
): Array<{ date: string; created: number; accessed: number }> {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const createdRows = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM memories
    WHERE project = ? AND date(created_at) >= ?
    GROUP BY date(created_at)
  `).all(project, cutoff) as unknown[];

  const accessedRows = db.prepare(`
    SELECT date(last_accessed_at) as date, COUNT(*) as count
    FROM memories
    WHERE project = ?
      AND last_accessed_at IS NOT NULL
      AND date(last_accessed_at) >= ?
    GROUP BY date(last_accessed_at)
  `).all(project, cutoff) as unknown[];

  const timeline = new Map<string, { created: number; accessed: number }>();

  for (const r of createdRows) {
    const row = r as { date: string; count: number };
    const entry = timeline.get(row.date) ?? { created: 0, accessed: 0 };
    entry.created = row.count;
    timeline.set(row.date, entry);
  }

  for (const r of accessedRows) {
    const row = r as { date: string; count: number };
    const entry = timeline.get(row.date) ?? { created: 0, accessed: 0 };
    entry.accessed = row.count;
    timeline.set(row.date, entry);
  }

  return [...timeline.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getRecallSuccessRate(project: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN access_count > 0 THEN 1 ELSE 0 END) as accessed
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as unknown;

  const row = result as { total: number; accessed: number } | undefined;
  if (!row || row.total === 0) return 0;
  return row.accessed / row.total;
}

export function getAnalytics(project: string): MemoryAnalytics {
  const db = getDatabase();

  // Aggregate stats
  const statsRow = db.prepare(`
    SELECT
      COUNT(*) as total_memories,
      AVG(CASE WHEN quality_score IS NOT NULL THEN quality_score ELSE 0.5 END) as avg_quality,
      AVG(importance) as avg_importance,
      SUM(CASE WHEN consolidated_into IS NOT NULL THEN 1 ELSE 0 END) as consolidation_count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as unknown;

  const stats = (statsRow ?? {}) as {
    total_memories: number;
    avg_quality: number;
    avg_importance: number;
    consolidation_count: number;
  };

  // Zone distribution
  const zoneRows = db.prepare(`
    SELECT
      CASE
        WHEN distance < 1.0  THEN 'core'
        WHEN distance < 5.0  THEN 'near'
        WHEN distance < 15.0 THEN 'active'
        WHEN distance < 40.0 THEN 'archive'
        WHEN distance < 70.0 THEN 'fading'
        ELSE 'forgotten'
      END as zone,
      COUNT(*) as count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
    GROUP BY zone
  `).all(project) as unknown[];

  const zone_distribution: Record<string, number> = {};
  for (const r of zoneRows) {
    const row = r as { zone: string; count: number };
    zone_distribution[row.zone] = row.count;
  }

  // Type distribution
  const typeRows = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
    GROUP BY type
  `).all(project) as unknown[];

  const type_distribution: Record<string, number> = {};
  for (const r of typeRows) {
    const row = r as { type: string; count: number };
    type_distribution[row.type] = row.count;
  }

  // Conflict count
  const conflictRow = db.prepare(`
    SELECT COUNT(*) as count FROM memory_conflicts
    WHERE project = ? AND status = 'open'
  `).get(project) as unknown;
  const conflict_count = ((conflictRow as { count: number } | undefined)?.count) ?? 0;

  // Activity timeline (last 30 days)
  const timelineRows = getActivityTimeline(project, 30);
  const activity_timeline = timelineRows.map((row) => ({
    date: row.date,
    created: row.created,
    accessed: row.accessed,
    forgotten: 0, // soft-delete count per day — simplified to 0 here
  }));

  return {
    total_memories: stats.total_memories ?? 0,
    zone_distribution,
    type_distribution,
    avg_quality: stats.avg_quality ?? 0.5,
    avg_importance: stats.avg_importance ?? 0.5,
    recall_success_rate: getRecallSuccessRate(project),
    consolidation_count: stats.consolidation_count ?? 0,
    conflict_count,
    top_tags: getTopTags(project),
    activity_timeline,
  };
}
