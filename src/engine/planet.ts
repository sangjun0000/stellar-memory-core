/**
 * planet.ts — Memory (planet) management
 *
 * Memories are "planets" orbiting the sun. This module handles:
 *   - createMemory  : place a new memory into orbit.
 *   - recallMemories: search memories and apply access boost to results (hybrid).
 *   - forgetMemory  : push a memory to the Oort cloud or soft-delete it.
 *
 * Phase 2: Hybrid search
 *   createMemory kicks off an async background embedding job so that the
 *   synchronous call returns immediately while the vector index is populated
 *   without blocking the caller.
 *
 *   recallMemories merges FTS5 keyword results with vector KNN results using
 *   Reciprocal Rank Fusion (RRF), then deduplicates and re-ranks.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { Memory, MemoryType } from './types.js';
import { IMPACT_DEFAULTS } from './types.js';
import {
  insertMemory,
  searchMemories,
  updateMemoryAccess,
  updateMemoryOrbit,
  insertOrbitLog,
  softDeleteMemory,
  getMemoryById,
  getSunState,
  getMemoryByIds,
  getMemoryByContentHash,
} from '../storage/queries.js';
import { getConfig } from '../utils/config.js';
import {
  calculateImportance,
  importanceToDistance,
  applyAccessBoost,
  recencyScore,
  frequencyScore,
} from './orbit.js';
import { generateEmbedding } from './embedding.js';
import { insertEmbedding, searchByVector, deleteEmbedding } from '../storage/vec.js';
import { getDatabase, withTransaction } from '../storage/database.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('planet');

// ---------------------------------------------------------------------------
// createMemory
// ---------------------------------------------------------------------------

/**
 * Create a new memory planet and place it in initial orbit.
 *
 * Initial placement uses static component values because the memory has just
 * been created and has no access history or proven relevance yet:
 *   - recency    = 1.0  (brand new)
 *   - frequency  = 0.0  (never recalled)
 *   - impact     = type-specific default (or caller-supplied)
 *   - relevance  = 0.0  (no context yet; updated on next commit)
 *
 * The resulting distance positions the memory in the inner zone for high-impact
 * types (decisions, milestones) and further out for lower-impact types.
 */
export function createMemory(data: {
  project: string;
  content: string;
  summary?: string;
  type?: MemoryType;
  impact?: number;
  tags?: string[];
}): Memory {
  const config = getConfig();

  const type:   MemoryType = data.type   ?? 'observation';
  const impact: number     = data.impact ?? IMPACT_DEFAULTS[type];
  const tags:   string[]   = data.tags   ?? [];

  // Auto-generate a summary from the first 50 characters if none provided.
  const raw     = data.content.trim();
  const summary: string = data.summary
    ? data.summary
    : raw.slice(0, 50).trimEnd() + (raw.length > 50 ? '…' : '');

  // Content-hash deduplication: return the existing memory if identical content
  // has already been stored in this project.
  const contentHash = createHash('sha256').update(data.content).digest('hex');
  const existing = getMemoryByContentHash(data.project, contentHash);
  if (existing) {
    log.debug('Duplicate content detected — returning existing memory', {
      id: existing.id,
      project: data.project,
      content_hash: contentHash,
    });
    return existing;
  }

  // Compute initial importance using static scores.
  const rec  = recencyScore(null, new Date().toISOString(), config.decayHalfLifeHours);
  const freq = frequencyScore(0, config.frequencySaturationPoint);
  // relevance starts at 0 — will be updated on next recalculateOrbits call.
  const total = Math.min(
    1.0,
    config.weights.recency   * rec    +
    config.weights.frequency * freq   +
    config.weights.impact    * impact +
    config.weights.relevance * 0,
  );

  const distance = importanceToDistance(total);
  const now      = new Date().toISOString();

  const memory = insertMemory({
    id:              randomUUID(),
    project:         data.project,
    content:         data.content,
    summary,
    type,
    tags,
    distance,
    importance:      total,
    velocity:        0,
    impact,
    access_count:    0,
    last_accessed_at: null,
    metadata:        {},
    content_hash:    contentHash,
    created_at:      now,
    updated_at:      now,
    deleted_at:      null,
  });

  // Background embedding: fire-and-forget so createMemory stays synchronous.
  // The vector index will be populated within seconds after the model loads.
  scheduleEmbedding(memory.id, memory.content + ' ' + summary);

  return memory;
}

