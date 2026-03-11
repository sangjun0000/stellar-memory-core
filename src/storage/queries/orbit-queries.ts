/**
 * storage/queries/orbit-queries.ts — Orbit log operations
 */

import { getDatabase } from '../database.js';
import type { OrbitChange } from '../../engine/types.js';

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
