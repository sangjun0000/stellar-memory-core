/**
 * storage/queries/conflict-queries.ts — Conflict management
 */

import { getDatabase } from '../database.js';
import type { MemoryConflict } from '../../engine/types.js';
import { RawConflictRow, deserializeConflict } from './shared.js';

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

/**
 * Get conflict row for a given conflict ID (used by conflict.ts resolveConflict action=supersede).
 */
export function getConflictById(id: string): { memory_id: string; conflicting_memory_id: string } | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT memory_id, conflicting_memory_id FROM memory_conflicts WHERE id = ?`
  ).get(id) as { memory_id: string; conflicting_memory_id: string } | undefined;
  return row ?? null;
}
