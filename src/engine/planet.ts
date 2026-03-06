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
  searchMemoriesInRange,
  updateMemoryAccess,
  updateMemoryOrbit,
  insertOrbitLog,
  softDeleteMemory,
  getMemoryById,
  getSunState,
  getMemoryByIds,
  getMemoryByContentHash,
  updateQualityScore,
  getEdgesForBatch,
  getMemoriesByProject,
} from '../storage/queries.js';
import { getConfig } from '../utils/config.js';
import {
  calculateImportance,
  importanceToDistance,
  applyAccessBoost,
  recencyScore,
  frequencyScore,
} from './orbit.js';
import { keywordRelevance } from './gravity.js';
import { generateEmbedding } from './embedding.js';
import { insertEmbedding, searchByVector, deleteEmbedding } from '../storage/vec.js';
import { getDatabase, withTransaction } from '../storage/database.js';
import { createLogger } from '../utils/logger.js';
import { corona } from './corona.js';
import { calculateQuality } from './quality.js';
import { trackBgError } from '../mcp/tools/memory-tools.js';
import { runConsolidation, findSimilarMemory, enrichMemory } from './consolidation.js';

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

  // Semantic deduplication: compare against existing memories using text
  // similarity (Jaccard fallback, since the new memory has no embedding yet).
  // A background async check with the real embedding runs after insertion.
  const candidateText = data.content + ' ' + tags.join(' ');
  const similar = findSimilarMemory(data.project, candidateText, null);
  if (similar) {
    if (similar.action === 'skip') {
      log.debug('Near-exact duplicate detected — skipping insertion', {
        existingId: similar.memory.id,
        similarity: similar.similarity.toFixed(3),
        project:    data.project,
      });
      return similar.memory;
    }
    if (similar.action === 'enrich') {
      log.debug('Similar memory found — enriching existing instead of inserting', {
        existingId: similar.memory.id,
        similarity: similar.similarity.toFixed(3),
        project:    data.project,
      });
      return enrichMemory(similar.memory, data.content);
    }
  }

  // Compute initial importance using static scores.
  const rec  = recencyScore(null, new Date().toISOString(), config.decayHalfLifeHours);
  const freq = frequencyScore(0, config.frequencySaturationPoint);

  // Compute relevance against current sun context so new memories start at a
  // position that reflects their relevance to current work, rather than 0.
  const sunState = getSunState(data.project);
  const sunText  = sunState
    ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
    : '';
  const memoryText = data.content + ' ' + tags.join(' ');
  const rel = keywordRelevance(memoryText, sunText);

  const total = Math.min(
    1.0,
    config.weights.recency   * rec    +
    config.weights.frequency * freq   +
    config.weights.impact    * impact +
    config.weights.relevance * rel,
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

  // Calculate and persist initial quality score
  try {
    const quality = calculateQuality(memory);
    updateQualityScore(memory.id, quality.overall);
  } catch {
    // Quality scoring is non-critical — don't block creation
  }

  // If the new memory lands in the corona zone, cache it immediately.
  if (memory.distance < 5.0) {
    corona.upsert(memory);
  }

  // Auto-consolidation: trigger background consolidation when project
  // memory count exceeds 100 to keep the memory system lean.
  try {
    const projectMemories = getMemoriesByProject(data.project);
    if (projectMemories.length > 100) {
      runConsolidation(data.project).catch(() => {
        try { trackBgError('consolidation'); } catch { /* ignore */ }
      });
    }
  } catch {
    // Non-critical — skip silently
  }

  return memory;
}

/**
 * Schedule an async embedding generation for a memory.
 * After the embedding is stored, runs a high-precision semantic dedup check:
 * if a very similar existing memory is found (≥ SKIP_THRESHOLD), the newly
 * inserted memory is soft-deleted and the existing one is returned.
 * Errors are swallowed so they never affect the calling code path.
 */
