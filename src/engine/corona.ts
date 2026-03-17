/**
 * corona.ts ??In-memory cache layer (the Sun's corona)
 *
 * The corona is an in-memory cache of core + near zone memories that enables
 * sub-millisecond recall for the most important memories ??mimicking how
 * humans instantly access their name, age, and profession (System 1).
 *
 * Architecture:
 *   - Holds up to MAX_CORONA_SIZE memories (sorted by distance ASC).
 *   - Maintains a reverse token index for O(1) keyword matching.
 *   - Warmed up on startup and after orbit recalculations.
 *   - Invalidated and re-warmed on project switch.
 *
 * The corona turns orbital distance from a visual metaphor into a real
 * performance differentiator: closer memories are literally faster to find.
 */

import type { Memory } from './types.js';
import { tokenize } from './gravity.js';
import { getMemoriesByProject } from '../storage/queries.js';
import { createLogger } from '../utils/logger.js';
import { filterActiveMemories, isMemoryCurrentlyActive } from './validity.js';
import { getConfig } from '../utils/config.js';

const log = createLogger('corona');

const CORE_THRESHOLD = 3.0;   // distance < 3.0 AU  (Phase 1: 4-zone system)
const NEAR_THRESHOLD = 15.0;  // distance < 15.0 AU (Phase 1: 4-zone system)

class Corona {
  private cache = new Map<string, Memory>();
  private tokenIndex = new Map<string, Set<string>>();
  private project: string = '';

  /** Compute max cache entries from cacheMb. ~8KB avg per memory (content+summary+tags+embedding). */
  private getMaxCacheSize(): number {
    const mb = getConfig().cacheMb;
    const avgBytesPerMemory = 8 * 1024; // ~8KB
    return Math.max(50, Math.floor((mb * 1024 * 1024) / avgBytesPerMemory));
  }

  /** Load core + near zone memories from DB into the cache. */
  warmup(project: string): void {
    this.project = project;
    this.cache.clear();
    this.tokenIndex.clear();

    const maxSize = this.getMaxCacheSize();
    const memories = getMemoriesByProject(project);
    // memories are already sorted by distance ASC from the query
    const toCache = filterActiveMemories(memories).slice(0, maxSize);

    for (const mem of toCache) {
      this.cache.set(mem.id, mem);
      this.indexTokens(mem);
    }

    const { core, near } = this.getCoreAndNear();
    log.debug('Corona warmed up', {
      project,
      total: toCache.length,
      core: core.length,
      near: near.length,
    });
  }

  /** Invalidate cache and reload for a different project. */
  switchProject(project: string): void {
    this.warmup(project);
  }

  /** Return core + near memories in a single pass (avoids iterating cache twice). */
  getCoreAndNear(): { core: Memory[]; near: Memory[] } {
    const core: Memory[] = [];
    const near: Memory[] = [];
    for (const mem of this.cache.values()) {
      if (mem.distance < CORE_THRESHOLD) {
        core.push(mem);
      } else if (mem.distance < NEAR_THRESHOLD) {
        near.push(mem);
      }
    }
    core.sort((a, b) => a.distance - b.distance);
    near.sort((a, b) => a.distance - b.distance);
    return { core, near };
  }

  /** Return memories in the core zone (distance < 1.0 AU). */
  getCoreMemories(): Memory[] {
    return this.getCoreAndNear().core;
  }

  /** Return memories in the near zone (1.0 <= distance < 5.0 AU). */
  getNearMemories(): Memory[] {
    return this.getCoreAndNear().near;
  }

  /** Token-based search across cached memories. Returns scored results. */
  search(query: string, limit: number): Memory[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.cache.size === 0) return [];

    // Score each memory by counting matching tokens
    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const matchingIds = this.tokenIndex.get(token);
      if (!matchingIds) continue;
      for (const id of matchingIds) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }

    if (scores.size === 0) return [];

    // Sort by score DESC, then by distance ASC for ties
    return [...scores.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const memA = this.cache.get(a[0])!;
        const memB = this.cache.get(b[0])!;
        return memA.distance - memB.distance;
      })
      .slice(0, limit)
      .map(([id]) => this.cache.get(id)!)
      .filter(Boolean);
  }

  /** Check if a memory is in the corona cache. */
  has(id: string): boolean {
    return this.cache.has(id);
  }

  /** Add or update a memory in the cache (if it qualifies by distance). */
  upsert(memory: Memory): void {
    if (memory.project !== this.project) return;
    if (!isMemoryCurrentlyActive(memory)) {
      this.evict(memory.id);
      return;
    }

    // Remove old token entries if updating
    if (this.cache.has(memory.id)) {
      this.removeTokens(memory.id);
    }

    // Only cache if within corona range or if we have room
    const maxSize = this.getMaxCacheSize();
    if (this.cache.size < maxSize || this.cache.has(memory.id)) {
      this.cache.set(memory.id, memory);
      this.indexTokens(memory);
    } else {
      // Check if this memory is closer than the farthest cached memory
      let farthestId = '';
      let farthestDist = 0;
      for (const [id, m] of this.cache) {
        if (m.distance > farthestDist) {
          farthestDist = m.distance;
          farthestId = id;
        }
      }
      if (memory.distance < farthestDist) {
        this.evict(farthestId);
        this.cache.set(memory.id, memory);
        this.indexTokens(memory);
      }
    }
  }

  /** Remove a memory from the corona cache. */
  evict(id: string): void {
    this.removeTokens(id);
    this.cache.delete(id);
  }

  /** Return the current project. */
  getProject(): string {
    return this.project;
  }

  /** Return cache statistics (single-pass). */
  stats(): { total: number; core: number; near: number; project: string } {
    const { core, near } = this.getCoreAndNear();
    return {
      total: this.cache.size,
      core: core.length,
      near: near.length,
      project: this.project,
    };
  }

  // ?�?� Private helpers ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

  private indexTokens(memory: Memory): void {
    // Index only summary + tags — full content is ~70% of text but adds
    // negligible recall value vs the summary, which is already the distilled form.
    const text = [memory.summary, ...memory.tags].join(' ');
    const tokens = tokenize(text);
    for (const token of tokens) {
      let ids = this.tokenIndex.get(token);
      if (!ids) {
        ids = new Set();
        this.tokenIndex.set(token, ids);
      }
      ids.add(memory.id);
    }
  }

  private removeTokens(id: string): void {
    // Remove id from all token sets
    for (const [token, ids] of this.tokenIndex) {
      ids.delete(id);
      if (ids.size === 0) {
        this.tokenIndex.delete(token);
      }
    }
  }
}

/** Singleton corona instance. */
export const corona = new Corona();

