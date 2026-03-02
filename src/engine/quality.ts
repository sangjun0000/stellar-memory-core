/**
 * quality.ts — Memory Quality Scoring ("Planet Grading")
 *
 * Grades each memory on four dimensions:
 *
 *   - SPECIFICITY   : How much concrete detail does the content contain?
 *   - ACTIONABILITY : Can someone act on this? Does it say *how*?
 *   - UNIQUENESS    : Is this information available in other memories?
 *   - FRESHNESS     : How recently was this memory verified / accessed?
 *
 * The overall score is a weighted average. Low-quality memories are pushed
 * farther from the sun via qualityOrbitAdjustment().
 *
 * All scoring is purely algorithmic — no LLM calls.
 */

import type { Memory, QualityScore } from './types.js';
import { getMemoriesByProject, updateQualityScore } from '../storage/queries.js';

// ---------------------------------------------------------------------------
// Named-entity extraction
// ---------------------------------------------------------------------------

/**
 * Extract named entities and technical identifiers from a block of text.
 *
 * Looks for:
 *   - PascalCase / camelCase identifiers
 *   - kebab-case and snake_case identifiers (length > 4)
 *   - Semver / version numbers  (v1.2.3, ^2.0, ~3)
 *   - File paths  (/foo/bar, ./src/index.ts, C:\...)
 *   - URLs  (http://, https://)
 */