function scheduleEmbedding(memoryId: string, text: string): void {
  generateEmbedding(text)
    .then(async embedding => {
      try {
        const db = getDatabase();
        insertEmbedding(db, memoryId, embedding);
      } catch {
        // DB may have been reset (tests) — ignore silently
        return;
      }

      // Post-insertion semantic check with real embedding
      try {
        const { findSimilarMemory: check, enrichMemory: enrich } = await import('./consolidation.js');
        const memory = (await import('../storage/queries.js')).getMemoryById(memoryId);
        if (!memory || memory.deleted_at) return;

        const similar = check(memory.project, text, embedding, memoryId);
        if (!similar) return;

        if (similar.action === 'skip') {
          log.debug('Post-embedding duplicate detected — removing new memory', {
            newId:      memoryId,
            existingId: similar.memory.id,
            similarity: similar.similarity.toFixed(3),
          });
          (await import('../storage/queries.js')).softDeleteMemory(memoryId);
          corona.evict(memoryId);
        } else if (similar.action === 'enrich') {
          log.debug('Post-embedding similar memory — enriching existing', {
            newId:      memoryId,
            existingId: similar.memory.id,
            similarity: similar.similarity.toFixed(3),
          });
          enrich(similar.memory, memory.content);
          // Remove the redundant new memory
          (await import('../storage/queries.js')).softDeleteMemory(memoryId);
          corona.evict(memoryId);
        }
      } catch {
        // Dedup is best-effort — don't block or fail
      }
    })
    .catch(() => {
      // Model not loaded / network error — FTS5 fallback remains active
      try { trackBgError('embedding'); } catch { /* ignore circular import at startup */ }
    });
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
    corona.evict(memoryId);
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

  // Evict from corona cache regardless of mode.
  corona.evict(memoryId);
}

// ---------------------------------------------------------------------------
// Hybrid search helpers (Phase 2)
// ---------------------------------------------------------------------------

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
// Tiered recall pipeline (Corona architecture)
// ---------------------------------------------------------------------------

/** Zone boost factors applied to search results by tier origin. */
const ZONE_BOOST = {
  core: 1.2,
  near: 1.1,
  active: 1.0,
  archive: 0.95,
  fading: 0.85,
  forgotten: 0.7,
} as const;

/** Tier priority multiplier (earlier tiers are preferred at equal relevance). */
const TIER_PRIORITY = {
  tier1: 1.0,
  tier2: 0.95,
  tier3: 0.90,
} as const;

interface ScoredMemory {
  memory: Memory;
  score: number;
  tier: 'CORE' | 'NEAR' | 'ACTIVE' | 'DEEP';
}

/**
 * Async tiered recall: 3-tier pipeline from corona cache → FTS5 → full hybrid.
 *
 * Tier 1: Corona cache (0ms) — core + near zone, token matching
 * Tier 2: Active zone FTS5 (1-5ms) — distance 5.0–15.0
 * Tier 3: Full hybrid FTS5 + vector (5-50ms) — distance 15.0+
 *
 * Early exit: if Tier 1 fills the requested limit, Tier 2 and 3 are skipped.
 */
