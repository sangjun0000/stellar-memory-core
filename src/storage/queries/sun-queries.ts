/**
 * storage/queries/sun-queries.ts — Sun state operations
 */

import { getDatabase } from '../database.js';
import type { SunState } from '../../engine/types.js';
import { asRawSunState, deserializeSunState } from './shared.js';

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
