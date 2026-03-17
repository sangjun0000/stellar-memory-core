/**
 * orbit.ts — Core importance function and orbital mechanics (Phase 1)
 *
 * Implements a 3-factor importance model:
 *   importance = 0.35×R + 0.25×F + 0.40×I
 *
 * R (Recency): 24h grace period, then type-specific linear decay
 * F (Frequency): temporally-decayed effective count (7-day half-life)
 * I (Intrinsic): memory.intrinsic ?? INTRINSIC_DEFAULTS[type]
 *
 * Segment-based distance mapping (4 zones):
 *   Core    [0.80, 1.00] → [0.1,  3.0) AU
 *   Near    [0.50, 0.80) → [3.0,  15.0) AU
 *   Stored  [0.20, 0.50) → [15.0, 60.0) AU
 *   Forgotten [0, 0.20)  → [60.0, 100.0] AU
 *
 * High importance  → small orbital distance (close to the sun)
 * Low importance   → large orbital distance (far from the sun, fading)
 */

import type { Memory, ImportanceComponents, OrbitChange, StellarConfig } from './types.js';
import { ORBIT_ZONES, INTRINSIC_DEFAULTS } from './types.js';
import {
  getMemoriesByProject,
  updateMemoryOrbit,
  insertOrbitLog,
  cleanupOrbitLog,
} from '../storage/queries.js';
import { corona } from './corona.js';
import type { MemoryType } from './types.js';
import { getMemoryValidityState } from './validity.js';

// ---------------------------------------------------------------------------
// Type-specific decay horizons (hours after 24h grace period)
// ---------------------------------------------------------------------------

/**
 * How many hours (after the 24h grace period) a memory takes to decay
 * from R=1.0 to R=0.0 via linear decay.
 *
 * Longer horizons = slower decay.
 */
const TYPE_DECAY_HORIZONS: Record<string, number> = {
  decision:    696,  // ~29 days
  milestone:   336,  // 14 days
  procedural:  696,  // ~29 days
  error:       144,  //  6 days
  context:     144,  //  6 days
  task:         48,  //  2 days
  observation:  24,  //  1 day
};

/**
 * Importance floor — memories never auto-decay below this value.
 * Only an explicit `forget` (push mode, sets distance ≥ 95 AU) can go lower.
 */
const IMPORTANCE_FLOOR = 0.15;

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

/**
 * Calculate recency score using 24h grace period + type-specific linear decay.
 *
 * if hoursSince <= 24: R = 1.0
 * else: R = max(0, 1.0 - (hoursSince - 24) / TYPE_DECAY_HORIZON[type])
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
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(referenceTime)
    ? referenceTime
    : referenceTime + 'Z';
  const refMs = new Date(normalized).getTime();
  if (isNaN(refMs)) throw new Error(`Invalid reference date: "${referenceTime}"`);
  const now = new Date();
  const hoursSince = (now.getTime() - refMs) / (1000 * 60 * 60);

  // 24h grace period
  if (hoursSince <= 24) return 1.0;

  // Type-specific linear decay after grace period
  const horizon = memoryType
    ? (TYPE_DECAY_HORIZONS[memoryType] ?? halfLifeHours)
    : halfLifeHours;

  return Math.max(0, 1.0 - (hoursSince - 24) / horizon);
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

/**
 * Calculate temporally-decayed effective count.
 *
 * effective_count = access_count × 0.5^(hoursSince / decayHours)
 * F = min(1.0, log(1 + effective_count) / log(11))
 *
 * Returns a value in [0, 1].
 */
function temporalFrequency(
  accessCount: number,
  lastAccessedAt: string | null,
  createdAt: string,
  decayHours: number = 168,
): { f: number; effectiveCount: number } {
  if (accessCount === 0) return { f: 0, effectiveCount: 0 };

  const referenceTime = lastAccessedAt ?? createdAt;
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(referenceTime)
    ? referenceTime
    : referenceTime + 'Z';
  const refMs = new Date(normalized).getTime();
  const hoursSince = Math.max(0, (Date.now() - refMs) / (1000 * 60 * 60));

  const effectiveCount = accessCount * Math.pow(0.5, hoursSince / decayHours);
  const f = Math.min(1.0, Math.log(1 + effectiveCount) / Math.log(11));

  return { f, effectiveCount };
}

// ---------------------------------------------------------------------------
// Composite importance
// ---------------------------------------------------------------------------

