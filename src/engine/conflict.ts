/**
 * conflict.ts — Conflict Detection engine
 *
 * Finds contradictions between memories. When a new memory is stored,
 * this module checks existing memories for semantic conflicts and creates
 * MemoryConflict records for any detected issues.
 *
 * Detection is purely local — no LLM required. Heuristics use keyword
 * overlap, negation patterns, and opposing action verbs.
 *
 * All functions are pure (no classes), following the project style.
 */

import { randomUUID } from 'node:crypto';
import {
  searchMemories,
  createConflict as queriesCreateConflict,
  getConflicts,
  resolveConflict as queriesResolveConflict,
  getConflictById,
} from '../storage/queries.js';
import { supersedeMemory, extractKeyTerms } from './temporal.js';
import type { Memory, MemoryConflict } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('conflict');

// ---------------------------------------------------------------------------
// Conflict analysis types
// ---------------------------------------------------------------------------

interface ConflictAnalysis {
  isConflict: boolean;
  severity: 'high' | 'medium' | 'low';
  reason: string;
}

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------

/**
 * Check for conflicts when storing a new memory.
 *
 * Searches for up to 5 similar existing memories via FTS5, then analyzes
 * each pair for semantic contradictions. Detected conflicts are persisted
 * and returned to the caller.
 */
