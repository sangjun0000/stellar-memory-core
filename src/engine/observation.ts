/**
 * observation.ts — Observational Memory ("Comet")
 *
 * Auto-extracts knowledge from raw conversation text and stores it as
 * structured memories. Like comets that bring material from the outer
 * solar system, observations bring new information from conversations
 * into the memory system.
 *
 * Pipeline:
 *   observe()           → extract pattern-matched memories from a chunk
 *   reflect()           → categorize observations (novel / reinforcing / conflicting)
 *   processConversation → full pipeline: split → observe → reflect → store
 *
 * No LLM is used — all extraction is done via keyword matching and heuristics.
 */

import { randomUUID } from 'node:crypto';
import type { Memory, MemoryType, ObservationEntry } from './types.js';
import { createMemory } from './planet.js';
import { recallMemoriesAsync } from './planet.js';
import { createObservation } from '../storage/queries.js';
import { updateMemoryOrbit, updateMemoryAccess } from '../storage/queries.js';
import { applyAccessBoost } from './orbit.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('observation');

// ---------------------------------------------------------------------------
// Keyword dictionaries
// ---------------------------------------------------------------------------

const DECISION_KEYWORDS = [
  'chose', 'decided', 'will use', 'switched to', 'selected', 'picked',
  'going with', 'we will', 'opted for', 'adopted', 'migrated to',
  '결정', '선택', '사용하기로', '변경', '채택',
];

const ERROR_KEYWORDS = [
  'error', 'bug', 'fix', 'fixed', 'failed', 'crash', 'issue', 'broken',
  'exception', 'traceback', 'undefined', 'null pointer', 'segfault',
  '에러', '버그', '수정', '실패', '오류', '문제',
];

const MILESTONE_KEYWORDS = [
  'complete', 'completed', 'done', 'finished', 'implemented', 'shipped',
  'deployed', 'released', 'merged', 'integrated', 'working', 'passing',
  '완료', '구현', '배포', '완성', '됐', '됩니다',
];

const TASK_KEYWORDS = [
  'todo', 'to-do', 'need to', 'should', 'must', 'later', 'next step',
  'will need', 'plan to', 'going to', 'upcoming', 'pending',
  '해야', '필요', '다음에', '나중에', '예정',
];

const CONTEXT_KEYWORDS = [
  'uses', 'requires', 'depends on', 'built with', 'runs on', 'configured',
  'connects to', 'integrates', 'relies on', 'powered by',
  '사용', '필요', '의존', '기반',
];

// ---------------------------------------------------------------------------
// Stop words — filtered out during key term extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as',
  'into', 'through', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
  'and', 'or', 'but', 'if', 'then', 'that', 'this', 'it', 'its',
  'i', 'we', 'you', 'he', 'she', 'they', 'them', 'their', 'our', 'my',
  'so', 'than', 'when', 'where', 'who', 'which', 'what', 'how', 'why',
  'not', 'no', 'all', 'each', 'both', 'few', 'more', 'other', 'some',
  'such', 'only', 'own', 'same', 'also', 'just', 'now', 'very', 'too',
  // Korean particles
  '은', '는', '이', '가', '을', '를', '의', '에', '에서', '로', '으로',
  '와', '과', '도', '만', '가', '께', '한테', '에게', '부터', '까지',
  '이다', '입니다', '있다', '없다', '이라', '이면', '라면', '같은',
]);

// ---------------------------------------------------------------------------
// Key term extraction
// ---------------------------------------------------------------------------

/**
 * Extract meaningful key terms from text.
 *
 * Filters out stop words and short tokens; keeps technical terms,
 * proper nouns (by capitalization), version numbers, and path-like strings.
 *
 * Returns unique terms sorted by appearance order.
 */
export function extractKeyTerms(text: string): string[] {
  const words = text
    .split(/\s+/)
    .map(w => w.replace(/[^\w.\-/]/g, '').trim())
    .filter(w => w.length >= 2);

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(word);
  }

  return terms;
}

// ---------------------------------------------------------------------------
// Keyword detection helpers
// ---------------------------------------------------------------------------

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * Detect the memory type for a given sentence based on keyword presence.
 * Returns null if no pattern matches.
 */
