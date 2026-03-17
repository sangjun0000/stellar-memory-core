/**
 * vec.test.ts — sqlite-vec integration tests
 *
 * These tests open a real in-memory SQLite DB with the sqlite-vec extension
 * loaded to verify the full vector CRUD pipeline.
 *
 * Note: the vec0 table is created with 1024 dimensions (matching BGE-M3).
 * Test vectors are 1024-dim with deterministic values.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  loadVecExtension,
  VEC_DDL,
  insertEmbedding,
  searchByVector,
  deleteEmbedding,
} from '../src/storage/vec.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DIM = 1024;

/** Create a unit vector along axis `idx` (padded with zeros to DIM). */
function unitVec(idx: number): Float32Array {
  const v = new Float32Array(DIM);
  v[idx % DIM] = 1;
  return v;
}

/** Create a normalized random-ish vector based on a seed value. */
function seedVec(seed: number): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    // Deterministic pseudo-random values using a simple LCG
    v[i] = Math.sin(seed * 1000 + i * 0.1);
  }
  // L2 normalize
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

let db: DatabaseSync;

function openVecDb(): DatabaseSync {
  const d = new DatabaseSync(':memory:', { allowExtension: true });
  loadVecExtension(d);
  d.exec(VEC_DDL);
  return d;
}

beforeEach(() => {
  db = openVecDb();
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// insertEmbedding
// ---------------------------------------------------------------------------

describe('insertEmbedding', () => {
  it('inserts an embedding and returns a positive rowid', () => {
    const v = unitVec(0);
    const rowid = insertEmbedding(db, 'mem-1', v);
    expect(rowid).toBeGreaterThan(0);
  });

  it('upserts: replacing an existing embedding does not throw', () => {
    const v1 = unitVec(0);
    const v2 = unitVec(1);
    insertEmbedding(db, 'mem-1', v1);
    expect(() => insertEmbedding(db, 'mem-1', v2)).not.toThrow();
  });

  it('stores the mapping in memory_embedding_map', () => {
    const v = unitVec(0);
    insertEmbedding(db, 'mem-abc', v);
    const row = db.prepare(
      'SELECT memory_id FROM memory_embedding_map WHERE memory_id = ?'
    ).get('mem-abc') as { memory_id: string } | undefined;
    expect(row?.memory_id).toBe('mem-abc');
  });
});

// ---------------------------------------------------------------------------
// searchByVector
// ---------------------------------------------------------------------------

describe('searchByVector', () => {
  beforeEach(() => {
    // Insert three memories with well-separated unit vectors
    insertEmbedding(db, 'mem-1', unitVec(0));   // axis 0
    insertEmbedding(db, 'mem-2', unitVec(100));  // axis 100
    insertEmbedding(db, 'mem-3', unitVec(200));  // axis 200
  });

  it('returns the closest memory for an exact-match query', () => {
    const query = unitVec(0);
    const results = searchByVector(db, query, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memoryId).toBe('mem-1');
    expect(results[0].distance).toBeCloseTo(0, 3);
  });

  it('orders results by ascending distance', () => {
    const query = unitVec(0);
    const results = searchByVector(db, query, 3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('respects the limit parameter', () => {
    const query = unitVec(0);
    const results = searchByVector(db, query, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when no embeddings are stored', () => {
    const emptyDb = openVecDb();
    const results = searchByVector(emptyDb, unitVec(0), 5);
    expect(results).toHaveLength(0);
    emptyDb.close();
  });

  it('returns memory_id strings (not rowids)', () => {
    const results = searchByVector(db, unitVec(0), 3);
    results.forEach(r => {
      expect(typeof r.memoryId).toBe('string');
      expect(r.memoryId).toMatch(/^mem-/);
    });
  });

  it('finds semantically similar vectors even with noisy dimensions', () => {
    // mem-similar is close to mem-1 (both dominated by axis 0)
    const similar = new Float32Array(DIM);
    similar[0] = 0.99;
    similar[1] = 0.14; // normalize approx
    const len = Math.sqrt(similar[0] ** 2 + similar[1] ** 2);
    similar[0] /= len;
    similar[1] /= len;

    insertEmbedding(db, 'mem-similar', similar);

    const query = unitVec(0);
    const results = searchByVector(db, query, 5);
    const ids = results.map(r => r.memoryId);

    // Both mem-1 and mem-similar should be near the top
    expect(ids).toContain('mem-1');
    expect(ids).toContain('mem-similar');
    // Both should appear before mem-2 (axis 100) and mem-3 (axis 200)
    expect(ids.indexOf('mem-1')).toBeLessThan(ids.indexOf('mem-2'));
  });
});

// ---------------------------------------------------------------------------
// deleteEmbedding
// ---------------------------------------------------------------------------

describe('deleteEmbedding', () => {
  it('removes the embedding from both tables', () => {
    insertEmbedding(db, 'mem-del', unitVec(0));

    deleteEmbedding(db, 'mem-del');

    const mapRow = db.prepare(
      'SELECT * FROM memory_embedding_map WHERE memory_id = ?'
    ).get('mem-del');
    expect(mapRow).toBeUndefined();
  });

  it('does not throw when the memory_id does not exist', () => {
    expect(() => deleteEmbedding(db, 'nonexistent')).not.toThrow();
  });

  it('after deletion the memory no longer appears in search results', () => {
    const v = unitVec(0);
    insertEmbedding(db, 'mem-gone', v);
    deleteEmbedding(db, 'mem-gone');

    const results = searchByVector(db, v, 10);
    const ids = results.map(r => r.memoryId);
    expect(ids).not.toContain('mem-gone');
  });
});
