import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateContentWeight } from '../src/engine/content-weight.js';

// Mock getEdgeCountForMemory so tests don't need a real DB
vi.mock('../src/storage/queries.js', () => ({
  getEdgeCountForMemory: vi.fn(() => 0),
}));

import { getEdgeCountForMemory } from '../src/storage/queries.js';

const mockEdgeCount = getEdgeCountForMemory as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockEdgeCount.mockReturnValue(0);
});

describe('calculateContentWeight', () => {
  it('HIGH_COST keyword in decision yields high weight', () => {
    const weight = calculateContentWeight(
      'Switched to a new database schema for better performance',
      'decision',
    );
    // decision base=0.8, reversibility_bonus=+0.15 → should be well above 0.7
    expect(weight).toBeGreaterThan(0.7);
  });

  it('LOW_COST keyword in observation yields lower weight', () => {
    const weight = calculateContentWeight(
      'Renamed the style variable for clarity',
      'observation',
    );
    // observation base=0.3, reversibility_bonus=-0.10 → well below 0.5
    expect(weight).toBeLessThan(0.5);
  });

  it('higher entity count increases scope and raises weight', () => {
    const sparse = calculateContentWeight('Fixed a bug', 'context');
    const rich = calculateContentWeight(
      'AuthService uses JwtMiddleware from express-jwt v9.0 at /src/auth/middleware.ts via https://example.com/docs',
      'context',
    );
    expect(rich).toBeGreaterThan(sparse);
  });

  it('empty content returns minimum value (above 0)', () => {
    const weight = calculateContentWeight('', 'observation');
    expect(weight).toBeGreaterThanOrEqual(0);
    expect(weight).toBeLessThanOrEqual(1);
  });

  it('result is always clamped to [0, 1]', () => {
    for (const type of ['decision', 'milestone', 'error', 'task', 'context', 'observation'] as const) {
      const weight = calculateContentWeight(
        'infrastructure migration architecture database schema security authentication',
        type,
      );
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('higher edge count (more references) increases scope multiplier', () => {
    mockEdgeCount.mockReturnValue(0);
    const noEdges = calculateContentWeight('Simple context note', 'context', 'id-1');

    mockEdgeCount.mockReturnValue(5);
    const manyEdges = calculateContentWeight('Simple context note', 'context', 'id-2');

    expect(manyEdges).toBeGreaterThan(noEdges);
  });
});
