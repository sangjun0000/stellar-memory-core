/**
 * procedural.ts — Procedural Memory ("Navigation Rules")
 *
 * Procedural memories are behavioral rules learned from patterns in other
 * memories. They represent "how we do things here" — conventions, workflows,
 * and recurring solutions extracted from observed repetition.
 *
 * Key behaviors:
 *   - Pattern detection: group memories by tags, find groups with 3+ members
 *   - Rule creation: procedural memories start with high impact (0.9)
 *   - Slow decay: procedural memories decay at 30% of the normal rate
 *   - Sun integration: top 5 rules appear in a dedicated section
 */

import { randomUUID, createHash } from 'node:crypto';
import type { Memory, MemoryType } from './types.js';
import { getMemoriesByProject, insertMemory } from '../storage/queries.js';
import { getConfig } from '../utils/config.js';
import { STOP_WORDS } from '../utils/stopwords.js';
import { INTRINSIC_DEFAULTS } from './types.js';
import { importanceToDistance } from './orbit.js';

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

/**
 * Group memories by individual tag. Only groups with 3+ memories are kept —
 * anything below that threshold is not a stable enough pattern to act on.
 */
function findRepeatedPatterns(memories: Memory[]): Map<string, Memory[]> {
  const tagGroups = new Map<string, Memory[]>();

  for (const memory of memories) {
    const tags = Array.isArray(memory.tags) ? memory.tags : [];
    for (const tag of tags) {
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push(memory);
    }
  }

  // Only keep groups with 3+ memories
  return new Map([...tagGroups].filter(([, mems]) => mems.length >= 3));
}

/**
 * Extract the most representative keywords from a group of memories.
 * Uses the most common non-trivial words across all content.
 */
