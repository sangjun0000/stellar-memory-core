/**
 * ledger.ts — Session lifecycle management and activity ledger.
 *
 * Tracks each MCP server process as a "session" and logs every
 * tool invocation so sleep-consolidation can summarise what happened.
 *
 * All DB operations are synchronous.  addLedgerEntry is non-fatal by
 * design — a failure to write to the ledger must never block an MCP
 * tool response.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../storage/database.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ledger');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  project: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  memories_created: number;
  memories_recalled: number;
  decisions_made: number;
  status: 'active' | 'completed' | 'abandoned';
}

export interface LedgerEntry {
  id: number;
  session_id: string;
  timestamp: string;
  tool_name: string;
  action: string;
  memory_id: string | null;
  metadata: string;
  project: string;
}

export interface SessionGap {
  lastSessionEnd: string;
  currentSessionStart: string;
  gapHours: number;
  gapCategory: 'short' | 'medium' | 'long' | 'extended';
}

// ---------------------------------------------------------------------------
// Module-level active session state
// ---------------------------------------------------------------------------

let _activeSessionId: string | null = null;
let _checkpointTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Start a new session for the given project.
 * Any sessions left in 'active' status are marked 'abandoned' first
 * (handles crashes / unexpected exits from previous runs).
 *
 * Returns the new session id.
 */
export function startSession(project: string): string {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Mark stale active sessions as abandoned
    db.prepare(`
      UPDATE sessions
      SET status = 'abandoned', ended_at = ?
      WHERE project = ? AND status = 'active'
    `).run(now, project);

    const id = randomUUID();
    db.prepare(`
      INSERT INTO sessions (id, project, started_at, status)
      VALUES (?, ?, ?, 'active')
    `).run(id, project, now);

    _activeSessionId = id;
    log.info('Session started', { sessionId: id, project });
    return id;
  } catch (err) {
    log.warn('Failed to start session', { error: String(err) });
    // Return a synthetic id so the rest of the system still works
    const fallback = randomUUID();
    _activeSessionId = fallback;
    return fallback;
  }
}

/**
 * End the current active session for the project.
 * Computes duration and final stats from ledger entries.
 * Returns the completed Session, or null on failure.
 */
