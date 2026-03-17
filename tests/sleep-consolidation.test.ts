/**
 * tests/sleep-consolidation.test.ts — Sleep consolidation pipeline tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initDatabase, resetDatabase, getDatabase } from '../src/storage/database.js';
import { startSession, endSession, stopCheckpointTimer } from '../src/engine/ledger.js';
import { runSleepConsolidation } from '../src/engine/sleep-consolidation.js';
import { upsertSunState, getSunState } from '../src/storage/queries.js';
import type { Session } from '../src/engine/ledger.js';

let dbPath: string;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id:                'test-session-id',
    project:           'test-project',
    started_at:        new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30min ago
    ended_at:          new Date().toISOString(),
    duration_seconds:  1800,
    summary:           null,
    memories_created:  3,
    memories_recalled: 5,
    decisions_made:    2,
    status:            'completed',
    ...overrides,
  };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `sleep-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDatabase(dbPath);
});

afterEach(() => {
  stopCheckpointTimer();
  resetDatabase();
});

// ---------------------------------------------------------------------------
// runSleepConsolidation
// ---------------------------------------------------------------------------

describe('runSleepConsolidation', () => {
  it('returns a result with phasesCompleted >= 4 on empty project', () => {
    const session = makeSession();
    const result = runSleepConsolidation(session, 'test-project');
    expect(result.phasesCompleted).toBeGreaterThanOrEqual(4);
    expect(result.errors).toHaveLength(0);
  });

  it('builds a summary string from session stats', () => {
    const session = makeSession({
      duration_seconds:  2700,
      memories_created:  5,
      memories_recalled: 8,
    });
    const result = runSleepConsolidation(session, 'test-project');
    expect(result.summary).toContain('45min');
    expect(result.summary).toContain('created=5');
    expect(result.summary).toContain('recalled=8');
  });

  it('handles null duration_seconds gracefully', () => {
    const session = makeSession({ duration_seconds: null });
    const result = runSleepConsolidation(session, 'test-project');
    // Summary should still be non-empty
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detects and deduplicates content-hash duplicates', () => {
    const db = getDatabase();
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString(); // 1min ago
    const sessionId = startSession('test-project');

    // Insert older memory (before session started)
    const oldId = randomUUID();
    db.prepare(`
      INSERT INTO memories (id, project, content, summary, type, content_hash, distance, importance, created_at, updated_at)
      VALUES (?, 'test-project', 'same content', 'same', 'observation', 'hash123', 5.0, 0.5,
              datetime('now', '-10 minutes'), datetime('now'))
    `).run(oldId);

    // Insert newer duplicate (created "during" session)
    const newId = randomUUID();
    db.prepare(`
      INSERT INTO memories (id, project, content, summary, type, content_hash, distance, importance, created_at, updated_at)
      VALUES (?, 'test-project', 'same content', 'same', 'observation', 'hash123', 5.0, 0.5,
              datetime('now'), datetime('now'))
    `).run(newId);

    const session = makeSession({ id: sessionId, started_at: startedAt });
    const result = runSleepConsolidation(session, 'test-project');

    expect(result.dupesFound).toBe(1);
    // The newer memory should now be pushed to Oort cloud
    const row = db.prepare('SELECT distance FROM memories WHERE id = ?').get(newId) as { distance: number };
    expect(row.distance).toBe(95.0);
  });

  it('updates sun state project_context with session summary', () => {
    const now = new Date().toISOString();

    // Seed a sun state
    upsertSunState({
      project:          'test-project',
      content:          'working on something',
      current_work:     'working on something',
      recent_decisions: [],
      next_steps:       [],
      active_errors:    [],
      project_context:  'existing context',
      token_count:      50,
      last_commit_at:   now,
      updated_at:       now,
    });

    const session = makeSession({ memories_created: 2 });
    runSleepConsolidation(session, 'test-project');

    const sun = getSunState('test-project');
    expect(sun!.project_context).toContain('existing context');
    expect(sun!.project_context).toContain('created=2');
  });

  it('is non-fatal — all phases complete even if some data is missing', () => {
    const session = makeSession({
      memories_created:  0,
      memories_recalled: 0,
      decisions_made:    0,
    });
    const result = runSleepConsolidation(session, 'empty-project');
    // Should complete without throwing
    expect(result.phasesCompleted).toBeGreaterThanOrEqual(4);
  });
});
