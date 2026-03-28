/**
 * storage/queries/memory-queries.ts — Memory CRUD and search operations
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database.js';
import type { Memory, MemoryType, OrbitZone } from '../../engine/types.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import { filterActiveMemories } from '../../engine/validity.js';
import {
  asRawMemory,
  deserializeMemory,
  escapeFtsQuery,
} from './shared.js';

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
  // Use nullish coalescing first, then guard against NaN — SQLite stores NaN as
  // NULL and the NOT NULL constraint on memories.distance will reject it.
  const distanceRaw = memory.distance ?? 5.0;
  const distance = isNaN(distanceRaw) || !isFinite(distanceRaw) ? 5.0 : distanceRaw;
  const importanceRaw = memory.importance ?? 0.5;
  const importance = isNaN(importanceRaw) || !isFinite(importanceRaw) ? 0.5 : importanceRaw;
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
  const valid_from = memory.valid_from ?? null;
  const valid_until = memory.valid_until ?? null;
  const superseded_by = memory.superseded_by ?? null;
  const consolidated_into = memory.consolidated_into ?? null;
  const quality_score = memory.quality_score ?? null;
  const is_universal = memory.is_universal ? 1 : 0;
  const intrinsic = memory.intrinsic ?? null;

  db.prepare(`
    INSERT INTO memories (
      id, project, content, summary, type, tags,
      distance, importance, velocity, impact,
      access_count, last_accessed_at, metadata,
      source, source_path, source_hash, content_hash,
      created_at, updated_at, deleted_at,
      valid_from, valid_until, superseded_by,
      consolidated_into, quality_score, is_universal,
      intrinsic
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, project, content, summary, type, tags,
    distance, importance, velocity, impact,
    access_count, last_accessed_at, metadata,
    source, source_path, source_hash, content_hash,
    created_at, updated_at, deleted_at,
    valid_from, valid_until, superseded_by,
    consolidated_into, quality_score, is_universal,
    intrinsic
  );

  return {
    id, project, content, summary,
    type: type as MemoryType,
    tags: memory.tags ?? [],
    distance, importance, velocity, impact,
    access_count, last_accessed_at, metadata: memory.metadata ?? {},
    source, source_path, source_hash, content_hash,
    created_at, updated_at, deleted_at,
    valid_from: valid_from ?? undefined,
    valid_until: valid_until ?? undefined,
    superseded_by: superseded_by ?? undefined,
    consolidated_into: consolidated_into ?? undefined,
    quality_score: quality_score ?? undefined,
    is_universal: Boolean(is_universal),
    intrinsic: intrinsic ?? null,
  };
}

export function getMemoryById(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id);
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
  return filterActiveMemories(rows.map((r) => deserializeMemory(asRawMemory(r))));
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
  return filterActiveMemories(rows.map((r) => deserializeMemory(asRawMemory(r))));
}

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

  return filterActiveMemories(rows.map((r) => deserializeMemory(asRawMemory(r))));
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

  return filterActiveMemories(rows.map((r) => deserializeMemory(asRawMemory(r))));
}

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

export function updateMemoryContent(id: string, content: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memories SET content = ?, updated_at = ? WHERE id = ?
  `).run(content, now, id);
}

export function updateMemoryFields(
  id: string,
  fields: {
    content?: string;
    summary?: string;
    type?: string;
    tags?: string[];
    impact?: number;
  },
): void {
  const db = getDatabase();
  const updates: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];

  if (fields.content !== undefined) { updates.push('content = ?'); values.push(fields.content); }
  if (fields.summary !== undefined) { updates.push('summary = ?'); values.push(fields.summary); }
  if (fields.type    !== undefined) { updates.push('type = ?');    values.push(fields.type); }
  if (fields.tags    !== undefined) { updates.push('tags = ?');    values.push(JSON.stringify(fields.tags)); }
  if (fields.impact  !== undefined) { updates.push('impact = ?'); values.push(fields.impact); }

  if (updates.length === 0) return;

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(
    `UPDATE memories SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`
  ).run(...values);
}

export function updateQualityScore(memoryId: string, score: number): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memories SET quality_score = ?, updated_at = ? WHERE id = ?
  `).run(score, now, memoryId);
}

// ---------------------------------------------------------------------------
// Source-path deduplication
// ---------------------------------------------------------------------------

export function memoryExistsForSource(sourcePath: string, sourceHash: string): boolean {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id FROM memories
    WHERE source_path = ? AND source_hash = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(sourcePath, sourceHash);
  return row !== undefined;
}

export function getMemoryBySourcePath(sourcePath: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM memories
    WHERE source_path = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(sourcePath);
  return row ? deserializeMemory(asRawMemory(row)) : null;
}

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
// Full-text search (FTS5)
// ---------------------------------------------------------------------------

export function searchMemories(
  project: string,
  query: string,
  limit = 20
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
      AND m.superseded_by IS NULL
      AND (m.valid_from IS NULL OR m.valid_from <= datetime('now'))
      AND (m.valid_until IS NULL OR m.valid_until > datetime('now'))
    ORDER BY rank
    LIMIT ?
  `).all(escapedQuery, project, limit) as unknown[];

  return filterActiveMemories(rows.map((r) => deserializeMemory(asRawMemory(r))));
}

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
      AND m.superseded_by IS NULL
      AND (m.valid_from IS NULL OR m.valid_from <= datetime('now'))
      AND (m.valid_until IS NULL OR m.valid_until > datetime('now'))
      AND m.distance >= ?
      AND m.distance < ?
    ORDER BY rank
    LIMIT ?
  `).all(escapedQuery, project, minDistance, maxDistance, limit) as unknown[];

  return filterActiveMemories(rows.map((r) => deserializeMemory(asRawMemory(r))));
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
// Stored embedding lookup (used by orbit.ts and consolidation.ts)
// ---------------------------------------------------------------------------

export function getStoredEmbeddingForMemory(memoryId: string): Float32Array | null {
  try {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT me.embedding
       FROM memory_embeddings me
       JOIN memory_embedding_map mm ON mm.vec_rowid = me.rowid
       WHERE mm.memory_id = ?`
    ).get(memoryId) as { embedding: Buffer } | undefined;

    if (!row?.embedding) return null;

    return new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );
  } catch {
    return null;
  }
}

/**
 * Get the embedding of the highest-importance memory in a project.
 * Used by orbit.ts to compute sun-context relevance via hybridRelevance.
 */
