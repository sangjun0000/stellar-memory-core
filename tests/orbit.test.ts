import { describe, it, expect } from 'vitest';
import {
  recencyScore,
  frequencyScore,
  importanceToDistance,
  getOrbitZone,
  applyAccessBoost,
} from '../src/engine/orbit.js';

describe('recencyScore', () => {
  it('returns 1.0 for brand-new memory (just created)', () => {
    const now = new Date().toISOString();
    const score = recencyScore(null, now, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.5 at half-life', () => {
    const halfLifeHours = 72;
    const created = new Date(Date.now() - halfLifeHours * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, halfLifeHours);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 at double half-life', () => {
    const halfLifeHours = 72;
    const created = new Date(Date.now() - 2 * halfLifeHours * 60 * 60 * 1000).toISOString();
    const score = recencyScore(null, created, halfLifeHours);
    expect(score).toBeCloseTo(0.25, 1);
  });

  it('uses last_accessed_at over created_at when available', () => {
    const oldCreated = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentAccess = new Date().toISOString();
    const score = recencyScore(recentAccess, oldCreated, 72);
    expect(score).toBeCloseTo(1.0, 1);
  });
});

describe('frequencyScore', () => {
  it('returns 0 for access_count = 0', () => {
    expect(frequencyScore(0, 20)).toBe(0);
  });

  it('grows with access count', () => {
    const score1 = frequencyScore(1, 20);
    const score5 = frequencyScore(5, 20);
    const score20 = frequencyScore(20, 20);
    expect(score5).toBeGreaterThan(score1);
    expect(score20).toBeGreaterThan(score5);
  });

  it('saturates at 1.0', () => {
    const score = frequencyScore(100, 20);
    expect(score).toBe(1.0);
  });
});

describe('importanceToDistance', () => {
  it('maps importance=1.0 to minimum distance (0.1)', () => {
    expect(importanceToDistance(1.0)).toBeCloseTo(0.1, 1);
  });

  it('maps importance=0.0 to maximum distance (100)', () => {
    expect(importanceToDistance(0.0)).toBeCloseTo(100.0, 0);
  });

  it('maps importance=0.5 to ~25 AU (quadratic)', () => {
    const dist = importanceToDistance(0.5);
    // (1-0.5)^2 * 99.9 + 0.1 = 0.25 * 99.9 + 0.1 = 25.075
    expect(dist).toBeCloseTo(25.075, 0);
  });

  it('clamps values above 1.0', () => {
    expect(importanceToDistance(1.5)).toBeCloseTo(0.1, 1);
  });

  it('clamps values below 0.0', () => {
    expect(importanceToDistance(-0.5)).toBeCloseTo(100.0, 0);
  });
});

describe('getOrbitZone', () => {
  it('returns Corona for distance 0.5', () => {
    expect(getOrbitZone(0.5)).toContain('Corona');
  });

  it('returns Inner for distance 3.0', () => {
    expect(getOrbitZone(3.0)).toContain('Inner');
  });

  it('returns Habitable for distance 10.0', () => {
    expect(getOrbitZone(10.0)).toContain('Habitable');
  });

  it('returns Outer for distance 25.0', () => {
    expect(getOrbitZone(25.0)).toContain('Outer');
  });

  it('returns Kuiper for distance 55.0', () => {
    expect(getOrbitZone(55.0)).toContain('Kuiper');
  });

  it('returns Oort for distance 85.0', () => {
    expect(getOrbitZone(85.0)).toContain('Oort');
  });

  it('returns Oort for distance beyond 100', () => {
    expect(getOrbitZone(150)).toContain('Oort');
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
    const boostFar = 80 - applyAccessBoost(80);
    const boostClose = 5 - applyAccessBoost(5);
    expect(boostFar).toBeGreaterThan(boostClose);
  });
});
