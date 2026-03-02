/**
 * temporal.ts — Temporal Awareness engine
 *
 * Tracks when facts become valid/invalid over time. Memories can have
 * temporal bounds (valid_from, valid_until) and can supersede each other
 * when a concept evolves (e.g., "Chose Redis" → "Switched to Valkey").
 *
 * All functions are pure (no classes), following the project style.
 */

import { getDatabase } from '../storage/database.js';
import {
  getMemoryById,
  getMemoriesAtTime,
  supersedMemory as queriesSupersedMemory,
  getSupersessionChain,
  searchMemories,
} from '../storage/queries.js';
import type { Memory } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('temporal');

// ---------------------------------------------------------------------------
// Temporal bounds
// ---------------------------------------------------------------------------

/**
 * Set temporal validity bounds on a memory.
 *
 * - validFrom:  ISO date string. If omitted, the memory is valid from creation.
 * - validUntil: ISO date string. Setting this marks the fact as no longer current.
 */
export function setTemporalBounds(
  memoryId: string,
  validFrom?: string,
  validUntil?: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [now];

  if (validFrom !== undefined) {
    sets.push('valid_from = ?');
    values.push(validFrom);
  }
  if (validUntil !== undefined) {
    sets.push('valid_until = ?');
    values.push(validUntil);
  }

  values.push(memoryId);
  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  log.debug('Temporal bounds set', { memoryId, validFrom, validUntil });
}

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

/**
 * Mark oldMemoryId as superseded by newMemoryId.
 *
 * Sets the old memory's valid_until to now and records superseded_by.
 * Uses the existing queries.supersedMemory() helper.
 */
export function supersedeMemory(oldMemoryId: string, newMemoryId: string): void {
  queriesSupersedMemory(oldMemoryId, newMemoryId);
  log.debug('Memory superseded', { oldMemoryId, newMemoryId });
}

// ---------------------------------------------------------------------------
// Point-in-time context
// ---------------------------------------------------------------------------

/**
 * Return the set of memories that were active at the given timestamp.
 *
 * A memory is active if:
 *   valid_from IS NULL OR valid_from <= timestamp
 *   AND (valid_until IS NULL OR valid_until > timestamp)
 *
 * Results are sorted by importance descending.
 */
export function getContextAtTime(project: string, timestamp: string): Memory[] {
  const memories = getMemoriesAtTime(project, timestamp);
  return memories.sort((a, b) => b.importance - a.importance);
}

// ---------------------------------------------------------------------------
// Evolution chain
// ---------------------------------------------------------------------------

/**
 * Follow the superseded_by chain forward from memoryId and also walk
 * backward to find the earliest ancestor.
 *
 * Returns the full lineage in chronological order (oldest first).
 */
