/**
 * orbit.ts — Core importance function and orbital mechanics
 *
 * Implements an ACT-R-inspired activation model:
 *   - Adaptive half-life grows with access count (stable memories decay slower)
 *   - Activation = 0.6×recency + 0.4×frequency (replaces raw recency/frequency weights)
 *   - storageImportance = activation × contentWeight × qualityModifier
 *   - Segment-based distance mapping for sharper zone boundaries
 *
 * High importance  → small orbital distance (close to the sun)
 * Low importance   → large orbital distance (far from the sun, fading)
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
import { calculateContentWeight } from './content-weight.js';
import type { MemoryType } from './types.js';
import { getMemoryValidityState } from './validity.js';

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

/**
 * Calculate recency score using ACT-R adaptive half-life.
 *
 * The effective half-life grows with access count so that frequently-accessed
 * memories decay much more slowly (stable memories persist longer).
 *
 * effectiveHalflife = min(maxStabilityHours, baseHalfLife × stabilityGrowth^min(accessCount,15))
 *
 * Formula: 0.5 ^ (hoursSince / effectiveHalflife)
 *   - At t=0          → score = 1.0
 *   - At t=halfLife   → score = 0.5
 *
 * Returns a value in [0, 1].
 */
export function recencyScore(
  lastAccessedAt: string | null,
  createdAt: string,
  halfLifeHours: number = 72,
  memoryType?: MemoryType,
  accessCount: number = 0,
  stabilityGrowth: number = 1.5,
  maxStabilityHours: number = 8760,
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

  // Adaptive half-life: grows with access frequency, capped at maxStabilityHours
  // Procedural memories use a slower base decay rate (~3.3× slower than normal)
  const baseHalfLife = memoryType === 'procedural'
    ? halfLifeHours / getProceduralDecayMultiplier()
    : halfLifeHours;

  const effectiveHalflife = Math.min(
    maxStabilityHours,
    baseHalfLife * Math.pow(stabilityGrowth, Math.min(accessCount, 15)),
  );

  return Math.pow(0.5, Math.max(0, hoursSince) / effectiveHalflife);
}

/**
 * Calculate frequency factor using logarithmic saturation.
 *
 * Formula: log(1 + count) / log(1 + saturationPoint)
 *   - Grows quickly for the first few accesses.
 *   - Plateaus as count approaches saturationPoint (default 50).
 *
 * Returns a value in [0, 1].
 */
export function frequencyScore(
  accessCount: number,
  saturationPoint: number = 50,
): number {
  if (saturationPoint <= 0) throw new Error('saturationPoint must be positive');
  return Math.min(1.0, Math.log(1 + accessCount) / Math.log(1 + saturationPoint));
}

// ---------------------------------------------------------------------------
// Composite importance
// ---------------------------------------------------------------------------

/**
 * Calculate overall importance using ACT-R activation model.
 *
 * activation = activationRecencyWeight × recency + activationFrequencyWeight × frequencyFactor
 * storageImportance = clamp(activation × contentWeight × qualityModifier, 0, 1)
 *
 * qualityModifier ∈ [0.7, 1.2]:  0.7 + 0.5 × qualityScore
 * contentWeight: injected externally (defaults to memory.impact for backward compat)
 *
 * The legacy weights (recency/frequency/impact/relevance) are ignored in the
 * new activation path but kept in the return value for callers that inspect them.
 */
export function calculateImportance(
  memory: Memory,
  sunText: string,
  config: StellarConfig,
  contentWeight?: number,
): ImportanceComponents {
  const stabilityGrowth   = config.stabilityGrowth   ?? 1.5;
  const maxStabilityHours = config.maxStabilityHours ?? 8760;
  const recencyWeight     = config.activationRecencyWeight   ?? 0.6;
  const frequencyWeight   = config.activationFrequencyWeight ?? 0.4;

  // Effective half-life exposed for callers
  const baseHalfLife = memory.type === 'procedural'
    ? config.decayHalfLifeHours / getProceduralDecayMultiplier()
    : config.decayHalfLifeHours;
  const effectiveHalflife = Math.min(
    maxStabilityHours,
    baseHalfLife * Math.pow(stabilityGrowth, Math.min(memory.access_count, 15)),
  );

  const rec  = recencyScore(
    memory.last_accessed_at,
    memory.created_at,
    config.decayHalfLifeHours,
    memory.type,
    memory.access_count,
    stabilityGrowth,
    maxStabilityHours,
  );
  const freq = frequencyScore(memory.access_count, config.frequencySaturationPoint);

  // ACT-R activation
  const activation = recencyWeight * rec + frequencyWeight * freq;

  // contentWeight: prefer adaptive content evaluation, then caller injection, then impact fallback.
  const cw = contentWeight ?? calculateContentWeight(memory.content, memory.type, memory.id);

  // qualityModifier ∈ [0.7, 1.2]
  const qualityModifier = 0.7 + 0.5 * (memory.quality_score ?? 0.5);

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

  const taskBoost = 0.85 + rel * 0.3;
  const validityState = getMemoryValidityState(memory);
  const validityModifier = validityState === 'active' ? 1 : 0;
  const lastAccessMs = memory.last_accessed_at
    ? new Date(/[Zz]$|[+-]\d{2}:\d{2}$/.test(memory.last_accessed_at) ? memory.last_accessed_at : `${memory.last_accessed_at}Z`).getTime()
    : null;
  const recentlyReused = lastAccessMs !== null && (Date.now() - lastAccessMs) <= 24 * 60 * 60 * 1000;
  const reuseBoost = recentlyReused && rel >= 0.2 ? 1.05 : 1;

  const total = Math.max(0, Math.min(1, activation * cw * qualityModifier * taskBoost * reuseBoost * validityModifier));

  return {
    // Sub-components
    recency:            rec,
    frequencyFactor:    freq,
    effectiveHalflife,
    // Composite
    activation,
    contentWeight:      cw,
    qualityModifier,
    // Legacy aliases
    frequency:          freq,
    impact:             cw,
    relevance:          rel,
    total,
  };
}

