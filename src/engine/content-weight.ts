/**
 * content-weight.ts — Content-Based Value Evaluation
 *
 * Produces a multiplier in [0, 1] that reflects how *valuable* a memory's
 * content is, independent of how recent or frequently accessed it is.
 *
 * Two signals are combined:
 *   - scope_multiplier  : how broad / well-connected the memory is
 *   - reversibility_bonus: penalty/bonus based on how hard the decision is to undo
 *
 * The final value is clamped to [0, 1].
 */

import type { MemoryType } from './types.js';
import { IMPACT_DEFAULTS } from './types.js';
import { getEdgeCountForMemory } from '../storage/queries.js';

// ---------------------------------------------------------------------------
// Reversibility keyword lists
// ---------------------------------------------------------------------------

const HIGH_COST_KEYWORDS = [
  'migration', 'architecture', 'database', 'schema', 'breaking',
  'infrastructure', 'security', 'authentication',
  '마이그레이션', '아키텍처', '스키마', '데이터베이스', '인프라', '보안', '인증',
];

const LOW_COST_KEYWORDS = [
  'rename', 'style', 'format', 'lint', 'typo', 'comment',
  '이름변경', '포맷', '스타일', '오타', '주석',
];

// ---------------------------------------------------------------------------
// Named entity extraction (reuse same heuristics as quality.ts)
// ---------------------------------------------------------------------------

function extractEntities(text: string): string[] {
  const found: string[] = [];

  const camelPascal = text.match(/\b[A-Z][a-zA-Z0-9]{2,}\b|\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b/g);
  if (camelPascal) found.push(...camelPascal);

  const kebabSnake = text.match(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+){1,}\b/g);
  if (kebabSnake) found.push(...kebabSnake.filter(t => t.length > 4));

  const versions = text.match(/\bv?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?\b|\^?\d+\.\d+|\~\d+\.\d+/gi);
  if (versions) found.push(...versions);

  const paths = text.match(/(?:\/[\w.\-]+){2,}|(?:\.\/)[\w.\-/]+|[A-Za-z]:\\[\w.\\\-]+/g);
  if (paths) found.push(...paths);

  const urls = text.match(/https?:\/\/[^\s)>"']+/g);
  if (urls) found.push(...urls);

  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Scope multiplier — how broad / well-connected is this memory?
// ---------------------------------------------------------------------------

function calculateScope(content: string, memoryId?: string): number {
  const entityCount = extractEntities(content).length;

  let referenceCount = 0;
  if (memoryId) {
    referenceCount = getEdgeCountForMemory(memoryId);
  }

  const contentLengthFactor = Math.min(1.0, content.length / 300);

  const scopeRaw =
    0.4 * Math.min(1, entityCount / 5) +
    0.3 * Math.min(1, referenceCount / 3) +
    0.3 * contentLengthFactor;

  // Range: [0.7, 1.3]
  return 0.7 + 0.6 * scopeRaw;
}

// ---------------------------------------------------------------------------
// Reversibility bonus — how costly is this change to undo?
// ---------------------------------------------------------------------------

function calculateReversibility(content: string): number {
  const lower = content.toLowerCase();
  if (HIGH_COST_KEYWORDS.some(kw => lower.includes(kw))) return 0.15;
  if (LOW_COST_KEYWORDS.some(kw => lower.includes(kw))) return -0.10;
  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate a content-based weight for a memory.
 *
 * Returns a value in [0, 1].
 *
 * @param content   - Memory content text
 * @param type      - MemoryType (decision, observation, etc.)
 * @param memoryId  - Optional: used to look up constellation edge count
 */
export function calculateContentWeight(
  content: string,
  type: MemoryType,
  memoryId?: string,
): number {
  const typeBase = IMPACT_DEFAULTS[type];
  const scopeMultiplier = calculateScope(content, memoryId);
  const reversibilityBonus = calculateReversibility(content);

  return Math.max(0, Math.min(1, typeBase * scopeMultiplier + reversibilityBonus));
}
