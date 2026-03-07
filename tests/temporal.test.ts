import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from './setup.js';
import { insertMemory, searchMemories } from '../src/storage/queries.js';
import { getMemoryValidityState, isMemoryCurrentlyActive } from '../src/engine/validity.js';
import { formatSunContent } from '../src/engine/sun.js';
import type { Memory, SunState } from '../src/engine/types.js';

function makeMemory(overrides: Partial<Memory> = {}): Partial<Memory> {
  const now = new Date().toISOString();
  return {
    project: 'test',
    content: 'Redis migration decision',
    summary: 'Redis migration decision',
    type: 'decision',
    tags: ['redis'],
    distance: 0.5,
    importance: 0.9,
    velocity: 0,
    impact: 0.8,
    access_count: 0,
    last_accessed_at: null,
    metadata: {},
    source: 'manual',
    source_path: null,
    source_hash: null,
    content_hash: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...overrides,
  };
}

describe('validity foundation', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('classifies active, future, expired, and superseded memories', () => {
    const now = new Date('2026-03-08T12:00:00.000Z');

    expect(getMemoryValidityState(makeMemory(), now)).toBe('active');
    expect(getMemoryValidityState(makeMemory({ valid_from: '2026-03-09T00:00:00.000Z' }), now)).toBe('future');
    expect(getMemoryValidityState(makeMemory({ valid_until: '2026-03-07T23:59:59.000Z' }), now)).toBe('expired');
    expect(getMemoryValidityState(makeMemory({ superseded_by: 'newer-memory' }), now)).toBe('superseded');
  });

  it('treats only active memories as currently active', () => {
    const now = new Date('2026-03-08T12:00:00.000Z');
    expect(isMemoryCurrentlyActive(makeMemory(), now)).toBe(true);
    expect(isMemoryCurrentlyActive(makeMemory({ valid_until: '2026-03-08T11:59:59.000Z' }), now)).toBe(false);
    expect(isMemoryCurrentlyActive(makeMemory({ superseded_by: 'replacement' }), now)).toBe(false);
  });

  it('searchMemories excludes future, expired, and superseded memories', () => {
    insertMemory(makeMemory({ content: 'Redis migration decision active', summary: 'active redis' }));
    insertMemory(makeMemory({ content: 'Redis migration decision future', summary: 'future redis', valid_from: '2999-01-01T00:00:00.000Z' }));
    insertMemory(makeMemory({ content: 'Redis migration decision expired', summary: 'expired redis', valid_until: '2000-01-01T00:00:00.000Z' }));
    insertMemory(makeMemory({ content: 'Redis migration decision old', summary: 'superseded redis', superseded_by: 'replacement-id' }));

    const results = searchMemories('test', 'Redis migration decision', 10);
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('active');
  });

  it('formatSunContent hides invalid core and near memories', () => {
    const now = new Date().toISOString();
    const sun: SunState = {
      project: 'test',
      content: '',
      current_work: 'Evaluate cache migration',
      recent_decisions: [],
      next_steps: [],
      active_errors: [],
      project_context: '',
      token_count: 0,
      last_commit_at: now,
      updated_at: now,
    };

    const activeCore = makeMemory({ id: 'active-core', summary: 'Active core memory', distance: 0.4 }) as Memory;
    const expiredCore = makeMemory({ id: 'expired-core', summary: 'Expired core memory', distance: 0.5, valid_until: '2000-01-01T00:00:00.000Z' }) as Memory;
    const activeNear = makeMemory({ id: 'active-near', summary: 'Active near memory', distance: 2.0, type: 'context', impact: 0.4 }) as Memory;
    const supersededNear = makeMemory({ id: 'superseded-near', summary: 'Superseded near memory', distance: 2.5, superseded_by: 'replacement-id' }) as Memory;

    const content = formatSunContent(sun, [activeCore, expiredCore], [activeNear, supersededNear]);
    expect(content).toContain('Active core memory');
    expect(content).toContain('Active near memory');
    expect(content).not.toContain('Expired core memory');
    expect(content).not.toContain('Superseded near memory');
  });
});
