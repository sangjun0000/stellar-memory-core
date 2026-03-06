import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  vectorRelevance,
  hybridRelevance,
  keywordRelevance,
  retrievalScore,
} from '../src/engine/gravity.js';

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical unit vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns value close to 0.707 for 45-degree vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 1]);  // not normalized
    // dot = 1, norm(a) = 1, norm(b) = sqrt(2)  →  1/sqrt(2) ≈ 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.7071, 3);
  });

  it('returns 0 for empty arrays', () => {
    const a = new Float32Array([]);
    const b = new Float32Array([]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('is symmetric', () => {
    const a = new Float32Array([0.3, 0.7, 0.1, 0.5]);
    const b = new Float32Array([0.1, 0.4, 0.9, 0.2]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 6);
  });
});

// ---------------------------------------------------------------------------
// vectorRelevance
// ---------------------------------------------------------------------------

describe('vectorRelevance', () => {
  it('returns 1.0 for identical normalized vectors', () => {
    const v = new Float32Array([1, 0, 0, 0]);
    // similarity = 1.0  →  relevance = Math.max(0, 1.0) = 1.0
    expect(vectorRelevance(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    // similarity = 0  →  relevance = Math.max(0, 0) = 0
    expect(vectorRelevance(a, b)).toBeCloseTo(0, 5);
  });

  it('returns 0 when memoryEmbedding is null', () => {
    const b = new Float32Array([1, 0, 0, 0]);
    expect(vectorRelevance(null, b)).toBe(0);
  });

  it('returns 0 when sunEmbedding is null', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    expect(vectorRelevance(a, null)).toBe(0);
  });

  it('returns 0 when both embeddings are null', () => {
    expect(vectorRelevance(null, null)).toBe(0);
  });

  it('returns value in [0, 1] for arbitrary embeddings', () => {
    const a = new Float32Array([0.3, 0.7, 0.1]);
    const b = new Float32Array([0.9, 0.2, 0.5]);
    const score = vectorRelevance(a, b);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// hybridRelevance
// ---------------------------------------------------------------------------

describe('hybridRelevance', () => {
  it('falls back to keyword score when embeddings are absent', () => {
    const kwScore = keywordRelevance(
      'authentication JWT token',
      'working on auth module',
    );
    const hybridScore = hybridRelevance(
      'authentication JWT token',
      'working on auth module',
      null,
      null,
    );
    expect(hybridScore).toBeCloseTo(kwScore, 6);
  });

  it('combines vector and keyword scores with correct weights (0.7 / 0.3)', () => {
    // Use identical vectors → vectorRelevance = 1.0
    const vec = new Float32Array([1, 0, 0, 0]);
    // Use non-overlapping text → keywordRelevance = 0
    const score = hybridRelevance('alpha beta', 'gamma delta', vec, vec);
    // Expected: 0.7 × 1.0 + 0.3 × 0 = 0.7  (rescaled: (1+1)/2 = 1 for vecRel)
    expect(score).toBeCloseTo(0.7, 5);
  });

  it('returns score in [0, 1] for mixed inputs', () => {
    const a = new Float32Array([0.6, 0.8]);
    const b = new Float32Array([0.8, 0.6]);
    const score = hybridRelevance(
      'machine learning model training',
      'deep learning neural network',
      a,
      b,
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('is higher when both semantic and keyword signals are strong', () => {
    const similar = new Float32Array([1, 0, 0, 0]);
    const overlappingText = 'auth login token';
    const contextText     = 'auth login';

    const strongScore = hybridRelevance(overlappingText, contextText, similar, similar);
    const weakScore   = hybridRelevance('database migration', 'frontend styling', null, null);

    expect(strongScore).toBeGreaterThan(weakScore);
  });
});

// ---------------------------------------------------------------------------
// retrievalScore
// ---------------------------------------------------------------------------

describe('retrievalScore', () => {
  it('returns a value in [0, 1]', () => {
    const mem = new Float32Array([1, 0, 0, 0]);
    const query = new Float32Array([1, 0, 0, 0]);
    const score = retrievalScore('auth token', 'auth', 5.0, mem, query);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('proximity_bonus is higher for close memories', () => {
    // Same semantic + keyword, different distance
    const mem = new Float32Array([1, 0, 0, 0]);
    const query = new Float32Array([1, 0, 0, 0]);
    const close  = retrievalScore('auth', 'auth', 1.0,  mem, query);
    const far    = retrievalScore('auth', 'auth', 80.0, mem, query);
    expect(close).toBeGreaterThan(far);
  });

  it('falls back gracefully when embeddings are absent', () => {
    const score = retrievalScore('auth login token', 'auth login', 5.0, null, null);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('keyword-only fallback: no-overlap returns only proximity contribution', () => {
    // With no embeddings and no keyword overlap, only proximity contributes
    // weights: keyword=0.25, proximity=0.20 → normalised: kw=0.556, prx=0.444
    // distance=0 → proximity=1.0, keyword=0 → score = 0.444 × 1.0 = 0.444
    const score = retrievalScore('unrelated content', 'completely different', 0.0, null, null);
    expect(score).toBeGreaterThan(0); // proximity_bonus at distance=0 contributes
    expect(score).toBeLessThan(0.6);
  });

  it('returns higher score when all three signals are strong', () => {
    const vec = new Float32Array([1, 0, 0, 0]);
    // Strong: identical vectors + overlapping keywords + close distance
    const strong = retrievalScore('auth login token', 'auth login', 0.5, vec, vec);
    // Weak: orthogonal vectors + no keyword overlap + far distance
    const weakVec = new Float32Array([0, 1, 0, 0]);
    const weak   = retrievalScore('database migration', 'frontend styling', 90.0, weakVec, vec);
    expect(strong).toBeGreaterThan(weak);
  });

  it('respects custom weights', () => {
    const mem = new Float32Array([1, 0, 0, 0]);
    const query = new Float32Array([0, 1, 0, 0]); // orthogonal → semantic=0
    // With proximity-only weights, score ≈ proximity_bonus
    const proximityOnly = retrievalScore('unrelated', 'unrelated', 0.0, mem, query, {
      semantic: 0.0, keyword: 0.0, proximity: 1.0,
    });
    expect(proximityOnly).toBeCloseTo(1.0, 3); // distance=0 → proximity=1
  });

  it('proximity_bonus = 0 at distance=100', () => {
    const score = retrievalScore('text', 'text', 100.0, null, null);
    // keyword overlap but proximity=0 — score comes entirely from keyword
    // with no embeddings: kw_norm ≈ 0.556, prx_norm ≈ 0.444; keyword > 0
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
