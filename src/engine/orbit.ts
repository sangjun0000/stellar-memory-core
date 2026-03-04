/**
 * orbit.ts — Core importance function and orbital mechanics
 *
 * Implements the celestial mechanics metaphor:
 *   - High importance  → small orbital distance (close to the sun)
 *   - Low importance   → large orbital distance (far from the sun, fading)
 *   - Access boost     → pulls a memory closer when it is recalled
 *   - Decay            → memories drift outward over time via recency score
 */

import type { Memory, ImportanceComponents, OrbitChange, StellarConfig } from './types.js';
import { ORBIT_ZONES } from './types.js';
import { keywordRelevance, hybridRelevance } from './gravity.js';
import {
  getMemoriesByProject,
  updateMemoryOrbit,
  insertOrbitLog,
  getSunState,
  cleanupOrbitLog,
} from '../storage/queries.js';
import { getDatabase } from '../storage/database.js';
import { corona } from './corona.js';
import { qualityOrbitAdjustment } from './quality.js';
import { getProceduralDecayMultiplier } from './procedural.js';
import type { MemoryType } from './types.js';

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

/**
 * Calculate recency score using exponential decay.
 *
 * Formula: 0.5 ^ (hoursSince / effectiveHalfLife)
 *   - At t=0          → score = 1.0
 *   - At t=halfLife   → score = 0.5
 *   - At t=2×halfLife → score = 0.25
 *
 * Procedural memories use a slower decay rate (halfLife / 0.3 ≈ 240h for default 72h)
 * so hard-won knowledge persists longer.
 *
 * Returns a value in [0, 1].
 */
export function recencyScore(
  lastAccessedAt: string | null,
  createdAt: string,
  halfLifeHours: number = 72,
  memoryType?: MemoryType,
): number {
  const referenceTime = lastAccessedAt ?? createdAt;
  // Append 'Z' only when there is no existing timezone designator so that
  // Date.parse interprets bare ISO strings as UTC rather than local time.
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(referenceTime)
    ? referenceTime
    : referenceTime + 'Z';
  const refMs = new Date(normalized).getTime();
  if (isNaN(refMs)) throw new Error(`Invalid reference date: "${referenceTime}"`);
  const now = new Date();
  const hoursSince = (now.getTime() - refMs) / (1000 * 60 * 60);

  // Procedural memories decay ~3.3x slower than normal
  const effectiveHalfLife = memoryType === 'procedural'
    ? halfLifeHours / getProceduralDecayMultiplier()
    : halfLifeHours;

  return Math.pow(0.5, Math.max(0, hoursSince) / effectiveHalfLife);
}

/**
 * Calculate frequency score using logarithmic saturation.
 *
 * Formula: log(1 + count) / log(1 + saturationPoint)
 *   - Grows quickly for the first few accesses.
 *   - Plateaus as count approaches saturationPoint.
 *
 * Returns a value in [0, 1].
 */
export function frequencyScore(
  accessCount: number,
  saturationPoint: number = 20,
): number {
  if (saturationPoint <= 0) throw new Error('saturationPoint must be positive');
  return Math.min(1.0, Math.log(1 + accessCount) / Math.log(1 + saturationPoint));
}

// ---------------------------------------------------------------------------
// Composite importance
// ---------------------------------------------------------------------------

/**
 * Calculate overall importance from all four components.
 *
 * Weights are configured via StellarConfig and must sum to 1.0 for a
 * meaningful 0–1 total (they do in the defaults: 0.30+0.20+0.30+0.20=1.00).
 */
export function calculateImportance(
  memory: Memory,
  sunText: string,
  config: StellarConfig,
): ImportanceComponents {
  const weights = config.weights;
  const weightSum = weights.recency + weights.frequency + weights.impact + weights.relevance;
  if (Math.abs(weightSum - 1.0) > 0.01) {
    throw new Error(`Weights must sum to 1.0, got ${weightSum.toFixed(3)}`);
  }

  const rec  = recencyScore(memory.last_accessed_at, memory.created_at, config.decayHalfLifeHours, memory.type);
  const freq = frequencyScore(memory.access_count, config.frequencySaturationPoint);
  const imp  = memory.impact;

  // Combine content + tags so tags act as relevance boosters.
  const memoryText = memory.content + ' ' + memory.tags.join(' ');

  // Attempt to load embeddings synchronously from the vec table for hybrid relevance.
  // Falls back to keyword-only if embeddings are unavailable.
  let rel: number;
  try {
    const db = getDatabase();
    const memRow = db.prepare(
      'SELECT embedding FROM memory_vec WHERE memory_id = ?'
    ).get(memory.id) as { embedding: Buffer } | undefined;

    const sunState = getSunState(memory.project);
    const sunText2 = sunState
      ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
      : sunText;

    if (memRow?.embedding) {
      const memEmbedding = new Float32Array(memRow.embedding.buffer, memRow.embedding.byteOffset, memRow.embedding.byteLength / 4);

      // Look up the sun embedding via the most-recent sun memory, if available.
      const sunRow = db.prepare(
        `SELECT mv.embedding FROM memory_vec mv
         JOIN memories m ON m.id = mv.memory_id
         WHERE m.project = ? AND m.deleted_at IS NULL
         ORDER BY m.importance DESC LIMIT 1`
      ).get(memory.project) as { embedding: Buffer } | undefined;

      const sunEmbedding = sunRow?.embedding
        ? new Float32Array(sunRow.embedding.buffer, sunRow.embedding.byteOffset, sunRow.embedding.byteLength / 4)
        : undefined;

      rel = hybridRelevance(memoryText, sunText2, memEmbedding, sunEmbedding);
    } else {
      rel = keywordRelevance(memoryText, sunText);
    }
  } catch {
    rel = keywordRelevance(memoryText, sunText);
  }

  const total =
    config.weights.recency   * rec  +
    config.weights.frequency * freq +
    config.weights.impact    * imp  +
    config.weights.relevance * rel;

  return {
    recency:   rec,
    frequency: freq,
    impact:    imp,
    relevance: rel,
    total:     Math.min(1.0, Math.max(0.0, total)),
  };
}