function detectType(sentence: string): MemoryType | null {
  if (containsAny(sentence, DECISION_KEYWORDS))  return 'decision';
  if (containsAny(sentence, ERROR_KEYWORDS))      return 'error';
  if (containsAny(sentence, MILESTONE_KEYWORDS))  return 'milestone';
  if (containsAny(sentence, TASK_KEYWORDS))       return 'task';
  if (containsAny(sentence, CONTEXT_KEYWORDS))    return 'context';
  return null;
}

// ---------------------------------------------------------------------------
// Conversation splitting
// ---------------------------------------------------------------------------

/**
 * Split a conversation into chunks suitable for observation.
 *
 * Splits on:
 *   - Common turn markers: "User:", "Assistant:", "Human:", "AI:", "System:"
 *   - Double newlines (paragraph breaks)
 *
 * Filters out empty or very short chunks.
 * Chunks are bounded to 100-500 words each.
 */
export function splitConversation(text: string): string[] {
  const TURN_PATTERN = /^(?:User|Assistant|Human|AI|System|사용자|어시스턴트):/im;

  // First try turn-based splitting
  const turnChunks = text
    .split(/\n(?=(?:User|Assistant|Human|AI|System|사용자|어시스턴트):)/i)
    .map(c => c.trim())
    .filter(c => c.length > 20);

  if (turnChunks.length > 1) {
    return turnChunks;
  }

  // Fallback: paragraph splitting
  return text
    .split(/\n{2,}/)
    .map(c => c.trim())
    .filter(c => {
      const wordCount = c.split(/\s+/).length;
      return wordCount >= 5 && wordCount <= 600;
    });
}

// ---------------------------------------------------------------------------
// Core observation
// ---------------------------------------------------------------------------

/**
 * Observe a conversation chunk and extract structured memories from it.
 *
 * For each sentence that matches a known pattern (decision, error, milestone,
 * task, context), a memory is created and stored.
 *
 * Returns the text observations extracted and the Memory objects created.
 */
export function observe(
  conversationChunk: string,
  project: string,
): { observations: string[]; memories: Memory[] } {
  // Split into sentences
  const sentences = conversationChunk
    .split(/(?<=[.!?])\s+|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 15); // skip very short fragments

  const observations: string[] = [];
  const memories: Memory[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    const type = detectType(sentence);
    if (!type) continue;

    // Normalize to avoid creating duplicate memories in the same chunk
    const normalized = sentence.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Generate summary (first 80 chars or the sentence itself if shorter)
    const summary = sentence.length > 80
      ? sentence.slice(0, 80).trimEnd() + '...'
      : sentence;

    // Extract tags from key technical terms
    const terms = extractKeyTerms(sentence);
    const tags  = terms.slice(0, 8); // cap at 8 tags

    try {
      const memory = createMemory({
        project,
        content: sentence,
        summary,
        type,
        tags,
      });

      observations.push(sentence);
      memories.push(memory);

      log.debug('Observed memory', {
        type,
        summary: summary.slice(0, 60),
      });
    } catch (err) {
      log.warn('Failed to create observed memory', { error: String(err) });
    }
  }

  // Log the observation entry even if no memories were created
  if (observations.length > 0) {
    const entry: ObservationEntry = {
      id:                 randomUUID(),
      content:            conversationChunk.slice(0, 500),
      extracted_memories: memories.map(m => m.id),
      source:             'conversation',
      project,
      created_at:         new Date().toISOString(),
    };

    try {
      createObservation(entry);
    } catch (err) {
      log.warn('Failed to log observation entry', { error: String(err) });
    }
  }

  return { observations, memories };
}

// ---------------------------------------------------------------------------
// Reflection
// ---------------------------------------------------------------------------

/**
 * Reflect on a list of observations against the existing memory store.
 *
 * Categorizes each observation string as:
 *   - novel       : not found in existing memories (truly new)
 *   - reinforcing : confirms an existing memory (we boost that memory)
 *   - conflicting : appears to contradict an existing memory
 *
 * Heuristics:
 *   - If an existing memory contains most of the same key terms → reinforcing
 *   - If an existing memory uses contradicting signals (negation patterns) → conflicting
 *   - Otherwise → novel
 */