export function getTopProjectEmbedding(project: string): Float32Array | null {
  try {
    const db = getDatabase();
    const sunRow = db.prepare(
      `SELECT e.embedding
       FROM memory_embeddings e
       JOIN memory_embedding_map map ON map.vec_rowid = e.rowid
       JOIN memories m ON m.id = map.memory_id
       WHERE m.project = ? AND m.deleted_at IS NULL
       ORDER BY m.importance DESC LIMIT 1`
    ).get(project) as { embedding: Buffer } | undefined;

    if (!sunRow?.embedding) return null;

    return new Float32Array(
      sunRow.embedding.buffer,
      sunRow.embedding.byteOffset,
      sunRow.embedding.byteLength / 4,
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project listing
// ---------------------------------------------------------------------------

/**
 * Return the list of distinct project names that have at least one non-deleted memory.
 */
export function getAllProjects(): string[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT DISTINCT project FROM memories WHERE deleted_at IS NULL'
  ).all() as unknown[];
  return rows.map((r) => (r as { project: string }).project);
}

// ---------------------------------------------------------------------------
// Hard-delete (purge) and curation
// ---------------------------------------------------------------------------

/**
 * Permanently remove soft-deleted memories older than the given number of days.
 * Also cleans up related embeddings, constellation edges, and orbit log entries.
 */
export function purgeDeletedMemories(project: string, olderThanDays: number = 30): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const rawIds = db.prepare(`
    SELECT id FROM memories
    WHERE project = ? AND deleted_at IS NOT NULL AND deleted_at < ?
  `).all(project, cutoff) as unknown[];

  if (rawIds.length === 0) return 0;

  const ids = (rawIds as Array<{ id: string }>).map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');

  db.prepare(
    `DELETE FROM constellation_edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
  ).run(...ids, ...ids);

  db.prepare(
    `DELETE FROM orbit_log WHERE memory_id IN (${placeholders})`
  ).run(...ids);

  const mapRows = db.prepare(
    `SELECT vec_rowid FROM memory_embedding_map WHERE memory_id IN (${placeholders})`
  ).all(...ids) as unknown[];

  if (mapRows.length > 0) {
    const vecRowids = (mapRows as Array<{ vec_rowid: number }>).map((r) => r.vec_rowid);
    const vecPlaceholders = vecRowids.map(() => '?').join(', ');
    try {
      db.prepare(
        `DELETE FROM memory_embeddings WHERE rowid IN (${vecPlaceholders})`
      ).run(...vecRowids);
    } catch { /* sqlite-vec may be unavailable */ }
  }

  db.prepare(
    `DELETE FROM memory_embedding_map WHERE memory_id IN (${placeholders})`
  ).run(...ids);

  db.prepare(
    `DELETE FROM memories WHERE id IN (${placeholders})`
  ).run(...ids);

  return ids.length;
}

/**
 * Soft-delete noisy or superseded memories.
 * Returns count and breakdown by reason.
 */
export function curateMemories(
  project: string
): { deleted: number; reasons: Record<string, number> } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const reasons: Record<string, number> = {};

  const lowQuality = db.prepare(`
    UPDATE memories SET deleted_at = ?
    WHERE project = ? AND deleted_at IS NULL
      AND quality_score < 0.3 AND access_count = 0
      AND created_at < datetime('now', '-14 days')
  `).run(now, project);
  reasons['low_quality_unaccessed'] = Number(lowQuality.changes);

  const superseded = db.prepare(`
    UPDATE memories SET deleted_at = ?
    WHERE project = ? AND deleted_at IS NULL
      AND superseded_by IS NOT NULL
      AND updated_at < datetime('now', '-7 days')
  `).run(now, project);
  reasons['superseded'] = Number(superseded.changes);

  const consolidated = db.prepare(`
    UPDATE memories SET deleted_at = ?
    WHERE project = ? AND deleted_at IS NULL
      AND consolidated_into IS NOT NULL
      AND updated_at < datetime('now', '-7 days')
  `).run(now, project);
  reasons['consolidated_sources'] = Number(consolidated.changes);

  const total = Object.values(reasons).reduce((a, b) => a + b, 0);
  return { deleted: total, reasons };
}