/**
 * Calculate overall importance using 3-factor model.
 *
 * importance = weightRecency × R + weightFrequency × F + weightIntrinsic × I
 *
 * Validity check: non-active memories (superseded/expired) get total = 0.
 */
export function calculateImportance(
  memory: Memory,
  config: StellarConfig,
): ImportanceComponents {
  const validityState = getMemoryValidityState(memory);
  if (validityState !== 'active') {
    // Non-active memories get zero importance
    return {
      recency: 0, frequency: 0, intrinsic: 0, effectiveCount: 0, total: 0,
      // Deprecated aliases
      frequencyFactor: 0, effectiveHalflife: 0, activation: 0,
      contentWeight: 0, qualityModifier: 0, impact: 0, relevance: 0,
    };
  }

  const wR = config.weightRecency   ?? 0.35;
  const wF = config.weightFrequency ?? 0.25;
  const wI = config.weightIntrinsic ?? 0.40;
  const freqDecay = config.frequencyDecayHours ?? 168;

  // R: type-specific linear decay with 24h grace
  const R = recencyScore(
    memory.last_accessed_at,
    memory.created_at,
    config.decayHalfLifeHours,
    memory.type,
  );

  // F: temporally-decayed effective count
  const { f: F, effectiveCount } = temporalFrequency(
    memory.access_count,
    memory.last_accessed_at,
    memory.created_at,
    freqDecay,
  );

  // I: intrinsic value (override or type default)
  const I = memory.intrinsic != null
    ? memory.intrinsic
    : (INTRINSIC_DEFAULTS[memory.type] ?? 0.30);

  let total = Math.max(0, Math.min(1, wR * R + wF * F + wI * I));

  // Importance floor: auto-decay never pushes below IMPORTANCE_FLOOR.
  // Exception: explicit forget (distance > 70 AU).
  const isExplicitlyForgotten = memory.distance > 70.0;
  if (total < IMPORTANCE_FLOOR && !isExplicitlyForgotten) {
    total = IMPORTANCE_FLOOR;
  }

  return {
    // Primary components
    recency:       R,
    frequency:     F,
    intrinsic:     I,
    effectiveCount,
    total,
    // Deprecated aliases (backward compat)
    frequencyFactor:    F,
    effectiveHalflife:  freqDecay,
    activation:         wR * R + wF * F,
    contentWeight:      I,
    qualityModifier:    1.0,
    impact:             I,
    relevance:          0,
  };
}

// ---------------------------------------------------------------------------
// Distance mapping — segment-based (4 zones)
// ---------------------------------------------------------------------------

/**
 * Convert importance (0–1) to orbital distance (0.1–100 AU).
 *
 * Zone thresholds:
 *   Core      [0.80, 1.00] → [0.1,  3.0)
 *   Near      [0.50, 0.80) → [3.0,  15.0)
 *   Stored    [0.20, 0.50) → [15.0, 60.0)
 *   Forgotten [0.00, 0.20) → [60.0, 100.0]
 */
export function importanceToDistance(importance: number): number {
  const clamped = Math.min(1.0, Math.max(0.0, importance));

  if (clamped >= 0.80) return 0.1  + (1.0  - clamped) / 0.20 * 2.9;
  if (clamped >= 0.50) return 3.0  + (0.80 - clamped) / 0.30 * 12.0;
  if (clamped >= 0.20) return 15.0 + (0.50 - clamped) / 0.30 * 45.0;
  return 60.0 + (0.20 - clamped) / 0.20 * 40.0;
}

/**
 * Inverse of importanceToDistance — derive importance from a given distance.
 *
 * Used when a user manually drags a memory to a new orbital position.
 */
export function distanceToImportance(distance: number): number {
  const clamped = Math.min(100.0, Math.max(0.1, distance));

  if (clamped < 3.0)  return 1.0  - (clamped - 0.1)  / 2.9  * 0.20;
  if (clamped < 15.0) return 0.80 - (clamped - 3.0)  / 12.0 * 0.30;
  if (clamped < 60.0) return 0.50 - (clamped - 15.0) / 45.0 * 0.30;
  return Math.max(0, 0.20 - (clamped - 60.0) / 40.0 * 0.20);
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
  const MIN_BOOST    = 0.05;
  const pull = Math.min(currentDistance * 0.5, Math.max(MIN_BOOST, currentDistance * BOOST_FACTOR));
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

  const changes: OrbitChange[] = [];

  for (const memory of memories) {
    const components    = calculateImportance(memory, config);
    const newImportance = components.total;
    const newDistance   = importanceToDistance(newImportance);
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