export async function recallMemoriesAsync(
  project: string,
  query: string,
  options?: {
    type?: MemoryType | 'all';
    minDistance?: number;
    maxDistance?: number;
    limit?: number;
    excludeIds?: Set<string>;
  },
): Promise<Memory[]> {
  const limit = options?.limit ?? 10;
  const scored: ScoredMemory[] = [];
  // Pre-seed seenIds with exclusions (e.g., corona IDs already shown in Sun)
  const seenIds = new Set<string>(options?.excludeIds ?? []);

  // ── Tier 1: Corona cache (in-memory, ~0ms) ─────────────────────────────
  const coronaResults = corona.search(query, limit * 2);
  for (let i = 0; i < coronaResults.length; i++) {
    const m = coronaResults[i];
    const zoneBoost = m.distance < 1.0 ? ZONE_BOOST.core : ZONE_BOOST.near;
    const rankScore = 1 / (1 + i);  // rank-based score
    scored.push({
      memory: m,
      score: rankScore * zoneBoost * TIER_PRIORITY.tier1,
      tier: m.distance < 1.0 ? 'CORE' : 'NEAR',
    });
    seenIds.add(m.id);
  }

  // Early exit: if corona filled the limit, skip DB searches
  const remaining = limit - scored.length;

  // ── Tier 2: Active zone FTS5 (distance 5.0–15.0, ~1-5ms) ──────────────
  if (remaining > 0) {
    const tier2Results = searchMemoriesInRange(project, query, 5.0, 15.0, remaining * 2);
    for (let i = 0; i < tier2Results.length; i++) {
      const m = tier2Results[i];
      if (seenIds.has(m.id)) continue;
      const rankScore = 1 / (1 + i);
      scored.push({
        memory: m,
        score: rankScore * ZONE_BOOST.active * TIER_PRIORITY.tier2,
        tier: 'ACTIVE',
      });
      seenIds.add(m.id);
    }
  }

  // ── Tier 3: Full hybrid FTS5 + vector (distance 15.0+, ~5-50ms) ───────
  const remaining3 = limit - scored.filter(s => s.score > 0).length;
  if (remaining3 > 0) {
    const fetchN = remaining3 * 3;

    // FTS5 for far zone
    const ftsResults = searchMemoriesInRange(project, query, 15.0, 100.0, fetchN);

    // Vector KNN search (async embedding)
    let vecIds: string[] = [];
    try {
      const db = getDatabase();
      const queryEmbedding = await generateEmbedding(query);
      const vecResults = searchByVector(db, queryEmbedding, fetchN);
      vecIds = vecResults.map(r => r.memoryId);
    } catch {
      // Model not ready or vec tables unavailable — FTS5 covers it
    }

    // Merge FTS5 + vector via RRF
    let merged = mergeRRF(ftsResults, vecIds, fetchN);
    merged = hydrateVectorOnlyResults(merged, ftsResults);

    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (seenIds.has(m.id)) continue;
      if (!m.content) continue; // skip unhydrated stubs

      const zoneBoost = m.distance < 40
        ? ZONE_BOOST.archive
        : m.distance < 70
          ? ZONE_BOOST.fading
          : ZONE_BOOST.forgotten;

      const rankScore = 1 / (1 + i);
      scored.push({
        memory: m,
        score: rankScore * zoneBoost * TIER_PRIORITY.tier3,
        tier: 'DEEP',
      });
      seenIds.add(m.id);
    }
  }

  // ── Constellation edge boost ──────────────────────────────────────────
  // Memories connected via knowledge graph edges get a score boost.
  try {
    const scoredIds = scored.map(s => s.memory.id);
    const edgeMap = getEdgesForBatch(scoredIds, project);
    const EDGE_BOOST = 0.07;

    for (const entry of scored) {
      const neighbors = edgeMap.get(entry.memory.id);
      if (neighbors && neighbors.size > 0) {
        // Boost proportional to number of connections (capped at 3)
        const edgeCount = Math.min(neighbors.size, 3);
        entry.score += edgeCount * EDGE_BOOST;
      }
    }
  } catch {
    // Constellation tables may not exist — skip boost silently
  }

  // ── Sort by composite score descending ─────────────────────────────────
  scored.sort((a, b) => b.score - a.score);

  // ── Filter ─────────────────────────────────────────────────────────────
  let filtered = scored;

  if (options?.type && options.type !== 'all') {
    const filterType = options.type;
    filtered = filtered.filter(s => s.memory.type === filterType);
  }

  if (options?.minDistance !== undefined) {
    const minDist = options.minDistance;
    filtered = filtered.filter(s => s.memory.distance >= minDist);
  }

  if (options?.maxDistance !== undefined) {
    const maxDist = options.maxDistance;
    filtered = filtered.filter(s => s.memory.distance <= maxDist);
  }

  const finalScored = filtered.slice(0, limit);

  // ── Access boost + orbit update ────────────────────────────────────────
  const sunState = getSunState(project);
  const sunText  = sunState
    ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
    : '';
  const config = getConfig();

  const results = withTransaction(() =>
    finalScored.map(({ memory, tier }) => {
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

      const result = { ...updatedMemory, importance: components.total, velocity };

      // If memory moved into the corona zone (< 5.0 AU), update cache
      if (newDistance < 5.0) {
        corona.upsert(result);
      }

      // Attach tier marker to metadata for display
      result.metadata = { ...result.metadata, _tier: tier };

      return result;
    })
  );

  return results;
}
