/**
 * memory-service.ts — Unified business logic for memory creation.
 *
 * Both MCP handlers and API routes call this instead of invoking
 * planet.ts + individual engine modules independently.
 *
 * Replicates the full orchestration sequence from handleRemember:
 *   1. createMemory  (dedup, embedding scheduling, quality, corona)
 *   2. extractRelationships (background, fire-and-forget)
 *   3. setTemporalBounds  (valid_from = now)
 *   4. calculateQuality   (with peer comparison for accurate uniqueness score)
 *   5. detectConflicts    (async, persists MemoryConflict rows)
 *   6. detectSupersession (auto-supersede if pattern detected)
 */

import type { Memory, MemoryType, QualityScore, MemoryConflict } from '../types.js';
import { createMemory, forgetMemory } from '../planet.js';
import { calculateQuality, getQualityFeedback } from '../quality.js';
import { detectConflicts, formatConflictWarnings } from '../conflict.js';
import { detectSupersession, supersedeMemory, setTemporalBounds } from '../temporal.js';
import { extractRelationships } from '../constellation.js';
import { getMemoriesByProject } from '../../storage/queries.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('memory-service');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateMemoryInput {
  content: string;
  type?: MemoryType;
  tags?: string[];
  impact?: number;
  summary?: string;
  source_path?: string;
}

export interface CreateMemoryResult {
  memory: Memory;
  quality: QualityScore;
  qualityFeedback: string | null;
  conflicts: MemoryConflict[];
  conflictWarnings: string;
  supersededId: string | null;
}

export interface ForgetMemoryInput {
  id: string;
  mode?: 'push' | 'delete';
}

// ---------------------------------------------------------------------------
// createMemoryFull
// ---------------------------------------------------------------------------

/**
 * Create a memory with full business logic applied.
 *
 * Mirrors the sequence in handleRemember, minus the MCP response formatting.
 * Safe to call from both API routes and (eventually) MCP handlers.
 */
export async function createMemoryFull(
  input: CreateMemoryInput,
  project: string,
): Promise<CreateMemoryResult> {
  // 1. Create memory — handles content dedup, semantic dedup, embedding
  //    scheduling, initial quality score, and corona cache placement.
  const memory = createMemory({
    project,
    content: input.content,
    summary: input.summary,
    type:    input.type ?? 'observation',
    impact:  input.impact,
    tags:    input.tags,
  });

  // 2. Background relationship extraction (constellation graph).
  //    Fire-and-forget — never blocks the caller.
  extractRelationships(memory, project).catch(() => {
    log.debug('Background constellation extraction failed', { id: memory.id });
  });

  // 3. Set valid_from to now so temporal queries work correctly.
  setTemporalBounds(memory.id, new Date().toISOString(), undefined);

  // 4. Quality scoring with full peer comparison for accurate uniqueness.
  const allMemories = getMemoriesByProject(project);
  const quality = calculateQuality(memory, allMemories);
  const qualityFeedback = getQualityFeedback(quality);

  // 5. Conflict detection — async, persists MemoryConflict rows.
  const conflicts = await detectConflicts(memory, project);
  const conflictWarnings = formatConflictWarnings(conflicts);

  // 6. Temporal supersession — if the new memory signals a switch/replacement,
  //    auto-supersede the older conflicting memory.
  let supersededId: string | null = null;
  const supersessionCandidate = detectSupersession(memory, allMemories);
  if (supersessionCandidate) {
    supersedeMemory(supersessionCandidate.id, memory.id);
    supersededId = supersessionCandidate.id;
    log.debug('Auto-supersession applied', {
      newId:  memory.id,
      oldId:  supersessionCandidate.id,
    });
  }

  return {
    memory,
    quality,
    qualityFeedback,
    conflicts,
    conflictWarnings,
    supersededId,
  };
}

/**
 * Forget a memory (push to Oort cloud or soft-delete).
 * Thin wrapper kept here so API routes import from one place.
 */
export function forgetMemoryFull(input: ForgetMemoryInput): void {
  forgetMemory(input.id, input.mode ?? 'push');
}