// ---------------------------------------------------------------------------
// Distance mapping — segment-based
// ---------------------------------------------------------------------------

/**
 * Convert importance (0–1) to orbital distance (0.1–100 AU).
 *
 * Uses segment-based linear interpolation aligned with ORBIT_ZONES boundaries,
 * giving sharper zone transitions than the old quadratic formula.
 *
 * Zone thresholds:
 *   Core    [0.85, 1.0]  → [0.1,  1.0)
 *   Near    [0.65, 0.85) → [1.0,  5.0)
 *   Active  [0.40, 0.65) → [5.0,  15.0)
 *   Archive [0.20, 0.40) → [15.0, 40.0)
 *   Fading  [0.05, 0.20) → [40.0, 70.0)
 *   Forgotten [0, 0.05)  → [70.0, 100.0]
 */
export function importanceToDistance(importance: number): number {
  const clamped = Math.min(1.0, Math.max(0.0, importance));

  if (clamped >= 0.85) return 0.1  + (1.0  - clamped) / 0.15 * 0.9;
  if (clamped >= 0.65) return 1.0  + (0.85 - clamped) / 0.20 * 4.0;
  if (clamped >= 0.40) return 5.0  + (0.65 - clamped) / 0.25 * 10.0;
  if (clamped >= 0.20) return 15.0 + (0.40 - clamped) / 0.20 * 25.0;
  if (clamped >= 0.05) return 40.0 + (0.20 - clamped) / 0.15 * 30.0;
  return 70.0 + (0.05 - clamped) / 0.05 * 30.0;
}

/**
 * Inverse of importanceToDistance — derive importance from a given distance.
 *
 * Used when a user manually drags a memory to a new orbital position.
 */
export function distanceToImportance(distance: number): number {
  const clamped = Math.min(100.0, Math.max(0.1, distance));

  if (clamped < 1.0)  return 1.0  - (clamped - 0.1)  / 0.9  * 0.15;
  if (clamped < 5.0)  return 0.85 - (clamped - 1.0)  / 4.0  * 0.20;
  if (clamped < 15.0) return 0.65 - (clamped - 5.0)  / 10.0 * 0.25;
  if (clamped < 40.0) return 0.40 - (clamped - 15.0) / 25.0 * 0.20;
  if (clamped < 70.0) return 0.20 - (clamped - 40.0) / 30.0 * 0.15;
  return Math.max(0, 0.05 - (clamped - 70.0) / 30.0 * 0.05);
}

/**
 * Return the orbit zone label for a given distance.
 */
export function getOrbitZone(distance: number): string {
  for (const [, zone] of Object.entries(ORBIT_ZONES)) {
    if (distance >= zone.min && distance < zone.max) {
      return zone.label;
    }
  }
  return ORBIT_ZONES.forgotten.label;
}

// ---------------------------------------------------------------------------
// Access boost
// ---------------------------------------------------------------------------

/**
 * Apply access boost — pull a memory closer when it is recalled.
 *
 * Proportional to current distance so far-away memories get a larger pull.
 * MIN_BOOST ensures even core memories get a small reward.
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
 */
export function recalculateOrbits(project: string, config: StellarConfig): OrbitChange[] {
  const memories = getMemoriesByProject(project);
  if (memories.length === 0) {
    return [];
  }

  const sunState = getSunState(project);
  const sunText  = sunState
    ? [sunState.current_work, ...sunState.recent_decisions, ...sunState.next_steps].join(' ')
    : '';

  const changes: OrbitChange[] = [];

  for (const memory of memories) {
    const components    = calculateImportance(memory, sunText, config);
    const newImportance = components.total;
    const qualityScore  = memory.quality_score ?? 0.5;
    const newDistance   = importanceToDistance(newImportance) * qualityOrbitAdjustment(qualityScore);
    const velocity      = newDistance - memory.distance;

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

  cleanupOrbitLog(90);
  corona.warmup(project);

  return changes;
}
