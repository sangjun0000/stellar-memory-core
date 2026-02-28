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
import { keywordRelevance } from './gravity.js';
import {
  getMemoriesByProject,
  updateMemoryOrbit,
  insertOrbitLog,
  getSunState,
} from '../storage/queries.js';

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

/**
 * Calculate recency score using exponential decay.
 *
 * Formula: 0.5 ^ (hoursSince / halfLifeHours)
 *   - At t=0          → score = 1.0
 *   - At t=halfLife   → score = 0.5
 *   - At t=2×halfLife → score = 0.25
 *
 * Returns a value in [0, 1].
 */
export function recencyScore(
  lastAccessedAt: string | null,
  createdAt: string,
  halfLifeHours: number = 72,
): number {
  const referenceTime = lastAccessedAt ?? createdAt;
  // Append 'Z' only when there is no existing timezone designator so that
  // Date.parse interprets bare ISO strings as UTC rather than local time.
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(referenceTime)
    ? referenceTime
    : referenceTime + 'Z';
  const refDate = new Date(normalized);
  const now = new Date();
  const hoursSince = (now.getTime() - refDate.getTime()) / (1000 * 60 * 60);
  return Math.pow(0.5, Math.max(0, hoursSince) / halfLifeHours);
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
  const rec  = recencyScore(memory.last_accessed_at, memory.created_at, config.decayHalfLifeHours);
  const freq = frequencyScore(memory.access_count, config.frequencySaturationPoint);
  const imp  = memory.impact;
  // Combine content + tags so tags act as relevance boosters.
  const rel  = keywordRelevance(memory.content + ' ' + memory.tags.join(' '), sunText);

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
 *   - importance = 1.0 → distance ≈ 0.1  (corona / working memory)
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
 * Return the orbit zone label for a given distance.
 *
 * Iterates ORBIT_ZONES in definition order (corona → oort) and returns the
 * first zone whose [min, max) range contains the distance. Falls back to
 * the 'oort' label for any distance at or beyond 70.
 */
export function getOrbitZone(distance: number): string {
  for (const [, zone] of Object.entries(ORBIT_ZONES)) {
    if (distance >= zone.min && distance < zone.max) {
      return zone.label;
    }
  }
  // Beyond all defined zones — treat as Oort cloud.
  return ORBIT_ZONES.oort.label;
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
 * MIN_BOOST ensures even corona memories get a small reward.
 * The floor of 0.1 prevents distance from going below the corona minimum.
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
    const newDistance   = importanceToDistance(newImportance);
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

  return changes;
}
