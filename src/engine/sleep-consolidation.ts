/**
 * sleep-consolidation.ts — Post-session consolidation pipeline.
 *
 * Runs synchronously in the process exit handler after endSession().
 * Each phase is wrapped in try/catch so a failure in one phase never
 * prevents the others from running.
 *
 * Phases:
 *   1. Count ledger activity (quick stats, skip heavy async work in v1.1)
 *   2. Orbit recalculation
 *   3. Quick content-hash dedup (sync, no model inference)
 *   4. Session summary generation from stats
 *   5. Sun state update — append session summary to project_context
 */

import type { StellarConfig } from './types.js';
import type { Session } from './ledger.js';
import { getSessionLedger } from './ledger.js';
import { recalculateOrbits } from './orbit.js';
import { getConfig } from '../utils/config.js';
import { getDatabase } from '../storage/database.js';
import { getSunState, upsertSunState } from '../storage/queries.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sleep-consolidation');

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface SleepConsolidationResult {
  phasesCompleted: number;
  orbitChanges:    number;
  dupesFound:      number;
  summary:         string;
  errors:          string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the 5-phase post-session consolidation pipeline.
 * Fully synchronous — safe to call from a process exit handler.
 */
export function runSleepConsolidation(
  session: Session,
  project: string,
): SleepConsolidationResult {
  const result: SleepConsolidationResult = {
    phasesCompleted: 0,
    orbitChanges:    0,
    dupesFound:      0,
    summary:         '',
    errors:          [],
  };

  // ── Phase 1: Activity count ──────────────────────────────────────────────
  // Count ledger entries to understand session volume.
  // In v1.1 we skip the heavier async auto-promotion logic.
  let ledgerCount = 0;
  let topActions: string[] = [];
  try {
    const entries = getSessionLedger(session.id);
    ledgerCount = entries.length;

    // Extract the top 3 distinct tool names used this session
    const toolFreq = new Map<string, number>();
    for (const e of entries) {
      toolFreq.set(e.tool_name, (toolFreq.get(e.tool_name) ?? 0) + 1);
    }
    topActions = [...toolFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    result.phasesCompleted++;
    log.debug('Phase 1 complete', { ledgerCount, topActions });
  } catch (err) {
    result.errors.push(`phase1: ${String(err)}`);
    log.warn('Phase 1 failed', { error: String(err) });
  }

  // ── Phase 2: Orbit recalculation ────────────────────────────────────────
  let config: StellarConfig;
  try {
    config = getConfig();
    const changes = recalculateOrbits(project, config);
    result.orbitChanges = changes.length;
    result.phasesCompleted++;
    log.debug('Phase 2 complete', { orbitChanges: changes.length });
  } catch (err) {
    result.errors.push(`phase2: ${String(err)}`);
    log.warn('Phase 2 failed', { error: String(err) });
    config = getConfig(); // Attempt to recover config for later phases
  }

  // ── Phase 3: Quick content-hash dedup ───────────────────────────────────
  // Find memories created this session whose content_hash duplicates an older
  // memory.  Push the newer duplicate to the Oort cloud (sync, no embeddings).
  try {
    const db = getDatabase();

    // Convert session start time to epoch seconds for reliable comparison
    // regardless of whether DB stores 'YYYY-MM-DD HH:MM:SS' or ISO-8601.
    const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(session.started_at)
      ? session.started_at
      : session.started_at + 'Z';
    const startedAtEpoch = Math.floor(new Date(normalized).getTime() / 1000);

    const dupRows = db.prepare(`
      SELECT m1.id AS newer_id, m2.id AS older_id
      FROM memories m1
      JOIN memories m2
        ON  m1.content_hash = m2.content_hash
        AND m1.project      = m2.project
        AND m1.id           <> m2.id
        AND strftime('%s', m1.created_at) > strftime('%s', m2.created_at)
        AND m2.deleted_at   IS NULL
      WHERE m1.project    = ?
        AND CAST(strftime('%s', m1.created_at) AS INTEGER) > ?
        AND m1.deleted_at IS NULL
        AND m1.content_hash IS NOT NULL
    `).all(project, startedAtEpoch) as Array<{ newer_id: string; older_id: string }>;

    for (const { newer_id } of dupRows) {
      db.prepare(`
        UPDATE memories SET distance = 95.0, importance = 0.02 WHERE id = ?
      `).run(newer_id);
    }

    result.dupesFound = dupRows.length;
    result.phasesCompleted++;
    log.debug('Phase 3 complete', { dupesFound: dupRows.length });
  } catch (err) {
    result.errors.push(`phase3: ${String(err)}`);
    log.warn('Phase 3 failed', { error: String(err) });
  }

  // ── Phase 4: Session summary generation ─────────────────────────────────
  let sessionSummary = '';
  try {
    const durationMin = session.duration_seconds != null
      ? Math.round(session.duration_seconds / 60)
      : null;

    const parts: string[] = [];
    if (durationMin !== null) parts.push(`${durationMin}min`);
    if (session.memories_created  > 0) parts.push(`created=${session.memories_created}`);
    if (session.memories_recalled > 0) parts.push(`recalled=${session.memories_recalled}`);
    if (session.decisions_made    > 0) parts.push(`decisions=${session.decisions_made}`);
    if (topActions.length > 0)         parts.push(`tools: ${topActions.join(',')}`);

    const dateStr = new Date(
      /[Zz]$|[+-]\d{2}:\d{2}$/.test(session.started_at)
        ? session.started_at
        : session.started_at + 'Z'
    ).toISOString().slice(0, 16).replace('T', ' ');

    sessionSummary = parts.length > 0
      ? `[${dateStr}] ${parts.join(' | ')}`
      : `[${dateStr}] session (${ledgerCount} actions)`;

    result.summary = sessionSummary;
    result.phasesCompleted++;
    log.debug('Phase 4 complete', { summary: sessionSummary });
  } catch (err) {
    result.errors.push(`phase4: ${String(err)}`);
    log.warn('Phase 4 failed', { error: String(err) });
  }

  // ── Phase 5: Sun state update ────────────────────────────────────────────
  // Append the session summary to project_context (keep last 5 entries).
  if (sessionSummary) {
    try {
      const existing = getSunState(project);
      if (existing) {
        const prevContext = existing.project_context ?? '';
        // Keep last 4 existing entries plus the new one (5 total max)
        const lines = prevContext.split('\n').filter(l => l.trim().length > 0);
        const kept = lines.slice(-4);
        kept.push(sessionSummary);
        const newContext = kept.join('\n');

        const now = new Date().toISOString();
        upsertSunState({
          ...existing,
          project_context: newContext,
          updated_at:      now,
        });
      }
      result.phasesCompleted++;
      log.debug('Phase 5 complete');
    } catch (err) {
      result.errors.push(`phase5: ${String(err)}`);
      log.warn('Phase 5 failed', { error: String(err) });
    }
  } else {
    // Skip phase 5 if no summary was generated but still count it done
    result.phasesCompleted++;
  }

  log.info('Sleep consolidation complete', {
    phasesCompleted: result.phasesCompleted,
    orbitChanges:    result.orbitChanges,
    dupesFound:      result.dupesFound,
    errorCount:      result.errors.length,
  });

  return result;
}