export function getEvolutionChain(memoryId: string): Memory[] {
  // First find the root (walk backward via content search is not feasible —
  // we look for any memory whose superseded_by points to our target, recursively).
  const root = findChainRoot(memoryId);

  // Now walk forward from root using getSupersessionChain (follows superseded_by).
  const chain = getSupersessionChain(root);

  // Sort chronologically by created_at
  return chain.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Walk backward to find the oldest ancestor in the supersession chain.
 * A memory is a root if no other non-deleted memory has superseded_by = its id.
 */
function findChainRoot(memoryId: string): string {
  const db = getDatabase();
  let currentId = memoryId;

  for (let depth = 0; depth < 50; depth++) {
    const row = db.prepare(`
      SELECT id FROM memories
      WHERE superseded_by = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(currentId) as { id: string } | undefined;

    if (!row) break;
    currentId = row.id;
  }

  return currentId;
}

// ---------------------------------------------------------------------------
// Auto-detect supersession
// ---------------------------------------------------------------------------

/**
 * Detect whether newMemory should supersede an existing memory.
 *
 * Heuristics (no LLM required):
 *   1. Same memory type (especially 'decision')
 *   2. High keyword overlap (>70% shared key terms)
 *   3. Content contains a "switch" signal ("switched from", "replaced", "instead of", etc.)
 *   4. Existing memory has not already been superseded
 *
 * Returns the memory that should be superseded, or null.
 */
export function detectSupersession(
  newMemory: Memory,
  existingMemories: Memory[],
): Memory | null {
  const newTerms = extractKeyTerms(newMemory.content.toLowerCase());
  const newLower = newMemory.content.toLowerCase();

  // Detect switch signals in the new memory content
  const SWITCH_PATTERNS = [
    /switched?\s+from\s+(\w+)/i,
    /replaced?\s+(\w+)/i,
    /instead\s+of\s+(\w+)/i,
    /moving?\s+(?:away\s+)?from\s+(\w+)/i,
    /migrat\w+\s+from\s+(\w+)/i,
    /no\s+longer\s+us\w+\s+(\w+)/i,
  ];

  for (const existing of existingMemories) {
    // Skip already-superseded memories
    if (existing.superseded_by) continue;
    // Skip self
    if (existing.id === newMemory.id) continue;

    const existingLower = existing.content.toLowerCase();
    const existingTerms = extractKeyTerms(existingLower);

    const overlap = termOverlap(newTerms, existingTerms);

    // Require minimum shared context
    if (overlap < 0.4) continue;

    // Same type (especially decision) + high overlap → likely supersession
    if (existing.type === newMemory.type && existing.type === 'decision' && overlap >= 0.7) {
      log.debug('Supersession candidate found (decision type + high overlap)', {
        existingId: existing.id,
        overlap,
      });
      return existing;
    }

    // Switch signal: new memory explicitly references a transition away from something
    for (const pattern of SWITCH_PATTERNS) {
      const match = newLower.match(pattern);
      if (match) {
        const switchedFrom = match[1];
        if (existingLower.includes(switchedFrom)) {
          log.debug('Supersession candidate found (switch pattern)', {
            existingId: existing.id,
            pattern: pattern.toString(),
            switchedFrom,
          });
          return existing;
        }
      }
    }

    // High overlap + different conclusion signals
    if (overlap >= 0.7 && hasOppositeSignal(newLower, existingLower)) {
      log.debug('Supersession candidate found (opposite signal)', {
        existingId: existing.id,
        overlap,
      });
      return existing;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Temporal summary for sun context
// ---------------------------------------------------------------------------

/**
 * Build a concise textual summary of temporal state for the sun resource.
 *
 * Includes:
 *   - Count of active vs superseded memories
 *   - Recent supersession events (last 5)
 */
export function getTemporalSummary(project: string): string {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Active: not deleted, valid_from ≤ now, valid_until IS NULL or > now
  const activeRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_until IS NULL OR valid_until > ?)
  `).get(project, now, now) as { count: number };

  // Superseded: has superseded_by set
  const supersededRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND deleted_at IS NULL AND superseded_by IS NOT NULL
  `).get(project) as { count: number };

  // Recent supersessions
  const recentRows = db.prepare(`
    SELECT id, summary, superseded_by, updated_at FROM memories
    WHERE project = ?
      AND deleted_at IS NULL
      AND superseded_by IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 5
  `).all(project) as Array<{
    id: string;
    summary: string;
    superseded_by: string;
    updated_at: string;
  }>;

  const lines: string[] = [
    `Temporal: ${activeRow.count} active, ${supersededRow.count} superseded`,
  ];

  if (recentRows.length > 0) {
    lines.push('Recent supersessions:');
    for (const row of recentRows) {
      const date = row.updated_at.slice(0, 10);
      lines.push(`  [${date}] "${row.summary}" → superseded by ${row.superseded_by.slice(0, 8)}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract meaningful key terms from lowercased text.
 * Filters out common stop words and short tokens.
 */
export function extractKeyTerms(text: string): Set<string> {
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'this', 'that', 'these', 'those', 'i', 'we', 'our', 'it', 'its',
    'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then', 'than', 'also',
  ]);

  const terms = new Set<string>();
  const tokens = text.match(/[a-z0-9_\-\.]+/g) ?? [];
  for (const token of tokens) {
    if (token.length >= 3 && !STOP_WORDS.has(token)) {
      terms.add(token);
    }
  }
  return terms;
}

/**
 * Compute Jaccard-like overlap between two term sets.
 * Returns a value in [0, 1].
 */
function termOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) {
    if (b.has(term)) shared++;
  }
  const union = new Set([...a, ...b]).size;
  return shared / union;
}

/**
 * Check if the two texts contain opposing action signals around shared terms.
 * E.g., "use X" in old vs "not use X" or "avoid X" in new.
 */
function hasOppositeSignal(newText: string, existingText: string): boolean {
  const NEGATION_PREFIXES = ['not ', "don't ", 'avoid ', 'remove ', 'disable ', 'stop using '];
  const ACTION_VERBS = ['use', 'enable', 'add', 'adopt', 'choose', 'select', 'implement'];

  for (const verb of ACTION_VERBS) {
    const existingHasVerb = existingText.includes(verb);
    if (!existingHasVerb) continue;

    const newNegatesVerb = NEGATION_PREFIXES.some(neg => newText.includes(neg + verb));
    if (newNegatesVerb) return true;
  }

  return false;
}
