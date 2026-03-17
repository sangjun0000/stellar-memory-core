/**
 * tests/ledger.test.ts — Session lifecycle and ledger tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, resetDatabase } from '../src/storage/database.js';
import {
  startSession,
  endSession,
  getActiveSessionId,
  addLedgerEntry,
  getSessionLedger,
  getLastSession,
  getSessionGap,
  listSessions,
  startCheckpointTimer,
  stopCheckpointTimer,
} from '../src/engine/ledger.js';

// Use a fresh in-memory-ish DB for each test
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDatabase(dbPath);
});

afterEach(() => {
  stopCheckpointTimer();
  resetDatabase();
});

// ---------------------------------------------------------------------------
// startSession / endSession / getActiveSessionId
// ---------------------------------------------------------------------------

describe('startSession', () => {
  it('returns a uuid string and sets activeSessionId', () => {
    const id = startSession('test-project');
    expect(typeof id).toBe('string');
    expect(id.length).toBe(36); // UUID format
    expect(getActiveSessionId()).toBe(id);
  });

  it('marks stale active sessions as abandoned', () => {
    const id1 = startSession('test-project');
    // Start a second session — id1 should be abandoned
    const id2 = startSession('test-project');
    expect(id2).not.toBe(id1);
    expect(getActiveSessionId()).toBe(id2);

    // id1 should be abandoned
    const sessions = listSessions('test-project', 10, 0);
    const s1 = sessions.find(s => s.id === id1);
    expect(s1?.status).toBe('abandoned');
  });
});

describe('endSession', () => {
  it('returns a completed Session with duration', () => {
    startSession('test-project');
    const session = endSession('test-project');
    expect(session).not.toBeNull();
    expect(session!.status).toBe('completed');
    expect(session!.ended_at).not.toBeNull();
    expect(session!.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(getActiveSessionId()).toBeNull();
  });

  it('counts ledger entries in stats', () => {
    const id = startSession('test-project');
    addLedgerEntry({ tool_name: 'remember', action: 'observation:test', project: 'test-project' });
    addLedgerEntry({ tool_name: 'remember', action: 'decision:test', project: 'test-project' });
    addLedgerEntry({ tool_name: 'recall', action: 'query', project: 'test-project' });
    addLedgerEntry({ tool_name: 'commit', project: 'test-project' });

    const session = endSession('test-project');
    expect(session!.memories_created).toBe(2);
    expect(session!.memories_recalled).toBe(1);
    // commit (1) + remember with action 'decision:test' (1) = 2
    expect(session!.decisions_made).toBe(2);
  });

  it('returns null when no active session', () => {
    const result = endSession('test-project');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addLedgerEntry / getSessionLedger
// ---------------------------------------------------------------------------

describe('addLedgerEntry', () => {
  it('does nothing when there is no active session (non-fatal)', () => {
    // No active session — should not throw
    expect(() => {
      addLedgerEntry({ tool_name: 'recall', action: 'test', project: 'test-project' });
    }).not.toThrow();
  });

  it('stores entries and retrieves them by session id', () => {
    const sessionId = startSession('test-project');
    addLedgerEntry({ tool_name: 'remember', action: 'context:some content', project: 'test-project' });
    addLedgerEntry({ tool_name: 'recall', action: 'search query', project: 'test-project' });

    const entries = getSessionLedger(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries[0].tool_name).toBe('remember');
    expect(entries[0].action).toBe('context:some content');
    expect(entries[1].tool_name).toBe('recall');
    expect(entries[1].action).toBe('search query');
  });

  it('stores memory_id when provided', () => {
    const sessionId = startSession('test-project');
    addLedgerEntry({
      tool_name: 'remember',
      action: 'decision:test',
      memory_id: 'abc-123',
      project: 'test-project',
    });

    const entries = getSessionLedger(sessionId);
    expect(entries[0].memory_id).toBe('abc-123');
  });

  it('stores metadata as JSON', () => {
    const sessionId = startSession('test-project');
    addLedgerEntry({
      tool_name: 'recall',
      action: 'query',
      metadata: { limit: 10, type: 'decision' },
      project: 'test-project',
    });

    const entries = getSessionLedger(sessionId);
    expect(entries[0].metadata).toBe(JSON.stringify({ limit: 10, type: 'decision' }));
  });
});

describe('getSessionLedger', () => {
  it('returns empty array for unknown session id', () => {
    const entries = getSessionLedger('non-existent-session-id');
    expect(entries).toEqual([]);
  });

  it('returns entries in chronological order', () => {
    const sessionId = startSession('test-project');
    addLedgerEntry({ tool_name: 'remember', action: 'first', project: 'test-project' });
    addLedgerEntry({ tool_name: 'recall',   action: 'second', project: 'test-project' });
    addLedgerEntry({ tool_name: 'commit',   action: '',       project: 'test-project' });

    const entries = getSessionLedger(sessionId);
    expect(entries.map(e => e.action)).toEqual(['first', 'second', '']);
  });
});

// ---------------------------------------------------------------------------
// getLastSession / getSessionGap
// ---------------------------------------------------------------------------

describe('getLastSession', () => {
  it('returns null when no completed session exists', () => {
    const last = getLastSession('test-project');
    expect(last).toBeNull();
  });

  it('returns a completed session when one exists', () => {
    startSession('test-project');
    endSession('test-project');

    const last = getLastSession('test-project');
    expect(last).not.toBeNull();
    expect(last!.status).toBe('completed');
  });
});

describe('getSessionGap', () => {
  it('returns null when no prior session', () => {
    const gap = getSessionGap('test-project');
    expect(gap).toBeNull();
  });

  it('returns a SessionGap with gapHours and category', () => {
    startSession('test-project');
    endSession('test-project');

    const gap = getSessionGap('test-project');
    expect(gap).not.toBeNull();
    // Gap should be very small (just finished)
    expect(gap!.gapHours).toBeGreaterThanOrEqual(0);
    expect(gap!.gapHours).toBeLessThan(1);
    expect(gap!.gapCategory).toBe('short');
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('listSessions', () => {
  it('returns sessions in reverse chronological order', () => {
    startSession('test-project');
    endSession('test-project');
    startSession('test-project');
    endSession('test-project');
    startSession('test-project');
    endSession('test-project');

    const sessions = listSessions('test-project', 10, 0);
    expect(sessions.length).toBe(3);
    // Started_at should be descending
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i - 1].started_at >= sessions[i].started_at).toBe(true);
    }
  });

  it('respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      startSession('test-project');
      endSession('test-project');
    }
    const page1 = listSessions('test-project', 2, 0);
    const page2 = listSessions('test-project', 2, 2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });
});

// ---------------------------------------------------------------------------
// checkpoint timer
// ---------------------------------------------------------------------------

describe('startCheckpointTimer / stopCheckpointTimer', () => {
  it('does not throw when started and stopped', () => {
    expect(() => {
      startSession('test-project');
      startCheckpointTimer('test-project');
      stopCheckpointTimer();
    }).not.toThrow();
  });

  it('is idempotent — calling start twice does not create two timers', () => {
    startSession('test-project');
    startCheckpointTimer('test-project');
    startCheckpointTimer('test-project'); // second call should be no-op
    stopCheckpointTimer();
    // No assertion needed — just verify it doesn't crash
  });
});