export function endSession(project: string): Session | null {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    const sessionId = _activeSessionId;
    if (!sessionId) return null;

    // Pull current row to compute duration
    const row = db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId) as Session | undefined;

    if (!row) return null;

    const startMs = new Date(
      /[Zz]$|[+-]\d{2}:\d{2}$/.test(row.started_at)
        ? row.started_at
        : row.started_at + 'Z'
    ).getTime();
    const durationSeconds = Math.round((Date.now() - startMs) / 1000);

    // Count ledger entries for stats.
    // decisions_made counts commit entries + remember entries with a decision: action prefix.
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN tool_name = 'remember' THEN 1 ELSE 0 END) AS created,
        SUM(CASE WHEN tool_name = 'recall'   THEN 1 ELSE 0 END) AS recalled,
        SUM(CASE WHEN tool_name = 'commit'
                   OR (tool_name = 'remember' AND action LIKE 'decision:%')
                 THEN 1 ELSE 0 END) AS decisions
      FROM session_ledger
      WHERE session_id = ?
    `).get(sessionId) as { created: number; recalled: number; decisions: number } | undefined;

    const memoriesCreated  = counts?.created  ?? 0;
    const memoriesRecalled = counts?.recalled  ?? 0;
    const decisionsMade    = counts?.decisions ?? 0;

    db.prepare(`
      UPDATE sessions
      SET
        ended_at         = ?,
        duration_seconds = ?,
        memories_created  = ?,
        memories_recalled = ?,
        decisions_made    = ?,
        status            = 'completed'
      WHERE id = ?
    `).run(now, durationSeconds, memoriesCreated, memoriesRecalled, decisionsMade, sessionId);

    _activeSessionId = null;

    const completed: Session = {
      ...row,
      ended_at:          now,
      duration_seconds:  durationSeconds,
      memories_created:  memoriesCreated,
      memories_recalled: memoriesRecalled,
      decisions_made:    decisionsMade,
      status:            'completed',
    };

    log.info('Session ended', {
      sessionId,
      durationSeconds,
      memoriesCreated,
      memoriesRecalled,
    });

    return completed;
  } catch (err) {
    log.warn('Failed to end session', { error: String(err) });
    _activeSessionId = null;
    return null;
  }
}

/** Return the current active session id, or null if none. */
export function getActiveSessionId(): string | null {
  return _activeSessionId;
}

// ---------------------------------------------------------------------------
// Ledger operations
// ---------------------------------------------------------------------------

/**
 * Append an entry to the session ledger.  Non-fatal — never throws.
 */
export function addLedgerEntry(entry: {
  tool_name: string;
  action?: string;
  memory_id?: string;
  metadata?: Record<string, unknown>;
  project: string;
}): void {
  try {
    const db = getDatabase();
    const sessionId = _activeSessionId;
    if (!sessionId) return; // No active session — silently skip

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO session_ledger (session_id, timestamp, tool_name, action, memory_id, metadata, project)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      now,
      entry.tool_name,
      entry.action ?? '',
      entry.memory_id ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.project,
    );
  } catch {
    // Intentionally swallow — ledger writes must never block tool responses.
  }
}

/**
 * Return all ledger entries for a given session id.
 */
export function getSessionLedger(sessionId: string): LedgerEntry[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM session_ledger
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `).all(sessionId) as unknown as LedgerEntry[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Session gap detection
// ---------------------------------------------------------------------------

/**
 * Return the most recently completed session for the project, or null.
 */
export function getLastSession(project: string): Session | null {
  try {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sessions
      WHERE project = ? AND status = 'completed'
      ORDER BY ended_at DESC, started_at DESC
      LIMIT 1
    `).get(project) as unknown as Session | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Calculate the gap between the last completed session and now.
 * Returns null if there is no prior completed session.
 *
 * Gap categories:
 *   short    < 2h
 *   medium   2–8h
 *   long     8–24h
 *   extended >= 24h
 */
export function getSessionGap(project: string): SessionGap | null {
  const last = getLastSession(project);
  if (!last || !last.ended_at) return null;

  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(last.ended_at)
    ? last.ended_at
    : last.ended_at + 'Z';
  const endMs = new Date(normalized).getTime();
  const nowMs = Date.now();
  const gapHours = (nowMs - endMs) / (1000 * 60 * 60);

  let gapCategory: SessionGap['gapCategory'];
  if (gapHours < 2)       gapCategory = 'short';
  else if (gapHours < 8)  gapCategory = 'medium';
  else if (gapHours < 24) gapCategory = 'long';
  else                     gapCategory = 'extended';

  return {
    lastSessionEnd:       last.ended_at,
    currentSessionStart:  new Date().toISOString(),
    gapHours,
    gapCategory,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint timer
// ---------------------------------------------------------------------------

/**
 * Start a checkpoint timer that updates session stats every 10 minutes.
 * This keeps the sessions row reasonably fresh in case the process is killed.
 */
export function startCheckpointTimer(project: string): void {
  if (_checkpointTimer !== null) return; // Already running

  const INTERVAL = 10 * 60 * 1000; // 10 minutes

  _checkpointTimer = setInterval(() => {
    try {
      const db = getDatabase();
      const sessionId = _activeSessionId;
      if (!sessionId) return;

      const counts = db.prepare(`
        SELECT
          SUM(CASE WHEN tool_name = 'remember' THEN 1 ELSE 0 END) AS created,
          SUM(CASE WHEN tool_name = 'recall'   THEN 1 ELSE 0 END) AS recalled,
          SUM(CASE WHEN tool_name = 'commit'
                     OR (tool_name = 'remember' AND action LIKE 'decision:%')
                   THEN 1 ELSE 0 END) AS decisions
        FROM session_ledger
        WHERE session_id = ?
      `).get(sessionId) as { created: number; recalled: number; decisions: number } | undefined;

      db.prepare(`
        UPDATE sessions
        SET
          memories_created  = ?,
          memories_recalled = ?,
          decisions_made    = ?
        WHERE id = ?
      `).run(
        counts?.created  ?? 0,
        counts?.recalled  ?? 0,
        counts?.decisions ?? 0,
        sessionId,
      );
    } catch {
      // Non-fatal checkpoint
    }
  }, INTERVAL);
}

/**
 * Stop the checkpoint timer.  Safe to call even if it was never started.
 */
export function stopCheckpointTimer(): void {
  if (_checkpointTimer !== null) {
    clearInterval(_checkpointTimer);
    _checkpointTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Paginated session listing (for API)
// ---------------------------------------------------------------------------

export function listSessions(
  project: string,
  limit = 20,
  offset = 0,
): Session[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM sessions
      WHERE project = ?
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `).all(project, limit, offset) as unknown as Session[];
  } catch {
    return [];
  }
}
