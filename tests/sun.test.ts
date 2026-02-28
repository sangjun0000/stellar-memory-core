import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from './setup.js';
import { getSunContent, commitToSun, formatSunContent } from '../src/engine/sun.js';
import { getSunState, getMemoriesByProject } from '../src/storage/queries.js';
import type { SunState, Memory } from '../src/engine/types.js';

describe('sun — working context management', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  describe('getSunContent', () => {
    it('returns placeholder when no commits exist', () => {
      const content = getSunContent('test');
      expect(content).toContain('No memories committed yet');
      expect(content).toContain('test');
    });

    it('returns formatted content after commit', () => {
      commitToSun('test', {
        current_work: 'Building authentication module',
        decisions: [],
        next_steps: [],
        errors: [],
      });
      const content = getSunContent('test');
      expect(content).toContain('Building authentication module');
      expect(content).toContain('WORKING ON');
    });
  });

  describe('commitToSun', () => {
    it('creates sun state for project', () => {
      commitToSun('test', {
        current_work: 'Implementing user login',
        decisions: ['Use JWT for auth'],
        next_steps: ['Write tests'],
        errors: ['Token refresh failing'],
      });

      const sun = getSunState('test');
      expect(sun).not.toBeNull();
      expect(sun!.current_work).toBe('Implementing user login');
      expect(sun!.recent_decisions).toEqual(['Use JWT for auth']);
      expect(sun!.next_steps).toEqual(['Write tests']);
      expect(sun!.active_errors).toEqual(['Token refresh failing']);
    });

    it('creates decision memories from decisions array', () => {
      commitToSun('test', {
        current_work: 'Working on DB',
        decisions: ['Chose PostgreSQL', 'Use Prisma ORM'],
        next_steps: [],
        errors: [],
      });

      const memories = getMemoriesByProject('test');
      const decisions = memories.filter(m => m.type === 'decision');
      expect(decisions.length).toBe(2);
      expect(decisions.map(d => d.content)).toContain('Chose PostgreSQL');
      expect(decisions.map(d => d.content)).toContain('Use Prisma ORM');
    });

    it('updates existing sun state on second commit', () => {
      commitToSun('test', {
        current_work: 'First task',
        decisions: [],
        next_steps: [],
        errors: [],
      });
      commitToSun('test', {
        current_work: 'Second task',
        decisions: [],
        next_steps: ['Do third task'],
        errors: [],
      });

      const sun = getSunState('test');
      expect(sun!.current_work).toBe('Second task');
      expect(sun!.next_steps).toEqual(['Do third task']);
    });

    it('preserves project_context across commits', () => {
      commitToSun('test', {
        current_work: 'First',
        decisions: [],
        next_steps: [],
        errors: [],
        context: 'TypeScript + Node.js project',
      });
      commitToSun('test', {
        current_work: 'Second',
        decisions: [],
        next_steps: [],
        errors: [],
      });

      const sun = getSunState('test');
      expect(sun!.project_context).toBe('TypeScript + Node.js project');
    });

    it('sets token_count', () => {
      commitToSun('test', {
        current_work: 'Some work',
        decisions: [],
        next_steps: [],
        errors: [],
      });

      const sun = getSunState('test');
      expect(sun!.token_count).toBeGreaterThan(0);
    });
  });

  describe('formatSunContent', () => {
    it('includes all sections', () => {
      const sun: SunState = {
        project: 'test',
        content: 'test work',
        current_work: 'Building API',
        recent_decisions: ['Use Express'],
        next_steps: ['Add auth'],
        active_errors: ['CORS issue'],
        project_context: '',
        token_count: 0,
        last_commit_at: null,
        updated_at: new Date().toISOString(),
      };
      const result = formatSunContent(sun, []);
      expect(result).toContain('WORKING ON');
      expect(result).toContain('Building API');
      expect(result).toContain('RECENT DECISIONS');
      expect(result).toContain('Use Express');
      expect(result).toContain('NEXT STEPS');
      expect(result).toContain('Add auth');
      expect(result).toContain('ACTIVE ISSUES');
      expect(result).toContain('CORS issue');
    });

    it('includes nearest memories section', () => {
      const sun: SunState = {
        project: 'test',
        content: '',
        current_work: 'work',
        recent_decisions: [],
        next_steps: [],
        active_errors: [],
        project_context: '',
        token_count: 0,
        last_commit_at: null,
        updated_at: new Date().toISOString(),
      };
      const memories: Memory[] = [{
        id: 'test-id',
        project: 'test',
        content: 'A nearby memory',
        summary: 'Nearby memory summary',
        type: 'observation',
        tags: [],
        distance: 1.5,
        importance: 0.9,
        velocity: 0,
        impact: 0.5,
        access_count: 3,
        last_accessed_at: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      }];

      const result = formatSunContent(sun, memories);
      expect(result).toContain('NEAREST MEMORIES');
      expect(result).toContain('Nearby memory summary');
    });
  });
});