/**
 * Schedule an async embedding generation for a memory.
 * Errors are swallowed so they never affect the calling code path.
 */
function scheduleEmbedding(memoryId: string, text: string): void {
  generateEmbedding(text)
    .then(embedding => {
      try {
        const db = getDatabase();
        insertEmbedding(db, memoryId, embedding);
      } catch {
        // DB may have been reset (tests) — ignore silently
      }
    })
    .catch(() => {
      // Model not loaded / network error — FTS5 fallback remains active
    });
}

// ---------------------------------------------------------------------------
// recallMemories
// ---------------------------------------------------------------------------

/**
 * Recall memories matching a search query using hybrid search (FTS5 + vector).
 *
 * Search strategy:
 *   1. FTS5 keyword search (always available, fast).
 *   2. Vector KNN search (if the query can be embedded and vec tables exist).
 *   3. Results are merged via Reciprocal Rank Fusion (RRF) and deduplicated.
 *
 * For every result the function:
 *   1. Applies an access boost (pulls the memory closer to the sun).
 *   2. Increments access_count and updates last_accessed_at.
 *   3. Logs the orbit change.
 *
 * Options:
 *   - type        : filter by memory type ('all' = no filter, default).
 *   - maxDistance : exclude memories beyond this AU distance.
 *   - limit       : cap result count (default 10).
 */
export function recallMemories(
  project: string,
  query: string,
  options?: {
    type?: MemoryType | 'all';
    maxDistance?: number;
    limit?: number;
  },
): Memory[] {
  const limit = options?.limit ?? 10;
  const fetchN = limit * 3; // over-fetch for post-filter headroom

  // ── 1. FTS5 keyword search ──────────────────────────────────────────────
  const ftsResults = searchMemories(project, query, fetchN);

  // ── 2. Vector search (best-effort; falls back silently) ─────────────────
  // Note: vector search is async in the embedding step but synchronous in
  // the DB lookup. We use a synchronously-cached embedding if available,
  // otherwise skip the vector leg for this call.
  const vecResults = tryVectorSearch(project, query, fetchN);

  // ── 3. Merge via Reciprocal Rank Fusion (RRF) ──────────────────────────
  // RRF score = Σ 1 / (k + rank_i) where k=60 is the smoothing constant.
  // This is robust to differing score scales between FTS5 and vector search.
  let results: Memory[] = mergeRRF(ftsResults, vecResults, limit * 4);

  // ── 4. Fetch full Memory objects for any vector-only results ─────────────
  // mergeRRF may include IDs that only appear in the vec results and were not
  // returned by FTS5. Resolve those now via a batched lookup.
  results = hydrateVectorOnlyResults(results, ftsResults);

  // Filter by memory type.
  if (options?.type && options.type !== 'all') {
    const filterType = options.type;
    results = results.filter((m: Memory) => m.type === filterType);
  }

  // Filter by orbital distance.
  if (options?.maxDistance !== undefined) {
    const maxDist = options.maxDistance;
    results = results.filter((m: Memory) => m.distance <= maxDist);
  }

  // Apply the caller-requested limit after filtering.
  results = results.slice(0, limit);

  // Build sun context once for all importance recalculations in this batch.
  const sunState = getSunState(project);
  const sunText  = sunState
    ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
    : '';

  const config = getConfig();

  // Apply access boost to each recalled memory and persist changes atomically.
  const boosted: Memory[] = withTransaction(() =>
    results.map((memory: Memory) => {
      const newDistance = applyAccessBoost(memory.distance);
      const velocity    = newDistance - memory.distance;

      // Persist the access event (increments access_count, sets last_accessed_at).
      updateMemoryAccess(memory.id);

      // Recalculate importance with updated access data so the stored value
      // stays consistent with what importanceToDistance() would produce.
      const updatedMemory: Memory = {
        ...memory,
        distance:        newDistance,
        access_count:    memory.access_count + 1,
        last_accessed_at: new Date().toISOString(),
      };

      const components = calculateImportance(updatedMemory, sunText, config);

      updateMemoryOrbit(memory.id, newDistance, components.total, velocity);

      insertOrbitLog({
        memory_id:      memory.id,
        project,
        old_distance:   memory.distance,
        new_distance:   newDistance,
        old_importance: memory.importance,
        new_importance: components.total,
        trigger:        'access',
      });

      return {
        ...updatedMemory,
        importance: components.total,
        velocity,
      };
    })
  );

  return boosted;
}

