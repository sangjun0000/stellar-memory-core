/**
 * mcp/tools/shared.ts — Shared utilities used across all MCP tool handlers.
 *
 * Exports:
 *   McpResponse       — standard MCP text response type
 *   bgErrors          — background error counters
 *   trackBgError      — increment a background error counter
 *   getBgErrorStats   — snapshot of background error counters
 *   ensureCorona      — lazy-init the corona cache
 *   resolveProject    — get active project name
 *   formatDistance    — format AU distance with zone label
 *   formatMemoryLine  — format a Memory as a one-liner
 *   labelToZoneKey    — map zone label → OrbitZone key
 */

import type { Memory, OrbitZone } from '../../engine/types.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import { getOrbitZone } from '../../engine/orbit.js';
import { getCurrentProject } from '../../engine/multiproject.js';
import { corona } from '../../engine/corona.js';

// ---------------------------------------------------------------------------
// MCP response type
// ---------------------------------------------------------------------------

export type McpResponse = { content: [{ type: 'text'; text: string }] };

// ---------------------------------------------------------------------------
// Background error tracking
// ---------------------------------------------------------------------------

export const bgErrors = {
  embedding: 0,
  constellation: 0,
  consolidation: 0,
};

/** Increment a background error counter. Called from fire-and-forget tasks. */
export function trackBgError(category: keyof typeof bgErrors): void {
  bgErrors[category]++;
}

/** Get background error stats snapshot. */
export function getBgErrorStats(): typeof bgErrors {
  return { ...bgErrors };
}

// ---------------------------------------------------------------------------
// Corona lazy initialization
// ---------------------------------------------------------------------------

let coronaReady = false;
export function ensureCorona(): void {
  if (!coronaReady) {
    corona.warmup(resolveProject());
    coronaReady = true;
  }
}

// ---------------------------------------------------------------------------
// Project resolution
// ---------------------------------------------------------------------------

export function resolveProject(): string {
  // getCurrentProject() reflects runtime switches via the galaxy tool;
  // falls back to the config default on first call (same initial value).
  return getCurrentProject();
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function labelToZoneKey(label: string): OrbitZone {
  for (const [key, info] of Object.entries(ORBIT_ZONES) as [OrbitZone, { min: number; max: number; label: string }][]) {
    if (info.label === label) return key;
  }
  return 'forgotten';
}

/** Check if a given zone key is a valid OrbitZone. */
export function isValidZone(key: string): key is OrbitZone {
  return key in ORBIT_ZONES;
}

export function formatDistance(distance: number): string {
  return `${distance.toFixed(1)} AU`;
}

export function formatMemoryLine(m: Memory): string {
  const pct = (m.importance * 100).toFixed(0);
  return `  [${m.type.toUpperCase()}] ${m.summary} | ${m.distance.toFixed(1)} AU | ${pct}% | ${m.id.slice(0, 8)}`;
}