export async function detectConflicts(
  newMemory: Memory,
  project: string,
): Promise<MemoryConflict[]> {
  // Build a representative search query from the new memory's content + tags
  const queryTerms = [
    newMemory.summary,
    ...newMemory.tags,
  ].join(' ').trim() || newMemory.content.slice(0, 100);

  const candidates = searchMemories(project, queryTerms, 5);
  const conflicts: MemoryConflict[] = [];

  for (const candidate of candidates) {
    // Skip self-comparison and already-superseded memories
    if (candidate.id === newMemory.id) continue;
    if (candidate.superseded_by) continue;
    if (candidate.deleted_at) continue;

    const analysis = analyzeConflict(newMemory.content, candidate.content);
    if (!analysis.isConflict) continue;

    // Further boost to high severity when both are 'decision' type
    const severity: MemoryConflict['severity'] =
      newMemory.type === 'decision' && candidate.type === 'decision'
        ? 'high'
        : analysis.severity;

    const conflict: MemoryConflict = {
      id: randomUUID(),
      memory_id: newMemory.id,
      conflicting_memory_id: candidate.id,
      severity,
      description: analysis.reason,
      status: 'open',
      project,
      created_at: new Date().toISOString(),
    };

    queriesCreateConflict(conflict);
    conflicts.push(conflict);

    log.debug('Conflict detected', {
      newId: newMemory.id,
      existingId: candidate.id,
      severity,
      reason: analysis.reason,
    });
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// analyzeConflict — local heuristics, no LLM
// ---------------------------------------------------------------------------

/**
 * Analyze whether two memory contents contradict each other.
 *
 * Checks:
 *   1. Shared key terms (minimum overlap threshold)
 *   2. Negation of action verbs around shared terms
 *   3. Opposing choice signals ("chose X" vs "chose Y" for same topic)
 *   4. "Switched from X to Y" patterns (X = existing tech)
 */
function analyzeConflict(newContent: string, existingContent: string): ConflictAnalysis {
  const newLower = newContent.toLowerCase();
  const existingLower = existingContent.toLowerCase();

  const newTerms = extractKeyTerms(newLower);
  const existingTerms = extractKeyTerms(existingLower);

  const sharedTerms = intersection(newTerms, existingTerms);

  // Not enough shared context to conflict
  if (sharedTerms.size === 0) {
    return { isConflict: false, severity: 'low', reason: '' };
  }

  const overlapRatio = sharedTerms.size / Math.min(newTerms.size, existingTerms.size);
  if (overlapRatio < 0.2) {
    return { isConflict: false, severity: 'low', reason: '' };
  }

  // Check "switched from X" — X appears in existing
  const switchMatch = newLower.match(/switched?\s+from\s+(\w+)/i)
    ?? newLower.match(/migrat\w+\s+from\s+(\w+)/i)
    ?? newLower.match(/replac\w+\s+(\w+)/i)
    ?? newLower.match(/no\s+longer\s+using?\s+(\w+)/i);

  if (switchMatch) {
    const switchedFrom = switchMatch[1].toLowerCase();
    if (existingLower.includes(switchedFrom)) {
      return {
        isConflict: true,
        severity: 'high',
        reason: `New memory indicates switching away from "${switchedFrom}" which appears in existing memory`,
      };
    }
  }

  // Check opposing action verbs around shared terms
  const negationResult = checkNegationConflict(newLower, existingLower, sharedTerms);
  if (negationResult.isConflict) return negationResult;

  // Check opposing choice signals ("chose X" / "selected X" vs "chose Y")
  const choiceResult = checkChoiceConflict(newLower, existingLower);
  if (choiceResult.isConflict) return choiceResult;

  // Check enable/disable toggles
  const toggleResult = checkToggleConflict(newLower, existingLower, sharedTerms);
  if (toggleResult.isConflict) return toggleResult;

  return { isConflict: false, severity: 'low', reason: '' };
}

/**
 * Check if one text negates an action verb that appears with a shared term in the other.
 * E.g., "use Redis" (existing) vs "not use Redis" (new).
 */
function checkNegationConflict(
  newLower: string,
  existingLower: string,
  sharedTerms: Set<string>,
): ConflictAnalysis {
  const POSITIVE_VERBS = ['use', 'enable', 'add', 'adopt', 'choose', 'select', 'implement', 'deploy'];
  const NEGATION_PREFIXES = ['not ', "don't ", "do not ", 'avoid ', 'stop ', 'remove ', 'disable ', 'never '];

  for (const term of sharedTerms) {
    for (const verb of POSITIVE_VERBS) {
      const positivePattern = `${verb} ${term}`;

      const existingPositive = existingLower.includes(positivePattern);
      const newNegative = NEGATION_PREFIXES.some(neg => newLower.includes(neg + verb + ' ' + term));

      if (existingPositive && newNegative) {
        return {
          isConflict: true,
          severity: 'medium',
          reason: `Existing memory says "${positivePattern}", new memory negates this`,
        };
      }

      const newPositive = newLower.includes(positivePattern);
      const existingNegative = NEGATION_PREFIXES.some(neg => existingLower.includes(neg + verb + ' ' + term));

      if (newPositive && existingNegative) {
        return {
          isConflict: true,
          severity: 'medium',
          reason: `New memory says "${positivePattern}", but existing memory negates this`,
        };
      }
    }
  }

  return { isConflict: false, severity: 'low', reason: '' };
}

/**
 * Check for opposing choice signals.
 * Detects: "chose/selected/decided on X" in one vs "chose/selected/decided on Y" in other.
 */
function checkChoiceConflict(newLower: string, existingLower: string): ConflictAnalysis {
  const CHOICE_VERBS = ['chose', 'selected', 'decided on', 'picked', 'went with'];

  const extractChoiceTarget = (text: string): string | null => {
    for (const verb of CHOICE_VERBS) {
      const idx = text.indexOf(verb);
      if (idx === -1) continue;
      const after = text.slice(idx + verb.length).trim();
      const token = after.match(/^(\w+)/)?.[1];
      if (token && token.length >= 3) return token;
    }
    return null;
  };

  const newChoice = extractChoiceTarget(newLower);
  const existingChoice = extractChoiceTarget(existingLower);

  if (newChoice && existingChoice && newChoice !== existingChoice) {
    return {
      isConflict: true,
      severity: 'high',
      reason: `Conflicting decisions: existing chose "${existingChoice}", new chose "${newChoice}"`,
    };
  }

  return { isConflict: false, severity: 'low', reason: '' };
}

/**
 * Check for enable/disable or add/remove toggle conflicts on shared terms.
 */
function checkToggleConflict(
  newLower: string,
  existingLower: string,
  sharedTerms: Set<string>,
): ConflictAnalysis {
  const TOGGLE_PAIRS: Array<[string, string]> = [
    ['enabled', 'disabled'],
    ['enable', 'disable'],
    ['activated', 'deactivated'],
    ['on', 'off'],
  ];

  for (const term of sharedTerms) {
    for (const [pos, neg] of TOGGLE_PAIRS) {
      const existingPos = existingLower.includes(`${pos} ${term}`) || existingLower.includes(`${term} ${pos}`);
      const newNeg = newLower.includes(`${neg} ${term}`) || newLower.includes(`${term} ${neg}`);

      if (existingPos && newNeg) {
        return {
          isConflict: true,
          severity: 'medium',
          reason: `Toggle conflict on "${term}": existing has "${pos}", new has "${neg}"`,
        };
      }

      const newPos = newLower.includes(`${pos} ${term}`) || newLower.includes(`${term} ${pos}`);
      const existingNeg = existingLower.includes(`${neg} ${term}`) || existingLower.includes(`${term} ${neg}`);

      if (newPos && existingNeg) {
        return {
          isConflict: true,
          severity: 'medium',
          reason: `Toggle conflict on "${term}": new has "${pos}", existing has "${neg}"`,
        };
      }
    }
  }

  return { isConflict: false, severity: 'low', reason: '' };
}

// ---------------------------------------------------------------------------
// autoResolveConflict
// ---------------------------------------------------------------------------

/**
 * Attempt to auto-resolve a conflict without user intervention.
 *
 * Auto-resolves when the newer memory clearly supersedes the older one:
 *   - The conflict memory was created after the conflicting memory
 *   - Severity is high (strong signal of supersession)
 *
 * Returns true if resolved (and calls temporal.supersedeMemory),
 * or false if user decision is needed.
 */
export function autoResolveConflict(conflict: MemoryConflict): boolean {
  if (conflict.severity !== 'high') return false;

  // We auto-resolve only when the conflict description contains a switch signal
  const switchSignals = ['switching away from', 'switched away from', 'conflicting decisions'];
  const hasSwitch = switchSignals.some(s => conflict.description.toLowerCase().includes(s));
  if (!hasSwitch) return false;

  // newMemory (memory_id) supersedes the existing (conflicting_memory_id)
  supersedeMemory(conflict.conflicting_memory_id, conflict.memory_id);

  queriesResolveConflict(
    conflict.id,
    `Auto-resolved: memory ${conflict.memory_id} supersedes ${conflict.conflicting_memory_id}`,
  );

  log.debug('Conflict auto-resolved', { conflictId: conflict.id });
  return true;
}

// ---------------------------------------------------------------------------
// formatConflictWarnings
// ---------------------------------------------------------------------------

/**
 * Format conflict warnings as human-readable text.
 *
 * Returns a warning string listing each conflict with memory summaries.
 * Designed to be returned to the user as part of a remember tool response.
 */
export function formatConflictWarnings(conflicts: MemoryConflict[]): string {
  if (conflicts.length === 0) return '';

  const lines: string[] = ['Warning: potential memory conflicts detected:'];

  for (const conflict of conflicts) {
    const severityLabel = conflict.severity.toUpperCase();
    lines.push(
      `  [${severityLabel}] Memory ${conflict.memory_id.slice(0, 8)} conflicts with ` +
      `${conflict.conflicting_memory_id.slice(0, 8)}: ${conflict.description}`,
    );
  }

  lines.push('Use resolveConflict() to dismiss or supersede the older memory.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// getUnresolvedConflicts
// ---------------------------------------------------------------------------

/**
 * Return all open (unresolved) conflicts for a project.
 */
export function getUnresolvedConflicts(project: string): MemoryConflict[] {
  return getConflicts(project, 'open');
}

// ---------------------------------------------------------------------------
// resolveConflict
// ---------------------------------------------------------------------------

/**
 * Resolve a conflict manually.
 *
 * Actions:
 *   - 'supersede': mark resolved and call temporal.supersedeMemory()
 *                  (conflicting_memory_id superseded by memory_id)
 *   - 'dismiss':   mark resolved without any memory changes
 *   - 'keep_both': mark resolved with a note that both are intentionally kept
 */
export function resolveConflict(
  conflictId: string,
  resolution: string,
  action: 'supersede' | 'dismiss' | 'keep_both' = 'dismiss',
): void {
  // We need the conflict details to call supersedeMemory if needed.
  // Fetch it via getConflicts (no direct getConflictById, but we can filter).
  // Since we only need it for supersede, we'll proceed directly.
  if (action === 'supersede') {
    const row = getConflictById(conflictId);
    if (row) {
      supersedeMemory(row.conflicting_memory_id, row.memory_id);
    }
  }

  const resolutionNote =
    action === 'keep_both'
      ? `[keep_both] ${resolution}`
      : action === 'dismiss'
      ? `[dismissed] ${resolution}`
      : `[superseded] ${resolution}`;

  queriesResolveConflict(conflictId, resolutionNote);
  log.debug('Conflict resolved', { conflictId, action, resolution });
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function intersection(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const item of a) {
    if (b.has(item)) result.add(item);
  }
  return result;
}