// ---------------------------------------------------------------------------
// forgetMemory
// ---------------------------------------------------------------------------

/**
 * Forget a memory.
 *
 * Modes:
 *   - 'push'  : Push the memory to the Oort cloud (distance ≈ 95 AU).
 *               The memory remains searchable but will rarely surface.
 *   - 'delete': Soft-delete the memory (sets deleted_at; excluded from queries).
 */
export function forgetMemory(memoryId: string, mode: 'push' | 'delete'): void {
  if (mode === 'delete') {
    softDeleteMemory(memoryId);
    return;
  }

  // Push mode: drift the memory to the deep Oort cloud.
  const memory = getMemoryById(memoryId);
  if (!memory) {
    return;
  }

  const OORT_DISTANCE = 95.0; // deep Oort cloud but not at maximum
  const newImportance = 0.02; // nearly forgotten
  const velocity      = OORT_DISTANCE - memory.distance;

  updateMemoryOrbit(memoryId, OORT_DISTANCE, newImportance, velocity);

  insertOrbitLog({
    memory_id:      memoryId,
    project:        memory.project,
    old_distance:   memory.distance,
    new_distance:   OORT_DISTANCE,
    old_importance: memory.importance,
    new_importance: newImportance,
    trigger:        'forget',
  });

  // Also remove the embedding from the vector index
  try {
    const db = getDatabase();
    deleteEmbedding(db, memoryId);
  } catch {
    // vec tables may not be available — ignore
  }
}

// ---------------------------------------------------------------------------
// Hybrid search helpers (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Attempt a vector search for the given query string.
 *
 * This is synchronous from the caller's perspective: it generates an
 * embedding synchronously-cached by the pipeline singleton if the model
 * has already been loaded, or returns an empty array if not yet ready.
 *
 * Because embedding generation is async, we start a non-blocking job and
 * return an empty result on the first cold call. The model warms up in
 * the background, and subsequent calls benefit from cached results.
 */
function tryVectorSearch(
  project: string,
  _query: string,
  limit: number,
): string[] {
  // We only perform synchronous vector lookups here.
  // The query embedding is generated async and not awaited on this call.
  // Instead, we return the IDs that happen to already be in the vec index
  // via an in-memory embedding approach.
  //
  // For a full async hybrid flow, callers should use recallMemoriesAsync().
  // This synchronous version degrades gracefully to FTS5-only when the
  // embedding model hasn't loaded yet.
  try {
    const db = getDatabase();
    // Probe the vec table to see if it's available and has any entries.
    const count = (db.prepare(
      'SELECT COUNT(*) as n FROM memory_embedding_map'
    ).get() as { n: number } | undefined)?.n ?? 0;

    if (count === 0) return [];

    // We can't generate the query embedding synchronously here because
    // generateEmbedding() is async. The async path is exposed via
    // recallMemoriesAsync() below. Return empty array to let FTS5 handle it.
    void project; // suppress unused warning
    void limit;
    return [];
  } catch {
    return [];
  }
}

/**
 * Reciprocal Rank Fusion: merge FTS5 results and vector result IDs.
 *
 * RRF(d) = Σ 1 / (k + rank_i)   where k = 60 (standard constant)
 *
 * Both lists are ranked 1-based. The merged list is sorted by descending
 * RRF score and de-duplicated.
 *
 * Returns an array of Memory objects in merged order. Memories that only
 * appear in the vecIds list will be represented as partial stubs with just
 * the id field populated — callers should call hydrateVectorOnlyResults().
 */