function extractGroupKeywords(memories: Memory[]): string[] {
  const wordCount = new Map<string, number>();
  for (const mem of memories) {
    const words = (mem.content + ' ' + mem.summary)
      .toLowerCase()
      .split(/[\s,.\-:;()\[\]{}'"!?/\\]+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    for (const w of words) {
      wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
    }
  }

  return [...wordCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

/**
 * Determine if a tag group shares a consistent memory type (majority rules).
 */
function dominantType(memories: Memory[]): MemoryType | null {
  const typeCounts = new Map<MemoryType, number>();
  for (const m of memories) {
    typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1);
  }
  const dominant = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return null;
  // Return the dominant type only if it represents at least 60% of the group
  return dominant[1] / memories.length >= 0.6 ? dominant[0] : null;
}

/**
 * Detect patterns in the memory corpus that are strong enough to warrant
 * a procedural rule.
 *
 * Returns one candidate per tag-group that has 3+ members, describing the
 * observed pattern and suggesting a concrete rule.
 */
export function detectProceduralPattern(
  memories: Memory[],
  project: string,
): Array<{ pattern: string; frequency: number; suggestedRule: string }> {
  const groups = findRepeatedPatterns(memories);
  const results: Array<{ pattern: string; frequency: number; suggestedRule: string }> = [];

  for (const [tag, groupMemories] of groups) {
    const keywords = extractGroupKeywords(groupMemories);
    const type = dominantType(groupMemories);
    const frequency = groupMemories.length;

    let pattern: string;
    let suggestedRule: string;

    if (type === 'error') {
      pattern = `Repeated error pattern tagged "${tag}" (${frequency} occurrences)`;
      suggestedRule = keywords.length > 0
        ? `When encountering ${tag}-related issues: check ${keywords.slice(0, 3).join(', ')}`
        : `When encountering ${tag}-related issues: review established fix pattern`;
    } else if (type === 'decision') {
      pattern = `Recurring decision pattern tagged "${tag}" (${frequency} occurrences)`;
      suggestedRule = keywords.length > 0
        ? `For ${tag} decisions: consistently apply ${keywords.slice(0, 3).join(', ')}`
        : `For ${tag} decisions: follow established decision criteria`;
    } else {
      pattern = `Repeated context tagged "${tag}" across ${frequency} memories`;
      suggestedRule = keywords.length > 0
        ? `In ${project}: ${tag} work consistently involves ${keywords.slice(0, 3).join(', ')}`
        : `In ${project}: ${tag} is a key recurring theme`;
    }

    results.push({ pattern, frequency, suggestedRule });
  }

  // Sort by frequency descending — strongest patterns first
  return results.sort((a, b) => b.frequency - a.frequency);
}

// ---------------------------------------------------------------------------
// Procedural memory creation
// ---------------------------------------------------------------------------

/**
 * Create a procedural memory from a learned rule and its supporting evidence.
 *
 * Procedural memories:
 *   - Use type 'procedural'
 *   - Start with high impact (0.9) so they orbit close to the sun
 *   - Include both the rule and the evidence that generated it
 *   - Are tagged with 'procedural' plus terms extracted from the rule
 */
export function createProceduralMemory(
  rule: string,
  evidence: string[],
  project: string,
): Memory {
  const config = getConfig();
  const impact = 0.9;

  const content = `Rule: ${rule}\nEvidence: ${evidence.join(', ')}`;
  const summary = rule.length > 80 ? rule.slice(0, 80).trimEnd() + '…' : rule;

  // Extract meaningful terms from the rule text for tags
  const ruleWords = rule
    .toLowerCase()
    .split(/[\s,.:;()\-]+/)
    .filter(w => w.length > 3);
  const tags = ['procedural', ...new Set(ruleWords.slice(0, 4))];

  // Compute initial importance using 3-factor formula (Phase 1).
  // R=1.0 (brand new), F=0.0 (never recalled), I=impact (explicit override).
  const now = new Date().toISOString();
  const wR = config.weightRecency   ?? 0.35;
  const wF = config.weightFrequency ?? 0.25;
  const wI = config.weightIntrinsic ?? 0.40;
  const I  = impact ?? INTRINSIC_DEFAULTS['procedural'];

  const total = Math.min(1.0, wR * 1.0 + wF * 0.0 + wI * I);

  const distance = importanceToDistance(total);
  const contentHash = createHash('sha256').update(content).digest('hex');

  return insertMemory({
    id: randomUUID(),
    project,
    content,
    summary,
    type: 'procedural' as MemoryType,
    tags,
    distance,
    importance: total,
    velocity: 0,
    impact,
    access_count: 0,
    last_accessed_at: null,
    metadata: { evidence_count: evidence.length },
    content_hash: contentHash,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Get all procedural memories for a project, sorted by importance descending.
 * These feed into the sun content formatter and the suggest logic.
 */
export function getProceduralMemories(project: string): Memory[] {
  const all = getMemoriesByProject(project);
  return all
    .filter(m => m.type === 'procedural')
    .sort((a, b) => b.importance - a.importance);
}

// ---------------------------------------------------------------------------
// Sun content formatting
// ---------------------------------------------------------------------------

/**
 * Format procedural memories as a concise "Navigation Rules" section
 * suitable for inclusion in the sun resource content.
 *
 * At most 5 rules are shown (most important first). Each rule is rendered
 * as a single numbered line extracted from the content (the "Rule: ..." part).
 */
export function formatProceduralSection(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const top = memories.slice(0, 5);

  const lines = top.map((m, i) => {
    // Extract just the rule line from "Rule: ...\nEvidence: ..."
    const match = m.content.match(/^Rule:\s*(.+?)(\n|$)/);
    const rule = match ? match[1].trim() : m.summary;
    return `  ${i + 1}. ${rule}`;
  });

  return `Navigation Rules:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Decay multiplier
// ---------------------------------------------------------------------------

/**
 * Procedural memories are hard-won knowledge and should be highly durable.
 * Return 0.3 so that the effective half-life is ~3.3x longer than normal.
 *
 * Used by orbit.ts when calculating recency score for procedural memories:
 *   effectiveHalfLife = baseHalfLife / getProceduralDecayMultiplier()
 */
export function getProceduralDecayMultiplier(): number {
  return 0.3;
}

