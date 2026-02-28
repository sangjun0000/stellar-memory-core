import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from './setup.js';
import { createMemory, recallMemories, forgetMemory } from '../src/engine/planet.js';
import { getMemoryById, getMemoriesByProject } from '../src/storage/queries.js';

describe('planet — memory management', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  describe('createMemory', () => {
    it('creates a memory with generated ID', () => {
      const m = createMemory({
        project: 'test',
        content: 'Chose PostgreSQL for production database',
        type: 'decision',
      });
      expect(m.id).toBeDefined();
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.project).toBe('test');
      expect(m.type).toBe('decision');
    });

    it('auto-generates summary from content when not provided', () => {
      const m = createMemory({
        project: 'test',
        content: 'This is a very long piece of content that exceeds fifty characters for summary test',
      });
      expect(m.summary.length).toBeLessThanOrEqual(51); // 50 chars + ellipsis
    });

    it('uses provided summary', () => {
      const m = createMemory({
        project: 'test',
        content: 'Long detailed content here',
        summary: 'Short summary',
      });
      expect(m.summary).toBe('Short summary');
    });

    it('places high-impact decisions closer to sun', () => {
      const decision = createMemory({
        project: 'test',
        content: 'Architecture decision',
        type: 'decision',
      });
      const observation = createMemory({
        project: 'test',
        content: 'Casual observation',
        type: 'observation',
      });
      expect(decision.distance).toBeLessThan(observation.distance);
    });

    it('defaults to observation type', () => {
      const m = createMemory({
        project: 'test',
        content: 'Some note',
      });
      expect(m.type).toBe('observation');
    });

    it('stores tags', () => {
      const m = createMemory({
        project: 'test',
        content: 'Auth bug fix',
        tags: ['auth', 'bug'],
      });
      expect(m.tags).toEqual(['auth', 'bug']);
    });

    it('is persisted and retrievable', () => {
      const m = createMemory({
        project: 'test',
        content: 'Persistent memory',
      });
      const retrieved = getMemoryById(m.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe('Persistent memory');
    });
  });

  describe('recallMemories', () => {
    it('finds memories by content search', () => {
      createMemory({ project: 'test', content: 'PostgreSQL database migration' });
      createMemory({ project: 'test', content: 'React component styling' });

      const results = recallMemories('test', 'PostgreSQL');
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('PostgreSQL');
    });

    it('applies access boost (pulls memory closer)', () => {
      const m = createMemory({ project: 'test', content: 'authentication module' });
      const originalDistance = m.distance;

      const results = recallMemories('test', 'authentication');
      expect(results.length).toBe(1);
      expect(results[0].distance).toBeLessThan(originalDistance);
    });

    it('increments access count', () => {
      createMemory({ project: 'test', content: 'unique search term xyzzy' });

      recallMemories('test', 'xyzzy');
      const after = getMemoriesByProject('test')[0];
      expect(after.access_count).toBe(1);
    });

    it('filters by type', () => {
      createMemory({ project: 'test', content: 'decision about auth', type: 'decision' });
      createMemory({ project: 'test', content: 'error in auth module', type: 'error' });

      const decisions = recallMemories('test', 'auth', { type: 'decision' });
      expect(decisions.every(m => m.type === 'decision')).toBe(true);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        createMemory({ project: 'test', content: `memory about testing item ${i}` });
      }
      const results = recallMemories('test', 'testing', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array for no matches', () => {
      createMemory({ project: 'test', content: 'database stuff' });
      const results = recallMemories('test', 'nonexistentterm');
      expect(results).toEqual([]);
    });
  });

  describe('forgetMemory', () => {
    it('push mode: moves memory to Oort cloud distance', () => {
      const m = createMemory({ project: 'test', content: 'forgettable memory' });
      forgetMemory(m.id, 'push');

      const after = getMemoryById(m.id);
      expect(after).not.toBeNull();
      expect(after!.distance).toBe(95.0);
      expect(after!.importance).toBeCloseTo(0.02, 2);
    });

    it('delete mode: soft-deletes the memory', () => {
      const m = createMemory({ project: 'test', content: 'deletable memory' });
      forgetMemory(m.id, 'delete');

      const after = getMemoryById(m.id);
      expect(after).not.toBeNull();
      expect(after!.deleted_at).not.toBeNull();
    });

    it('deleted memories are excluded from project listing', () => {
      createMemory({ project: 'test', content: 'keep me' });
      const toDelete = createMemory({ project: 'test', content: 'delete me' });
      forgetMemory(toDelete.id, 'delete');

      const memories = getMemoriesByProject('test');
      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe('keep me');
    });
  });
});
