/**
 * vec.ts — sqlite-vec integration for vector similarity search
 *
 * Provides a thin layer over the sqlite-vec extension:
 *   - loadVecExtension : load sqlite-vec into an existing DatabaseSync instance
 *   - createVecTable   : create the virtual table + companion mapping table
 *   - insertEmbedding  : store a float32 embedding for a memory_id
 *   - searchByVector   : KNN search returning (memory_id, distance) pairs
 *   - deleteEmbedding  : remove an embedding by memory_id
 *
 * Schema design
 * ─────────────
 * sqlite-vec's vec0 virtual table requires an INTEGER rowid as its primary
 * key. Memory IDs in this project are UUIDs (TEXT), so we maintain a
 * companion table `memory_embedding_map` that maps each memory_id to the
 * integer rowid assigned by vec0.
 *
 * Insertion flow:
 *   1. INSERT into memory_embeddings (vec0) → get auto-assigned rowid
 *   2. INSERT into memory_embedding_map (memory_id → rowid)
 *
 * Search flow:
 *   1. KNN subquery on memory_embeddings with LIMIT
 *   2. JOIN back to memory_embedding_map to recover memory_id
 */

import * as sqliteVec from 'sqlite-vec';
import type { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Extension loading
// ---------------------------------------------------------------------------

/**
 * Load the sqlite-vec extension into an open DatabaseSync connection.
 * Must be called once per connection before any vec0 operations.
 * The db must have been opened with `allowExtension: true`.
 */
export function loadVecExtension(db: DatabaseSync): void {
  // sqlite-vec's load() calls db.loadExtension() internally.
  // The cast is needed because the package types expect its own Db interface.
  (sqliteVec as { load: (db: unknown) => void }).load(db);
}

// ---------------------------------------------------------------------------
// DDL helpers
// ---------------------------------------------------------------------------

const EMBEDDING_DIM = 384; // all-MiniLM-L6-v2 output dimension

/**
 * SQL DDL for the embedding tables.
 * Called from database.ts as part of the main DDL block.
 */
export const VEC_DDL = `
-- Companion table: maps TEXT memory_id to the INTEGER rowid used by vec0
CREATE TABLE IF NOT EXISTS memory_embedding_map (
  memory_id TEXT PRIMARY KEY,
  vec_rowid INTEGER NOT NULL
);

-- vec0 virtual table for 384-dim float32 embeddings (all-MiniLM-L6-v2)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
  embedding float[${EMBEDDING_DIM}]
);
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VectorSearchResult {
  memoryId: string;
  distance: number;
}

/**
 * Store an embedding for a memory.
 *
 * If the memory already has an embedding, it is replaced (delete + insert).
 * Returns the vec0 rowid assigned to this embedding.
 */
export function insertEmbedding(
  db: DatabaseSync,
  memoryId: string,
  embedding: Float32Array,
): number {
  // Remove existing embedding if present (idempotent upsert)
  deleteEmbedding(db, memoryId);

  // Insert the float32 vector into vec0 (Float32Array passed directly)
  const res = db.prepare(
    'INSERT INTO memory_embeddings(embedding) VALUES (?)'
  ).run(embedding) as { lastInsertRowid: number };

  const vecRowid = res.lastInsertRowid;

  // Record the memory_id → rowid mapping
  db.prepare(
    'INSERT INTO memory_embedding_map(memory_id, vec_rowid) VALUES (?, ?)'
  ).run(memoryId, vecRowid);

  return vecRowid;
}

/**
 * KNN search: return the top-k memories closest to the query embedding.
 *
 * sqlite-vec requires a LIMIT clause in the WHERE … MATCH subquery.
 * We use a subquery-then-join pattern to keep the LIMIT inside the
 * vec0 scan while still resolving memory_id from the companion table.
 */
export function searchByVector(
  db: DatabaseSync,
  queryEmbedding: Float32Array,
  limit: number = 20,
): VectorSearchResult[] {
  const rows = db.prepare(`
    SELECT m.memory_id, knn.distance
    FROM (
      SELECT rowid, distance
      FROM memory_embeddings
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    ) knn
    JOIN memory_embedding_map m ON knn.rowid = m.vec_rowid
    ORDER BY knn.distance
  `).all(queryEmbedding, limit) as Array<{ memory_id: string; distance: number }>;

  return rows.map(r => ({ memoryId: r.memory_id, distance: r.distance }));
}

/**
 * Delete the embedding for a memory (if it exists).
 * Called before re-inserting to implement upsert semantics.
 */
export function deleteEmbedding(db: DatabaseSync, memoryId: string): void {
  // Look up the vec0 rowid for this memory
  const row = db.prepare(
    'SELECT vec_rowid FROM memory_embedding_map WHERE memory_id = ?'
  ).get(memoryId) as { vec_rowid: number } | undefined;

  if (!row) return;

  // Delete from both tables
  db.prepare('DELETE FROM memory_embeddings WHERE rowid = ?').run(row.vec_rowid);
  db.prepare('DELETE FROM memory_embedding_map WHERE memory_id = ?').run(memoryId);
}
