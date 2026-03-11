/**
 * commit-service.ts — Unified business logic for session commit.
 *
 * Wraps commitToSun + recalculateOrbits so that both MCP handleCommit
 * and API POST /api/sun/commit go through the same code path.
 *
 * The MCP handler also reads procedural memories, temporal summary, and
 * conflict counts to format its response text — those are presentation
 * concerns and stay in the MCP layer. This service returns the raw
 * orbit changes so callers can decide what to display.
 */

import type { OrbitChange } from '../types.js';
import { commitToSun } from '../sun.js';
import { recalculateOrbits } from '../orbit.js';
import { getConfig } from '../../utils/config.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CommitInput {
  current_work: string;
  decisions?: string[];
  next_steps?: string[];
  errors?: string[];
  context?: string;
}

export interface CommitResult {
  orbitChanges: OrbitChange[];
}

// ---------------------------------------------------------------------------
// commitSession
// ---------------------------------------------------------------------------

/**
 * Persist session context to the sun and recalculate orbital distances.
 *
 * Mirrors the core logic of handleCommit, minus MCP response formatting.
 */
export function commitSession(
  input: CommitInput,
  project: string,
): CommitResult {
  commitToSun(project, {
    current_work: input.current_work,
    decisions:    input.decisions  ?? [],
    next_steps:   input.next_steps ?? [],
    errors:       input.errors     ?? [],
    context:      input.context    ?? '',
  });

  const config = getConfig();
  const orbitChanges = recalculateOrbits(project, config);

  return { orbitChanges };
}