export async function reflect(
  newObservations: string[],
  project: string,
): Promise<{
  novel: string[];
  reinforcing: string[];
  conflicting: string[];
}> {
  const novel: string[]       = [];
  const reinforcing: string[] = [];
  const conflicting: string[] = [];

  for (const obs of newObservations) {
    // Search existing memories for similar content
    const similar = await recallMemoriesAsync(project, obs, { limit: 3 });

    if (similar.length === 0) {
      novel.push(obs);
      continue;
    }

    // Check the top result for reinforcement vs conflict
    const top = similar[0];
    const topTerms = extractKeyTerms(top.content);
    const obsTerms = extractKeyTerms(obs);

    // Count shared key terms
    const topSet = new Set(topTerms.map(t => t.toLowerCase()));
    const sharedCount = obsTerms.filter(t => topSet.has(t.toLowerCase())).length;
    const overlapRatio = sharedCount / Math.max(1, obsTerms.length);

    if (overlapRatio >= 0.5) {
      // High overlap → reinforcing — boost the existing memory slightly
      const boostedDistance = applyAccessBoost(top.distance);
      try {
        updateMemoryAccess(top.id);
        updateMemoryOrbit(top.id, boostedDistance, top.importance, boostedDistance - top.distance);
      } catch (err) {
        log.warn('Failed to boost reinforced memory', { id: top.id, error: String(err) });
      }
      reinforcing.push(obs);
    } else {
      // Check for explicit contradiction signals
      const obsLower = obs.toLowerCase();
      const topLower = top.content.toLowerCase();
      const negationPatterns = [
        /\bnot\s+\w+/,
        /\bno longer\b/,
        /\binstead of\b/,
        /\breplaced by\b/,
        /\bswitched from\b/,
      ];

      const hasNegation = negationPatterns.some(
        p => p.test(obsLower) || p.test(topLower),
      );

      if (hasNegation && overlapRatio >= 0.3) {
        conflicting.push(obs);
      } else {
        novel.push(obs);
      }
    }
  }

  return { novel, reinforcing, conflicting };
}

// ---------------------------------------------------------------------------
// Full conversation pipeline
// ---------------------------------------------------------------------------

/**
 * Process a full conversation through the observe → reflect pipeline.
 *
 * Steps:
 *   1. Split conversation into chunks.
 *   2. Run observe() on each chunk to extract memories.
 *   3. Run reflect() on the extracted observations.
 *   4. Boost reinforced memories.
 *   5. Return aggregate statistics.
 */
export async function processConversation(
  conversation: string,
  project: string,
): Promise<{
  memoriesCreated: number;
  memoriesReinforced: number;
  conflictsDetected: number;
}> {
  log.info('Processing conversation', { project, length: conversation.length });

  const chunks = splitConversation(conversation);
  log.debug('Conversation chunks', { count: chunks.length });

  const allObservations: string[] = [];
  let memoriesCreated = 0;

  for (const chunk of chunks) {
    const { observations, memories } = observe(chunk, project);
    allObservations.push(...observations);
    memoriesCreated += memories.length;
  }

  // Reflect on all accumulated observations
  const { novel, reinforcing, conflicting } = await reflect(allObservations, project);

  // Log a reflection observation entry for the session
  if (allObservations.length > 0) {
    const reflectionEntry: ObservationEntry = {
      id:                 randomUUID(),
      content:            `Reflection: ${novel.length} novel, ${reinforcing.length} reinforcing, ${conflicting.length} conflicting`,
      extracted_memories: [],
      source:             'reflection',
      project,
      created_at:         new Date().toISOString(),
    };

    try {
      createObservation(reflectionEntry);
    } catch {
      // Non-critical — don't fail the whole pipeline
    }
  }

  log.info('Conversation processed', {
    project,
    chunks:             chunks.length,
    memoriesCreated,
    memoriesReinforced: reinforcing.length,
    conflictsDetected:  conflicting.length,
    novel:              novel.length,
  });

  return {
    memoriesCreated,
    memoriesReinforced: reinforcing.length,
    conflictsDetected:  conflicting.length,
  };
}
