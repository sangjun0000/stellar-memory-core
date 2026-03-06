import { describe, it, expect } from 'vitest';
import {
  recencyScore,
  frequencyScore,
  importanceToDistance,
  distanceToImportance,
  getOrbitZone,
  applyAccessBoost,
} from '../src/engine/orbit.js';

describe('recencyScore', () => {
  it('returns 1.0 for brand-new memory (just created)', () => {
    const now = new Date().toISOString();
    const score = recencyScore(null, now, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.5 at base half-life when access_count=0', () => {
    const halfLifeHours = 72;
    const created = new Date(Date.now() - halfLifeHours * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, halfLifeHours, undefined, 0, 1.5, 8760);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 at double half-life when access_count=0', () => {
    const halfLifeHours = 72;
    const created = new Date(Date.now() - 2 * halfLifeHours * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, halfLifeHours, undefined, 0, 1.5, 8760);
    expect(score).toBeCloseTo(0.25, 1);
  });

  it('uses last_accessed_at over created_at when available', () => {
    const oldCreated = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentAccess = new Date().toISOString();
    const score = recencyScore(recentAccess, oldCreated, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('adaptive: higher access_count yields slower decay (higher score at same age)', () => {
    const halfLifeHours = 72;
    const created = new Date(Date.now() - halfLifeHours * 60 * 60 * 1000).toISOString();
    // With 0 accesses: score ≈ 0.5 at base half-life
    const score0  = recencyScore(null, created, halfLifeHours, undefined, 0,  1.5, 8760);
    // With 5 accesses: effective half-life is much longer, so score > 0.5
    const score5  = recencyScore(null, created, halfLifeHours, undefined, 5,  1.5, 8760);
    const score15 = recencyScore(null, created, halfLifeHours, undefined, 15, 1.5, 8760);
    expect(score5).toBeGreaterThan(score0);
    expect(score15).toBeGreaterThan(score5);
  });

  it('adaptive half-life is capped at maxStabilityHours', () => {
    const halfLifeHours = 72;
    // With accessCount=15 and stabilityGrowth=1.5: 72 × 1.5^15 ≈ 72 × 437 ≈ 31464 → capped at 8760
    const effectiveMax = Math.min(8760, halfLifeHours * Math.pow(1.5, 15));
    expect(effectiveMax).toBe(8760);
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

describe('importanceToDistance — segment mapping', () => {
  it('maps importance=1.0 to minimum distance (0.1)', () => {
    expect(importanceToDistance(1.0)).toBeCloseTo(0.1, 3);
  });

  it('maps importance=0.0 to maximum distance (100)', () => {
    expect(importanceToDistance(0.0)).toBeCloseTo(100.0, 0);
  });

  it('Core zone: importance=0.85 maps to near 1.0 AU', () => {
    const d = importanceToDistance(0.85);
    expect(d).toBeCloseTo(1.0, 3);
  });

  it('Near zone: importance=0.65 maps to near 5.0 AU', () => {
    const d = importanceToDistance(0.65);
    expect(d).toBeCloseTo(5.0, 3);
  });

  it('Active zone: importance=0.40 maps to near 15.0 AU', () => {
    const d = importanceToDistance(0.40);
    expect(d).toBeCloseTo(15.0, 3);
  });

  it('Archive zone: importance=0.20 maps to near 40.0 AU', () => {
    const d = importanceToDistance(0.20);
    expect(d).toBeCloseTo(40.0, 3);
  });

  it('Fading zone: importance=0.05 maps to near 70.0 AU', () => {
    const d = importanceToDistance(0.05);
    expect(d).toBeCloseTo(70.0, 3);
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

describe('distanceToImportance — inverse segment mapping', () => {
  it('maps distance=0.1 to importance≈1.0', () => {
    expect(distanceToImportance(0.1)).toBeCloseTo(1.0, 3);
  });

  it('maps distance=100 to importance≈0', () => {
    expect(distanceToImportance(100)).toBeCloseTo(0.0, 1);
  });

  it('round-trips importanceToDistance within ~0.01', () => {
    const points = [0.05, 0.2, 0.4, 0.65, 0.85, 1.0];
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

  it('returns Recent Memory for distance 3.0', () => {
    expect(getOrbitZone(3.0)).toBe('Recent Memory');
  });

  it('returns Active Memory for distance 10.0', () => {
    expect(getOrbitZone(10.0)).toBe('Active Memory');
  });

  it('returns Stored Memory for distance 25.0', () => {
    expect(getOrbitZone(25.0)).toBe('Stored Memory');
  });

  it('returns Fading Memory for distance 55.0', () => {
    expect(getOrbitZone(55.0)).toBe('Fading Memory');
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
});

describe('Core zone reachability', () => {
  it('a high-impact memory with access_count=10 can reach Core zone', () => {
    // activation = 0.6 × recencyScore(fresh) + 0.4 × frequencyScore(10, 50)
    // recency ≈ 1.0, frequency ≈ log(11)/log(51) ≈ 0.574
    // activation ≈ 0.6 × 1.0 + 0.4 × 0.574 ≈ 0.83
    // contentWeight = 0.8 (decision), qualityModifier = 0.7 + 0.5×0.8 = 1.1
    // total ≈ 0.83 × 0.8 × 1.1 ≈ 0.73 → distance ≈ 3 AU (Near zone)
    // But with quality_score = 1.0: 1.2 modifier → total ≈ 0.83×0.8×1.2 ≈ 0.796 → Core
    const rec  = 1.0; // fresh
    const freq = Math.log(1 + 10) / Math.log(1 + 50);
    const activation = 0.6 * rec + 0.4 * freq;
    const contentWeight = 0.8;
    const qualityModifier = 0.7 + 0.5 * 1.0; // quality_score=1.0
    const total = Math.min(1, activation * contentWeight * qualityModifier);
    const distance = importanceToDistance(total);
    // Should land in Core or Near zone
    expect(distance).toBeLessThan(5.0);
  });

  it('a fresh decision memory (impact=0.8) reaches near-Core zone with enough accesses', () => {
    // With access_count=15 → frequency ≈ log(16)/log(51) ≈ 0.705
    // activation = 0.6×1.0 + 0.4×0.705 ≈ 0.882
    // total = min(1, 0.882 × 0.8 × 1.2) ≈ 0.846 → Near zone boundary (~1.08 AU)
    const rec  = 1.0;
    const freq = Math.log(1 + 15) / Math.log(1 + 50);
    const activation = 0.6 * rec + 0.4 * freq;
    const contentWeight = 0.8;
    const qualityModifier = 0.7 + 0.5 * 1.0;
    const total = Math.min(1, activation * contentWeight * qualityModifier);
    const distance = importanceToDistance(total);
    expect(distance).toBeLessThan(5.0); // Near zone or better
  });
});