// ---------------------------------------------------------------------------
// Distance mapping
// ---------------------------------------------------------------------------

/**
 * Convert importance (0–1) to orbital distance (0.1–100).
 *
 * Uses quadratic mapping so that:
 *   - importance = 1.0 → distance ≈ 0.1  (core / working memory)
 *   - importance = 0.0 → distance = 100  (Oort cloud / nearly forgotten)
 *
 * The quadratic curve creates a non-linear relationship: a memory must fall
 * significantly in importance before it drifts noticeably outward, which
 * mirrors how cognitive salience works in practice.
 */
export function importanceToDistance(importance: number): number {
  const MIN_DISTANCE = 0.1;
  const MAX_DISTANCE = 100.0;
  const clamped    = Math.min(1.0, Math.max(0.0, importance));
  const normalized = Math.pow(1 - clamped, 2);
  return MIN_DISTANCE + normalized * (MAX_DISTANCE - MIN_DISTANCE);
}

/**
 * Inverse of importanceToDistance — derive importance from a given distance.
 *
 * Used when a user manually drags a memory to a new orbital position.
 */
export function distanceToImportance(distance: number): number {
  const MIN_DISTANCE = 0.1;
  const MAX_DISTANCE = 100.0;
  const clamped = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
  const normalized = (clamped - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
  return Math.max(0.0, Math.min(1.0, 1 - Math.sqrt(normalized)));
}

/**
 * Return the orbit zone label for a given distance.
 *
 * Iterates ORBIT_ZONES in definition order (core → forgotten) and returns the
 * first zone whose [min, max) range contains the distance. Falls back to
 * the 'forgotten' label for any distance at or beyond 70.
 */
export function getOrbitZone(distance: number): string {
  for (const [, zone] of Object.entries(ORBIT_ZONES)) {
    if (distance >= zone.min && distance < zone.max) {
      return zone.label;
    }
  }
  // Beyond all defined zones — treat as forgotten.
  return ORBIT_ZONES.forgotten.label;
}

// ---------------------------------------------------------------------------
// Access boost
// ---------------------------------------------------------------------------

/**
 * Apply access boost — pull a memory closer when it is recalled.
 *
 * The boost is proportional to the current distance so that:
 *   - Far-away memories (high distance) receive a large absolute pull.
 *   - Close memories (low distance) are nudged only slightly.
 *
 * MIN_BOOST ensures even core memories get a small reward.
 * The floor of 0.1 prevents distance from going below the core minimum.
 */
export function applyAccessBoost(currentDistance: number): number {
  const BOOST_FACTOR = 0.3;
  const MIN_BOOST    = 0.5;
  const pull = Math.max(MIN_BOOST, currentDistance * BOOST_FACTOR);
  return Math.max(0.1, currentDistance - pull);
}

// ---------------------------------------------------------------------------
// Full orbit recalculation
// ---------------------------------------------------------------------------

/**
 * Run a full orbit recalculation for all memories in a project.
 *
 * Called during stellar_commit and stellar_orbit. For each non-deleted memory:
 *   1. Compute new importance using current sun context.
 *   2. Map importance → distance.
 *   3. If the distance shifted by more than 0.01, persist the change and log it.
 *
 * Returns every OrbitChange that was actually written.
 */
export function recalculateOrbits(project: string, config: StellarConfig): OrbitChange[] {
  const memories = getMemoriesByProject(project);
  if (memories.length === 0) {
    return [];
  }

  // Build sun context text for relevance scoring.
  const sunState = getSunState(project);
  const sunText  = sunState
    ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
    : '';

  const changes: OrbitChange[] = [];

  for (const memory of memories) {
    const components    = calculateImportance(memory, sunText, config);
    const newImportance = components.total;
    // Apply quality-based orbit adjustment: low-quality memories drift further out
    const qualityScore  = memory.quality_score ?? 0.5;
    const newDistance    = importanceToDistance(newImportance) * qualityOrbitAdjustment(qualityScore);
    const velocity      = newDistance - memory.distance;

    // Skip negligible drifts to avoid write churn.
    if (Math.abs(velocity) <= 0.01) {
      continue;
    }

    const change: OrbitChange = {
      memory_id:      memory.id,
      project,
      old_distance:   memory.distance,
      new_distance:   newDistance,
      old_importance: memory.importance,
      new_importance: newImportance,
      trigger:        'decay',
    };

    updateMemoryOrbit(memory.id, newDistance, newImportance, velocity);
    insertOrbitLog(change);
    changes.push(change);
  }

  // Prune orbit log entries older than 90 days to prevent unbounded growth.
  cleanupOrbitLog(90);

  // Refresh the corona cache after orbit recalculation so distance changes
  // are reflected in the in-memory tier immediately.
  corona.warmup(project);

  return changes;
}
