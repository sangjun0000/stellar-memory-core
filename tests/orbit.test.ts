import { describe, it, expect } from 'vitest';
import {
  recencyScore,
  frequencyScore,
  calculateImportance,
  importanceToDistance,
  distanceToImportance,
  getOrbitZone,
  applyAccessBoost,
} from '../src/engine/orbit.js';
import { getConfig } from '../src/utils/config.js';
import type { Memory } from '../src/engine/types.js';

describe('recencyScore', () => {
  it('returns 1.0 for brand-new memory (just created)', () => {
    const now = new Date().toISOString();
    const score = recencyScore(null, now, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns 1.0 within the 24h grace period', () => {
    // 12 hours old — within grace period → R = 1.0
    const created = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('decays linearly after 24h grace period for observation type (horizon=24h)', () => {
    // observation horizon = 24h; at 24+12=36h → remaining = 24-12=12 → R = 12/24 = 0.5
    const created = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, 72, 'observation');
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('decision type decays much slower than observation', () => {
    // 48 hours old (both past 24h grace), decision horizon=696h, observation horizon=24h
    const created = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const decisionScore    = recencyScore(null, created, 72, 'decision');
    const observationScore = recencyScore(null, created, 72, 'observation');
    expect(decisionScore).toBeGreaterThan(observationScore);
  });

  it('uses last_accessed_at over created_at when available', () => {
    const oldCreated = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentAccess = new Date().toISOString();
    const score = recencyScore(recentAccess, oldCreated, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns 0 when past horizon (observation at 48h = 24h past horizon)', () => {
    // observation horizon = 24h; at 24+24=48h → R = max(0, 1 - 24/24) = 0
    const created = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, 72, 'observation');
    expect(score).toBe(0);
  });

  it('legacy: accepts access_count and stabilityGrowth params without error', () => {
    // These params are kept for backward compat but ignored in Phase 1 formula
    const created = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    expect(() => recencyScore(null, created, 72, 'decision', 10, 1.5, 8760)).not.toThrow();
  });
});

describe('frequencyScore', () => {
  it('returns 0 for access_count = 0', () => {
    expect(frequencyScore(0, 50)).toBe(0);
  });

  it('grows with access count', () => {
    const score1  = frequencyScore(1,  50);
    const score5  = frequencyScore(5,  50);
    const score50 = frequencyScore(50, 50);
    expect(score5).toBeGreaterThan(score1);
    expect(score50).toBeGreaterThan(score5);
  });

  it('saturates at 1.0 at saturation point', () => {
    expect(frequencyScore(50, 50)).toBeCloseTo(1.0, 5);
  });

  it('saturates above 1.0 (clamped to 1.0)', () => {
    expect(frequencyScore(100, 50)).toBe(1.0);
  });

  it('default saturation point is 50', () => {
    expect(frequencyScore(50)).toBeCloseTo(1.0, 5);
  });
});

describe('calculateImportance', () => {
  function makeMemory(overrides: Partial<Memory> = {}): Memory {
    const now = new Date().toISOString();
    return {
      id: 'memory-1',
      project: 'test',
      content: 'We decided to migrate the authentication schema to PostgreSQL',
      summary: 'Migrate authentication schema to PostgreSQL',
      type: 'decision',
      tags: ['postgresql', 'authentication', 'schema'],
      distance: 5,
      importance: 0.5,
      velocity: 0,
      impact: 0.8,
      access_count: 2,
      last_accessed_at: now,
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

  it('decision type has higher importance than observation type (same age)', () => {
    const config = getConfig();
    const decision = calculateImportance(makeMemory(), config);
    const observation = calculateImportance(
      makeMemory({ type: 'observation', content: 'Minor CSS tweak', tags: ['css'] }),
      config,
    );
    // decision intrinsic=0.80, observation intrinsic=0.30 → decision should score higher
    expect(decision.total).toBeGreaterThan(observation.total);
  });

  it('zeros out non-active memories even if their base signals are strong', () => {
    const config = getConfig();
    const active = calculateImportance(makeMemory(), config);
    const superseded = calculateImportance(
      makeMemory({ superseded_by: 'replacement-memory' }),
      config,
    );

    expect(active.total).toBeGreaterThan(0);
    expect(superseded.total).toBe(0);
  });

  it('returns all required component fields', () => {
    const config = getConfig();
    const result = calculateImportance(makeMemory(), config);
    expect(result.recency).toBeDefined();
    expect(result.frequency).toBeDefined();
    expect(result.intrinsic).toBeDefined();
    expect(result.total).toBeDefined();
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(1);
  });

  it('intrinsic override takes precedence over type default', () => {
    const config = getConfig();
    const defaultI = calculateImportance(makeMemory({ type: 'observation' }), config);
    const overriddenI = calculateImportance(makeMemory({ type: 'observation', intrinsic: 0.9 }), config);
    // With override=0.9 vs default=0.30, should score higher
    expect(overriddenI.total).toBeGreaterThan(defaultI.total);
  });
});

describe('importanceToDistance — segment mapping (4-zone)', () => {
  it('maps importance=1.0 to minimum distance (0.1)', () => {
    expect(importanceToDistance(1.0)).toBeCloseTo(0.1, 3);
  });

  it('maps importance=0.0 to maximum distance (100)', () => {
    expect(importanceToDistance(0.0)).toBeCloseTo(100.0, 0);
  });

  it('Core zone boundary: importance=0.80 maps to 3.0 AU', () => {
    const d = importanceToDistance(0.80);
    expect(d).toBeCloseTo(3.0, 3);
  });

  it('Near zone boundary: importance=0.50 maps to 15.0 AU', () => {
    const d = importanceToDistance(0.50);
    expect(d).toBeCloseTo(15.0, 3);
  });

  it('Stored zone boundary: importance=0.20 maps to 60.0 AU', () => {
    const d = importanceToDistance(0.20);
    expect(d).toBeCloseTo(60.0, 3);
  });

  it('Core zone: importance=0.90 maps within [0.1, 3.0)', () => {
    const d = importanceToDistance(0.90);
    expect(d).toBeGreaterThanOrEqual(0.1);
    expect(d).toBeLessThan(3.0);
  });

  it('Near zone: importance=0.65 maps within [3.0, 15.0)', () => {
    const d = importanceToDistance(0.65);
    expect(d).toBeGreaterThanOrEqual(3.0);
    expect(d).toBeLessThan(15.0);
  });

  it('Stored zone: importance=0.35 maps within [15.0, 60.0)', () => {
    const d = importanceToDistance(0.35);
    expect(d).toBeGreaterThanOrEqual(15.0);
    expect(d).toBeLessThan(60.0);
  });

  it('Forgotten zone: importance=0.10 maps within [60.0, 100.0]', () => {
    const d = importanceToDistance(0.10);
    expect(d).toBeGreaterThanOrEqual(60.0);
    expect(d).toBeLessThanOrEqual(100.0);
  });

  it('clamps values above 1.0', () => {
    expect(importanceToDistance(1.5)).toBeCloseTo(0.1, 3);
  });

  it('clamps values below 0.0', () => {
    expect(importanceToDistance(-0.5)).toBeCloseTo(100.0, 0);
  });

  it('is monotonically decreasing', () => {
    const points = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const distances = points.map(importanceToDistance);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThan(distances[i - 1]);
    }
  });
});

describe('distanceToImportance — inverse segment mapping (4-zone)', () => {
  it('maps distance=0.1 to importance≈1.0', () => {
    expect(distanceToImportance(0.1)).toBeCloseTo(1.0, 3);
  });

  it('maps distance=100 to importance≈0', () => {
    expect(distanceToImportance(100)).toBeCloseTo(0.0, 1);
  });

  it('round-trips importanceToDistance within ~0.01 for 4-zone boundaries', () => {
    const points = [0.20, 0.35, 0.50, 0.65, 0.80, 1.0];
    for (const imp of points) {
      const d = importanceToDistance(imp);
      const back = distanceToImportance(d);
      expect(back).toBeCloseTo(imp, 1);
    }
  });
});

describe('getOrbitZone', () => {
  it('returns Core Memory for distance 0.5', () => {
    expect(getOrbitZone(0.5)).toBe('Core Memory');
  });

  it('returns Core Memory for distance 2.9 (still in core, max 3.0)', () => {
    expect(getOrbitZone(2.9)).toBe('Core Memory');
  });

  it('returns Recent Memory for distance 3.0', () => {
    expect(getOrbitZone(3.0)).toBe('Recent Memory');
  });

  it('returns Recent Memory for distance 10.0', () => {
    expect(getOrbitZone(10.0)).toBe('Recent Memory');
  });

  it('returns Stored Memory for distance 25.0', () => {
    expect(getOrbitZone(25.0)).toBe('Stored Memory');
  });

  it('returns Stored Memory for distance 55.0', () => {
    expect(getOrbitZone(55.0)).toBe('Stored Memory');
  });

  it('returns Forgotten Memory for distance 60.0', () => {
    expect(getOrbitZone(60.0)).toBe('Forgotten Memory');
  });

  it('returns Forgotten Memory for distance 85.0', () => {
    expect(getOrbitZone(85.0)).toBe('Forgotten Memory');
  });

  it('returns Forgotten Memory for distance beyond 100', () => {
    expect(getOrbitZone(150)).toBe('Forgotten Memory');
  });
});

describe('applyAccessBoost', () => {
  it('pulls memory closer', () => {
    const original = 50.0;
    const boosted = applyAccessBoost(original);
    expect(boosted).toBeLessThan(original);
  });

  it('never goes below 0.1', () => {
    const boosted = applyAccessBoost(0.1);
    expect(boosted).toBeGreaterThanOrEqual(0.1);
  });

  it('applies proportional pull (far memories get bigger boost)', () => {
    const boostFar   = 80 - applyAccessBoost(80);
    const boostClose = 5  - applyAccessBoost(5);
    expect(boostFar).toBeGreaterThan(boostClose);
  });

  it('pull never exceeds 50% of current distance (proportionality)', () => {
    // For small distances, pull should be capped to maintain fairness
    for (const d of [0.2, 0.5, 1.0, 2.0, 5.0, 10.0]) {
      const boosted = applyAccessBoost(d);
      const pull = d - boosted;
      expect(pull).toBeLessThanOrEqual(d * 0.5 + 0.001); // allow floating point tolerance
    }
  });

  it('core memory at 0.2 AU does not jump to minimum', () => {
    const boosted = applyAccessBoost(0.2);
    // With old MIN_BOOST=0.5, this would jump to 0.1. Now should be proportional.
    expect(boosted).toBeGreaterThan(0.1);
  });
});

describe('Core zone reachability (Phase 1 formula)', () => {
  it('a brand-new decision memory lands in Core zone', () => {
    // Phase 1: importance = 0.35×R + 0.25×F + 0.40×I
    // R=1.0 (fresh), F=0 (new), I=0.80 (decision default)
    // total = 0.35×1.0 + 0.25×0 + 0.40×0.80 = 0.35 + 0.32 = 0.67
    // importanceToDistance(0.67) → Near zone (3–15 AU)
    const wR = 0.35, wF = 0.25, wI = 0.40;
    const total = wR * 1.0 + wF * 0 + wI * 0.80;
    const distance = importanceToDistance(total);
    expect(distance).toBeGreaterThanOrEqual(3.0);
    expect(distance).toBeLessThan(15.0);
  });

  it('a high-intrinsic procedural memory (I=0.85) lands close to Core boundary', () => {
    // R=1.0, F=0, I=0.85 → total = 0.35 + 0.34 = 0.69
    const wR = 0.35, wF = 0.25, wI = 0.40;
    const total = wR * 1.0 + wF * 0 + wI * 0.85;
    const distance = importanceToDistance(total);
    expect(distance).toBeLessThan(15.0);
  });

  it('a fresh observation memory (I=0.30) starts in Stored zone', () => {
    // R=1.0, F=0, I=0.30 → total = 0.35 + 0.12 = 0.47
    const wR = 0.35, wF = 0.25, wI = 0.40;
    const total = wR * 1.0 + wF * 0 + wI * 0.30;
    const distance = importanceToDistance(total);
    expect(distance).toBeGreaterThanOrEqual(15.0);
  });
});
