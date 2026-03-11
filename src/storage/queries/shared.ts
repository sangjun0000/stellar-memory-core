/**
 * storage/queries/shared.ts — Raw DB row shapes, cast helpers, and deserializers
 *
 * These are internal to the queries layer. Nothing outside storage/ should
 * import from this file directly.
 */

import type {
  Memory,
  MemoryType,
  SunState,
  ConstellationEdge,
  RelationType,
  MemoryConflict,
  ObservationEntry,
} from '../../engine/types.js';
import type { DataSource } from '../../scanner/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('queries');

// ---------------------------------------------------------------------------
// Raw DB row shapes (everything comes back as primitives from node:sqlite)
// ---------------------------------------------------------------------------

export interface RawMemoryRow {
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

export interface RawConstellationEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  project: string;
  metadata: string;
  created_at: string;
}

export interface RawConflictRow {
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

export interface RawObservationRow {
  id: string;
  content: string;
  extracted_memories: string;
  source: string;
  project: string;
  created_at: string;
}

export interface RawDataSourceRow {
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

export interface RawSunStateRow {
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
// Cast helpers — node:sqlite returns Record<string, SQLOutputValue> from .get()/.all().
// We cast through unknown because we know the schema guarantees the shape.
// ---------------------------------------------------------------------------

export function asRawMemory(row: unknown): RawMemoryRow {
  return row as RawMemoryRow;
}

export function asRawSunState(row: unknown): RawSunStateRow {
  return row as RawSunStateRow;
}

export function asRawDataSource(row: unknown): RawDataSourceRow {
  return row as RawDataSourceRow;
}

// ---------------------------------------------------------------------------
// Deserializers — parse JSON fields coming out of SQLite
// ---------------------------------------------------------------------------

export function deserializeMemory(row: RawMemoryRow): Memory {
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

export function deserializeConstellationEdge(row: RawConstellationEdgeRow): ConstellationEdge {
  return {
    ...row,
    relation: row.relation as RelationType,
    metadata: parseJsonObject(row.metadata),
  };
}

export function deserializeConflict(row: RawConflictRow): MemoryConflict {
  return {
    ...row,
    severity: row.severity as MemoryConflict['severity'],
    status: row.status as MemoryConflict['status'],
    resolution: row.resolution ?? undefined,
    resolved_at: row.resolved_at ?? undefined,
  };
}

export function deserializeObservation(row: RawObservationRow): ObservationEntry {
  return {
    ...row,
    extracted_memories: parseJsonArray(row.extracted_memories),
    source: row.source as ObservationEntry['source'],
  };
}

export function deserializeDataSource(row: RawDataSourceRow): DataSource {
  return {
    ...row,
    type: row.type as DataSource['type'],
    status: row.status as DataSource['status'],
    config: parseJsonObject(row.config) as unknown as DataSource['config'],
  };
}

export function deserializeSunState(row: RawSunStateRow): SunState {
  return {
    ...row,
    recent_decisions: parseJsonArray(row.recent_decisions),
    next_steps: parseJsonArray(row.next_steps),
    active_errors: parseJsonArray(row.active_errors),
  };
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function parseJsonArray(value: string | null | undefined): string[] {
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn('JSON array parse failed', { raw: String(value).slice(0, 100) });
    return [];
  }
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
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

/**
 * Escape a user-supplied string for use in an FTS5 MATCH clause.
 */
export function escapeFtsQuery(query: string): string {
  const words = query.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '""';
  return words.map(w => '"' + w.replace(/"/g, '""') + '"').join(' ');
}