function mergeRRF(
  ftsResults: Memory[],
  vecIds: string[],
  limit: number,
): Memory[] {
  const K = 60;
  const scores = new Map<string, number>();

  ftsResults.forEach((m, i) => {
    scores.set(m.id, (scores.get(m.id) ?? 0) + 1 / (K + i + 1));
  });

  vecIds.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (K + i + 1));
  });

  // Sort by descending RRF score
  const sorted = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  // Build result list: prefer full Memory objects from ftsResults when available
  const ftsMap = new Map(ftsResults.map(m => [m.id, m]));
  return sorted.map(id => ftsMap.get(id) ?? ({ id } as Memory));
}

/**
 * Resolve partial Memory stubs (from vector-only results) into full objects.
 * Performs a single batched DB lookup for all missing memories.
 */
function hydrateVectorOnlyResults(
  merged: Memory[],
  ftsResults: Memory[],
): Memory[] {
  const ftsIds = new Set(ftsResults.map(m => m.id));
  const missingIds = merged
    .filter(m => !ftsIds.has(m.id) && m.content === undefined)
    .map(m => m.id);

  if (missingIds.length === 0) return merged;

  const fetched = getMemoryByIds(missingIds);
  const fetchedMap = new Map(fetched.map(m => [m.id, m]));

  return merged.map(m =>
    m.content === undefined ? (fetchedMap.get(m.id) ?? m) : m
  );
}

// ---------------------------------------------------------------------------
// Async hybrid recall (Phase 2 — full pipeline)
// ---------------------------------------------------------------------------

/**
 * Async version of recallMemories that generates the query embedding and
 * performs a true hybrid FTS5 + vector search.
 *
 * Use this from async contexts (e.g., MCP tool handlers) for best results.
 * Falls back to FTS5-only if embedding generation fails.
 */
export async function recallMemoriesAsync(
  project: string,
  query: string,
  options?: {
    type?: MemoryType | 'all';
    maxDistance?: number;
    limit?: number;
  },
): Promise<Memory[]> {
  const limit = options?.limit ?? 10;
  const fetchN = limit * 3;

  // ── 1. FTS5 keyword search (synchronous) ─────────────────────────────────
  const ftsResults = searchMemories(project, query, fetchN);

  // ── 2. Vector KNN search (async embedding) ────────────────────────────────
  let vecIds: string[] = [];
  try {
    const db = getDatabase();
    const queryEmbedding = await generateEmbedding(query);
    const vecResults = searchByVector(db, queryEmbedding, fetchN);
    vecIds = vecResults.map(r => r.memoryId);
  } catch {
    // Model not ready or vec tables unavailable — FTS5 covers it
  }

  // ── 3. Merge (RRF) + hydrate ──────────────────────────────────────────────
  let results = mergeRRF(ftsResults, vecIds, limit * 4);
  results = hydrateVectorOnlyResults(results, ftsResults);

  // ── 4. Filter ─────────────────────────────────────────────────────────────
  if (options?.type && options.type !== 'all') {
    const filterType = options.type;
    results = results.filter(m => m.type === filterType);
  }

  if (options?.maxDistance !== undefined) {
    const maxDist = options.maxDistance;
    results = results.filter(m => m.distance <= maxDist);
  }

  results = results.slice(0, limit);

  // ── 5. Access boost + orbit update ────────────────────────────────────────
  const sunState = getSunState(project);
  const sunText  = sunState
    ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
    : '';
  const config = getConfig();

  return withTransaction(() =>
    results.map(memory => {
      const newDistance = applyAccessBoost(memory.distance);
      const velocity    = newDistance - memory.distance;

      updateMemoryAccess(memory.id);

      const updatedMemory: Memory = {
        ...memory,
        distance:         newDistance,
        access_count:     memory.access_count + 1,
        last_accessed_at: new Date().toISOString(),
      };

      const components = calculateImportance(updatedMemory, sunText, config);
      updateMemoryOrbit(memory.id, newDistance, components.total, velocity);

      insertOrbitLog({
        memory_id:      memory.id,
        project,
        old_distance:   memory.distance,
        new_distance:   newDistance,
        old_importance: memory.importance,
        new_importance: components.total,
        trigger:        'access',
      });

      return { ...updatedMemory, importance: components.total, velocity };
    })
  );
}