function extractNamedEntities(text: string): string[] {
  const found: string[] = [];

  // PascalCase / camelCase
  const camelPascal = text.match(/\b[A-Z][a-zA-Z0-9]{2,}\b|\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b/g);
  if (camelPascal) found.push(...camelPascal);

  // kebab-case and snake_case (require at least one separator and 2+ segments)
  const kebabSnake = text.match(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+){1,}\b/g);
  if (kebabSnake) found.push(...kebabSnake.filter(t => t.length > 4));

  // Version numbers
  const versions = text.match(/\bv?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?\b|\^?\d+\.\d+|\~\d+\.\d+/gi);
  if (versions) found.push(...versions);

  // File paths (Unix, Windows, relative)
  const paths = text.match(/(?:\/[\w.\-]+){2,}|(?:\.\/)[\w.\-/]+|[A-Za-z]:\\[\w.\\\-]+/g);
  if (paths) found.push(...paths);

  // URLs
  const urls = text.match(/https?:\/\/[^\s)>"']+/g);
  if (urls) found.push(...urls);

  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Specificity
// ---------------------------------------------------------------------------

function scoreSpecificity(memory: Memory): number {
  const text = memory.content + ' ' + memory.summary;

  const namedEntities = extractNamedEntities(text);
  const hasNumbers = /\b\d+(?:\.\d+)?\b/.test(text);
  const hasPaths = /(?:\/[\w.\-]+){2,}|(?:\.\/)[\w.\-/]+|[A-Za-z]:\\[\w.\\\-]+/.test(text);
  const contentLength = memory.content.length;

  return Math.min(
    1.0,
    namedEntities.length * 0.1 +
      (hasNumbers ? 0.2 : 0) +
      (hasPaths ? 0.2 : 0) +
      Math.min(0.3, contentLength / 500),
  );
}

// ---------------------------------------------------------------------------
// Actionability
// ---------------------------------------------------------------------------

const ACTION_VERBS_EN = [
  'use', 'run', 'install', 'configure', 'fix', 'add', 'remove', 'update',
  'set', 'enable', 'disable', 'check', 'ensure', 'avoid', 'always', 'never',
  'prefer', 'call', 'import', 'export', 'create', 'delete', 'replace',
];

const ACTION_VERBS_KO = [
  '사용', '실행', '설치', '수정', '추가', '삭제', '확인', '설정', '적용',
  '피해야', '항상', '절대', '선호', '호출', '가져오기', '내보내기',
];

const INSTRUCTION_PATTERNS = [
  /\bstep \d+\b/i,
  /\b\d+\.\s+[A-Z]/,              // numbered list "1. Do something"
  /\bfirst\b.{0,30}\bthen\b/i,
  /\bmake sure\b/i,
  /\bdon['']t\b/i,
  /\b하면\s/,                      // Korean conditional
  /\b다음\s+단계\b/,               // Korean "next step"
];

const CONDITIONAL_PATTERNS = [
  /\bif\b.{1,60}\bthen\b/i,
  /\bwhen\b.{1,60},\s/i,
  /\bunless\b/i,
  /\botherwise\b/i,
  /\b이면\b/,                      // Korean conditional
  /\b경우에\b/,
];

function scoreActionability(memory: Memory): number {
  const text = memory.content.toLowerCase();

  const hasActionVerbEn = ACTION_VERBS_EN.some(v => text.includes(v));
  const hasActionVerbKo = ACTION_VERBS_KO.some(v => memory.content.includes(v));
  const hasActionVerb = hasActionVerbEn || hasActionVerbKo;

  const hasInstruction = INSTRUCTION_PATTERNS.some(p => p.test(memory.content));
  const hasConditional = CONDITIONAL_PATTERNS.some(p => p.test(memory.content));

  return (
    (hasActionVerb ? 0.4 : 0) +
    (hasInstruction ? 0.3 : 0) +
    (hasConditional ? 0.3 : 0)
  );
}

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------

/**
 * Estimate similarity between two memories using tag overlap and
 * summary keyword overlap as a lightweight proxy.
 *
 * Returns a value in [0, 1] where 1.0 = identical.
 */
function estimateSimilarity(a: Memory, b: Memory): number {
  const tagsA = new Set(Array.isArray(a.tags) ? a.tags : []);
  const tagsB = new Set(Array.isArray(b.tags) ? b.tags : []);

  const tagIntersection = [...tagsA].filter(t => tagsB.has(t)).length;
  const tagUnion = new Set([...tagsA, ...tagsB]).size;
  const tagOverlap = tagUnion > 0 ? tagIntersection / tagUnion : 0;

  // Summary keyword overlap
  const wordsA = new Set(
    a.summary.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  );
  const wordsB = new Set(
    b.summary.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  );
  const wordIntersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const wordUnion = new Set([...wordsA, ...wordsB]).size;
  const wordOverlap = wordUnion > 0 ? wordIntersection / wordUnion : 0;

  // Weighted combination: tags carry more signal than summary keywords
  return tagOverlap * 0.6 + wordOverlap * 0.4;
}

function scoreUniqueness(memory: Memory, allMemories?: Memory[]): number {
  if (!allMemories || allMemories.length === 0) return 0.5;

  const others = allMemories.filter(m => m.id !== memory.id);
  if (others.length === 0) return 1.0;

  const maxSimilarity = Math.max(...others.map(o => estimateSimilarity(memory, o)));
  return Math.max(0.0, 1.0 - maxSimilarity);
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

function scoreFreshness(memory: Memory): number {
  const ref = memory.last_accessed_at ?? memory.created_at;
  if (!ref) return 0.1;

  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(ref) ? ref : ref + 'Z';
  const refMs = new Date(normalized).getTime();
  if (isNaN(refMs)) return 0.1;

  const hoursSince = (Date.now() - refMs) / (1000 * 60 * 60);

  if (hoursSince <= 24)   return 1.0;
  if (hoursSince <= 168)  return 0.7;  // 1 week
  if (hoursSince <= 720)  return 0.4;  // 1 month
  return 0.2;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate the quality score for a single memory.
 *
 * If allMemories is provided, uniqueness is computed against those peers.
 * Without it, uniqueness defaults to 0.5 (neutral).
 */
export function calculateQuality(
  memory: Memory,
  allMemories?: Memory[],
): QualityScore {
  const specificity   = scoreSpecificity(memory);
  const actionability = scoreActionability(memory);
  const uniqueness    = scoreUniqueness(memory, allMemories);
  const freshness     = scoreFreshness(memory);

  const overall =
    0.30 * specificity +
    0.25 * actionability +
    0.25 * uniqueness +
    0.20 * freshness;

  return {
    overall:     Math.min(1.0, Math.max(0.0, overall)),
    specificity: Math.min(1.0, Math.max(0.0, specificity)),
    actionability: Math.min(1.0, Math.max(0.0, actionability)),
    uniqueness:  Math.min(1.0, Math.max(0.0, uniqueness)),
    freshness:   Math.min(1.0, Math.max(0.0, freshness)),
  };
}

/**
 * Score every non-deleted memory in a project and persist the results.
 * Returns aggregate stats.
 */
export function scoreAllMemories(
  project: string,
): { scored: number; avgQuality: number } {
  const memories = getMemoriesByProject(project);
  if (memories.length === 0) return { scored: 0, avgQuality: 0 };

  let totalQuality = 0;

  for (const memory of memories) {
    const score = calculateQuality(memory, memories);
    updateQualityScore(memory.id, score.overall);
    totalQuality += score.overall;
  }

  return {
    scored: memories.length,
    avgQuality: totalQuality / memories.length,
  };
}

/**
 * Generate feedback tips for a newly stored memory.
 *
 * Returns null when the memory is already high quality (overall >= 0.7).
 * Otherwise returns up to 2 actionable tips (in Korean, matching project locale).
 */
export function getQualityFeedback(quality: QualityScore): string | null {
  if (quality.overall >= 0.7) return null;

  const tips: string[] = [];

  if (quality.specificity < 0.3) {
    tips.push(
      '이 기억을 더 구체적으로 작성하면 좋겠습니다. 구체적인 이름, 버전, 경로 등을 포함해주세요.',
    );
  }

  if (quality.actionability < 0.3) {
    tips.push(
      '어떻게 행동해야 하는지 구체적인 단계를 포함하면 더 유용합니다.',
    );
  }

  if (quality.uniqueness < 0.3) {
    tips.push(
      '유사한 기억이 이미 존재합니다. 기존 기억을 업데이트하는 것을 고려해주세요.',
    );
  }

  if (tips.length === 0) return null;

  // Return at most 2 tips
  return tips.slice(0, 2).join(' ');
}

/**
 * Return a distance multiplier based on quality.
 *
 * Low-quality memories drift outward to make room for high-quality ones.
 *   - quality >= 0.7 : 1.0  (no adjustment)
 *   - quality 0.4–0.7: 1.2  (slightly further)
 *   - quality < 0.4  : 1.5  (noticeably further)
 */
export function qualityOrbitAdjustment(quality: number): number {
  if (quality >= 0.7) return 1.0;
  if (quality >= 0.4) return 1.2;
  return 1.5;
}
