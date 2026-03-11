/**
 * storage/queries/temporal-queries.ts — Time-based memory operations
 */

import { getDatabase } from '../database.js';
import type { Memory } from '../../engine/types.js';
import { asRawMemory, deserializeMemory } from './shared.js';

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

/**
 * Set temporal validity bounds on a memory.
 * Moved from temporal.ts — raw SQL belongs in the storage layer.
 */
export function setTemporalBoundsQuery(
  memoryId: string,
  validFrom?: string,
  validUntil?: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [now];

  if (validFrom !== undefined) {
    sets.push('valid_from = ?');
    values.push(validFrom);
  }
  if (validUntil !== undefined) {
    sets.push('valid_until = ?');
    values.push(validUntil);
  }

  values.push(memoryId);
  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Walk backward to find the oldest ancestor in the supersession chain.
 * A memory is a root if no other non-deleted memory has superseded_by = its id.
 */
export function findSupersessionChainRoot(memoryId: string): string {
  const db = getDatabase();
  let currentId = memoryId;

  for (let depth = 0; depth < 50; depth++) {
    const row = db.prepare(`
      SELECT id FROM memories
      WHERE superseded_by = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(currentId) as { id: string } | undefined;

    if (!row) break;
    currentId = row.id;
  }

  return currentId;
}

/**
 * Get active/superseded counts and recent supersession events for a project.
 * Returns raw data; formatting is the engine's responsibility.
 */
export function getTemporalStats(project: string): {
  activeCount: number;
  supersededCount: number;
  recentSupersessions: Array<{ id: string; summary: string; superseded_by: string; updated_at: string }>;
} {
  const db = getDatabase();
  const now = new Date().toISOString();

  const activeRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_until IS NULL OR valid_until > ?)
  `).get(project, now, now) as { count: number };

  const supersededRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND deleted_at IS NULL AND superseded_by IS NOT NULL
  `).get(project) as { count: number };

  const recentRows = db.prepare(`
    SELECT id, summary, superseded_by, updated_at FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND superseded_by IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 5
  `).all(project) as Array<{
    id: string;
    summary: string;
    superseded_by: string;
    updated_at: string;
  }>;

  return {
    activeCount: activeRow.count,
    supersededCount: supersededRow.count,
    recentSupersessions: recentRows,
  };
}
