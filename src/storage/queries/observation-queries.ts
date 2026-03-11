/**
 * storage/queries/observation-queries.ts — Observation log operations
 */

import { getDatabase } from '../database.js';
import type { ObservationEntry } from '../../engine/types.js';
import { RawObservationRow, deserializeObservation } from './shared.js';

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
