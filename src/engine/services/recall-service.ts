/**
 * recall-service.ts — Unified business logic for memory recall.
 *
 * Wraps recallMemoriesAsync with the same options shape that
 * both MCP handleRecall and API GET /memories/search use.
 *
 * The key value-add vs calling recallMemoriesAsync directly:
 *   - Normalises the type filter ('all' → undefined internally)
 *   - Provides a typed RecallInput / RecallResult contract
 */

import type { Memory, MemoryType } from '../types.js';
import { recallMemoriesAsync } from '../planet.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecallInput {
  query: string;
  type?: MemoryType | 'all';
  limit?: number;
  minDistance?: number;
  maxDistance?: number;
  excludeIds?: Set<string>;
}

export interface RecallResult {
  memories: Memory[];
}

// ---------------------------------------------------------------------------
// recallMemories
// ---------------------------------------------------------------------------

/**
 * Recall memories using the full 3-tier hybrid pipeline
 * (Corona cache → FTS5 active zone → FTS5+vector full hybrid).
 *
 * Access boost and orbit update are applied automatically by
 * recallMemoriesAsync for all returned memories.
 */
export async function recallMemories(
  input: RecallInput,
  project: string,
): Promise<RecallResult> {
  const memoryType: MemoryType | undefined =
    input.type === 'all' || input.type === undefined
      ? undefined
      : (input.type as MemoryType);

  const memories = await recallMemoriesAsync(project, input.query, {
    type:        memoryType,
    minDistance: input.minDistance,
    maxDistance: input.maxDistance,
    limit:       input.limit ?? 10,
    excludeIds:  input.excludeIds,
  });

  return { memories };
}
