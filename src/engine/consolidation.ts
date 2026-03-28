/**
 * consolidation.ts — Memory Consolidation ("Orbital Resonance")
 *
 * Finds groups of similar memories and merges them into richer, more
 * comprehensive memories. Similar to how planets form from smaller bodies
 * (planetesimals) combining in orbital resonance.
 *
 * Algorithm:
 *   1. Load all memories in a project.
 *   2. Group memories that share the same type and are within ±3 AU of each
 *      other, with cosine similarity > 0.80 between their embeddings.
 *      Falls back to Jaccard-based text similarity when embeddings are absent.
 *   3. For each qualifying group (2+ memories):
 *      - Merge content by deduplicating sentences.
 *      - Create a new consolidated memory.
 *      - Mark sources as consolidated and push them to the Oort cloud.
 */

import { randomUUID } from 'node:crypto';
import type { Memory, MemoryType } from './types.js';
import { IMPACT_DEFAULTS } from './types.js';
import {
  getMemoriesByProject,
  consolidateMemories,
  getConsolidationHistory,
  updateMemoryOrbit,
  updateMemoryContent,
  insertOrbitLog,
  getStoredEmbeddingForMemory,
} from '../storage/queries.js';
import { createMemory } from './planet.js';
import { generateEmbedding } from './embedding.js';
import { cosineSimilarity } from './gravity.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('consolidation');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.80; // cosine similarity cutoff for grouping
const DISTANCE_TOLERANCE   = 3.0;  // AU — memories must be within ±3 AU
const OORT_DISTANCE        = 95.0; // source memories are pushed here post-merge
const JACCARD_DEDUP_THRESHOLD = 0.70; // sentence deduplication cutoff

// ---------------------------------------------------------------------------
// Pre-save dedup thresholds
// ---------------------------------------------------------------------------
/** Above this similarity: treat new memory as near-duplicate → enrich existing. */
export const ENRICH_THRESHOLD = 0.85;
/** Above this similarity: treat new memory as exact duplicate → skip entirely. */
export const SKIP_THRESHOLD   = 0.95;

// Type priority for choosing the merged memory's type (higher = more important)
const TYPE_PRIORITY: Record<MemoryType, number> = {
  decision:    6,
  milestone:   5,
  error:       4,
  task:        3,
  context:     2,
  observation: 1,
  procedural:  3,
};

// ---------------------------------------------------------------------------
// Sentence deduplication helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize a sentence into a Set of lowercase word tokens.
 * Used for Jaccard similarity comparison.
 */
function tokenizeToSet(sentence: string): Set<string> {
  const tokens = sentence
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length >= 2);
  return new Set(tokens);
}

/**
 * Jaccard similarity between two token sets.
 * Returns a value in [0, 1].
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate an array of sentences using Jaccard similarity.
 *
 * For each new sentence, if it is too similar to one already kept (above
 * JACCARD_DEDUP_THRESHOLD), keep the longer/more detailed version and discard
 * the other.
 *
 * Returns the deduplicated array of sentences in original order.
 */
export function deduplicateSentences(sentences: string[]): string[] {
  const kept: { text: string; tokens: Set<string> }[] = [];

  for (const sentence of sentences) {
    const sentenceTokens = tokenizeToSet(sentence);
    let dominated = false;

    for (let i = 0; i < kept.length; i++) {
      const sim = jaccardSimilarity(sentenceTokens, kept[i].tokens);
      if (sim >= JACCARD_DEDUP_THRESHOLD) {
        // Keep the longer, more detailed version
        if (sentence.length > kept[i].text.length) {
          kept[i] = { text: sentence, tokens: sentenceTokens };
        }
        dominated = true;
        break;
      }
    }

    if (!dominated) {
      kept.push({ text: sentence, tokens: sentenceTokens });
    }
  }

  return kept.map(k => k.text);
}

/**
 * Split text into individual sentences.
 * Handles common sentence-ending punctuation and newlines.
 */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ---------------------------------------------------------------------------
// Similarity helpers
// ---------------------------------------------------------------------------

// Use the shared query function — no local DB access needed.
const getStoredEmbedding = getStoredEmbeddingForMemory;

/**
 * Text-based similarity between two memories using Jaccard on tokenized content.
 * Used as a fallback when embeddings are unavailable.
 */
function textSimilarity(a: Memory, b: Memory): number {
  const tokensA = tokenizeToSet(a.content + ' ' + a.summary);
  const tokensB = tokenizeToSet(b.content + ' ' + b.summary);
  return jaccardSimilarity(tokensA, tokensB);
}

// ---------------------------------------------------------------------------
// Pre-save duplicate detection
// ---------------------------------------------------------------------------

export interface SimilarMemoryResult {
  memory: Memory;
  similarity: number;
  /** 'skip' if similarity ≥ SKIP_THRESHOLD, 'enrich' if ≥ ENRICH_THRESHOLD */
  action: 'skip' | 'enrich';
}

/**
 * Check whether a candidate text is too similar to any existing memory in the
 * project. Returns the most similar memory and recommended action, or null if
 * no similar memory is found.
 *
 * Uses stored embeddings when available (fast — no model inference needed).
 * Falls back to Jaccard text similarity when embeddings are absent.
 *
 * This is designed to be called synchronously in createMemory() using the
 * pre-fetched embedding cache from the corona, so it must not do async work.
 */
export function findSimilarMemory(
  project: string,
  candidateText: string,
  candidateEmbedding: Float32Array | null,
  excludeId?: string,
): SimilarMemoryResult | null {
  const existing = getMemoriesByProject(project).filter(
    m => !m.consolidated_into && !m.deleted_at && m.id !== excludeId,
  );

  if (existing.length === 0) return null;

  const candidateTokens = candidateEmbedding === null
    ? tokenizeToSet(candidateText)
    : null;

  let bestMemory: Memory | null = null;
  let bestSim = 0;

  for (const m of existing) {
    let sim: number;

    if (candidateEmbedding !== null) {
      const storedEmb = getStoredEmbedding(m.id);
      if (storedEmb) {
        sim = cosineSimilarity(candidateEmbedding, storedEmb);
      } else {
        // Fallback: text similarity
        const mTokens = tokenizeToSet(m.content + ' ' + m.summary);
        sim = jaccardSimilarity(candidateTokens!, mTokens);
      }
    } else {
      const mTokens = tokenizeToSet(m.content + ' ' + m.summary);
      sim = jaccardSimilarity(candidateTokens!, mTokens);
    }

    if (sim > bestSim) {
      bestSim = sim;
      bestMemory = m;
    }
  }

  if (!bestMemory || bestSim < ENRICH_THRESHOLD) return null;

  return {
    memory: bestMemory,
    similarity: bestSim,
    action: bestSim >= SKIP_THRESHOLD ? 'skip' : 'enrich',
  };
}

/**
 * Enrich an existing memory by merging unique sentences from new content into it.
 * Returns the updated memory.
 */
export function enrichMemory(existing: Memory, newContent: string): Memory {
  const existingSentences = splitIntoSentences(existing.content);
  const newSentences      = splitIntoSentences(newContent);
  const combined          = deduplicateSentences([...existingSentences, ...newSentences]);
  const mergedContent     = combined.join(' ');

  const MAX_CONTENT_LENGTH = 2000;
  const finalContent = mergedContent.length > MAX_CONTENT_LENGTH
    ? mergedContent.slice(0, MAX_CONTENT_LENGTH).trimEnd() + '…'
    : mergedContent;

  // Only update if the merged content is actually richer
  if (finalContent === existing.content) return existing;

  updateMemoryContent(existing.id, finalContent);
  log.debug('Enriched existing memory with new content', {
    id:       existing.id,
    before:   existing.content.length,
    after:    finalContent.length,
  });

  return { ...existing, content: finalContent };
}

// ---------------------------------------------------------------------------
// Candidate finding
// ---------------------------------------------------------------------------

/**
 * Find groups of memories that are candidates for consolidation.
 *
 * Criteria for grouping:
 *   - Same type
 *   - Within ±3 AU of each other (distance)
 *   - Cosine similarity > 0.80 (falls back to Jaccard if no embeddings)
 *
 * Returns groups sorted by average similarity (highest first).
 * Each group contains 2+ memories.
 */
export async function findConsolidationCandidates(
  project: string,
): Promise<Array<{ memories: Memory[]; similarity: number }>> {
  const all = getMemoriesByProject(project).filter(
    m => !m.consolidated_into && !m.deleted_at,
  );

  if (all.length < 2) return [];

  // Pre-fetch all available embeddings in one pass to avoid repeated DB hits
  const embeddingCache = new Map<string, Float32Array | null>();
  for (const m of all) {
    embeddingCache.set(m.id, getStoredEmbedding(m.id));
  }

  // Build groups using a union-find-like approach:
  // Any two memories that pass ALL criteria are put in the same group.
  const groups: Array<{ memories: Memory[]; similarities: number[] }> = [];
  const grouped = new Set<string>();

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (grouped.has(a.id)) continue;

    const group: Memory[] = [a];
    const similarities: number[] = [];

    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (grouped.has(b.id)) continue;

      // Must share the same memory type
      if (a.type !== b.type) continue;

      // Must be within ±3 AU of each other
      if (Math.abs(a.distance - b.distance) > DISTANCE_TOLERANCE) continue;

      // Similarity check — prefer embeddings, fall back to text
      let similarity: number;
      const embA = embeddingCache.get(a.id) ?? null;
      const embB = embeddingCache.get(b.id) ?? null;

      if (embA && embB) {
        similarity = cosineSimilarity(embA, embB);
      } else {
        similarity = textSimilarity(a, b);
      }

      if (similarity < SIMILARITY_THRESHOLD) continue;

      group.push(b);
      similarities.push(similarity);
    }

    if (group.length >= 2) {
      for (const m of group) grouped.add(m.id);
      groups.push({ memories: group, similarities });
    }
  }

  // Compute average similarity per group and sort descending
  return groups
    .map(g => ({
      memories: g.memories,
      similarity: g.similarities.length > 0
        ? g.similarities.reduce((s, v) => s + v, 0) / g.similarities.length
        : SIMILARITY_THRESHOLD,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

/**
 * Consolidate a group of memories into a single new memory.
 *
 * Merge strategy:
 *   - Content: Combine unique sentences from all sources (Jaccard dedup).
 *   - Summary: Join all source summaries, deduplicated and truncated.
 *   - Tags: Union of all tags.
 *   - Type: Most important type by TYPE_PRIORITY ranking.
 *   - Impact: Max of all sources.
 *   - Distance: Min of all sources (closest orbit).
 *
 * After creating the new memory:
 *   - Source memories are marked as consolidated (consolidated_into set).
 *   - Source memories are pushed to the Oort cloud (distance = 95).
 *
 * Returns the newly created consolidated memory.
 */
export function consolidateGroup(memories: Memory[], project: string): Memory {
  if (memories.length < 2) {
    throw new Error('consolidateGroup requires at least 2 memories');
  }

  // Merge content: collect all sentences, deduplicate, combine
  const allSentences: string[] = [];
  for (const m of memories) {
    allSentences.push(...splitIntoSentences(m.content));
  }
  const uniqueSentences = deduplicateSentences(allSentences);
  const mergedContent =
    `Consolidated from ${memories.length} memories:\n` +
    uniqueSentences.join(' ');

  // Merge summary: collect unique summaries
  const summaryParts = deduplicateSentences(memories.map(m => m.summary));
  const mergedSummary = summaryParts.join('; ').slice(0, 120);

  // Merge tags: union, deduplicated
  const tagSet = new Set<string>();
  for (const m of memories) {
    for (const t of m.tags) tagSet.add(t);
  }
  const mergedTags = [...tagSet];

  // Choose type by priority
  const mergedType: MemoryType = memories.reduce((best, m) =>
    (TYPE_PRIORITY[m.type] ?? 0) > (TYPE_PRIORITY[best.type] ?? 0) ? m : best
  ).type;

  // Max impact
  const mergedImpact = Math.max(...memories.map(m => m.impact));

  // Create the new consolidated memory
  const consolidated = createMemory({
    project,
    content:  mergedContent,
    summary:  mergedSummary,
    type:     mergedType,
    impact:   mergedImpact,
    tags:     mergedTags,
  });

  // Mark all source memories as consolidated and push to Oort cloud
  const sourceIds = memories.map(m => m.id);
  consolidateMemories(sourceIds, consolidated.id);

  for (const m of memories) {
    updateMemoryOrbit(m.id, OORT_DISTANCE, 0.02, OORT_DISTANCE - m.distance);
    insertOrbitLog({
      memory_id:      m.id,
      project,
      old_distance:   m.distance,
      new_distance:   OORT_DISTANCE,
      old_importance: m.importance,
      new_importance: 0.02,
      trigger:        'manual',
    });
  }

  log.info('Consolidated group', {
    sourceCount:    memories.length,
    consolidatedId: consolidated.id,
    type:           mergedType,
  });

  return consolidated;
}

// ---------------------------------------------------------------------------
// Full consolidation pass
// ---------------------------------------------------------------------------

/**
 * Run a full consolidation pass for a project.
 *
 * Finds all candidate groups, consolidates each one, and returns statistics.
 */
export async function runConsolidation(project: string): Promise<{
  groupsFound: number;
  memoriesConsolidated: number;
  newMemoriesCreated: number;
}> {
  log.info('Starting consolidation pass', { project });

  const candidates = await findConsolidationCandidates(project);

  let memoriesConsolidated = 0;
  let newMemoriesCreated   = 0;

  for (const { memories, similarity } of candidates) {
    try {
      log.debug('Consolidating group', {
        size: memories.length,
        similarity: similarity.toFixed(3),
        ids: memories.map(m => m.id),
      });
      consolidateGroup(memories, project);
      memoriesConsolidated += memories.length;
      newMemoriesCreated   += 1;
    } catch (err) {
      log.warn('Failed to consolidate group', {
        ids: memories.map(m => m.id),
        error: String(err),
      });
    }
  }

  log.info('Consolidation pass complete', {
    project,
    groupsFound:          candidates.length,
    memoriesConsolidated,
    newMemoriesCreated,
  });

  return {
    groupsFound:          candidates.length,
    memoriesConsolidated,
    newMemoriesCreated,
  };
}

// ---------------------------------------------------------------------------
// Consolidation history
// ---------------------------------------------------------------------------

/**
 * Return the source memories that were merged into the given memory ID.
 * Returns an empty array if this memory was not created by consolidation.
 */
export function getConsolidationSources(memoryId: string): Memory[] {
  return getConsolidationHistory(memoryId);
}

// ---------------------------------------------------------------------------
// Async embedding-based similarity (used for higher precision when needed)
// ---------------------------------------------------------------------------

/**
 * Generate and compare embeddings for two text strings.
 * Returns cosine similarity in [0, 1].
 * Used internally when stored embeddings are unavailable.
 */
export async function computeEmbeddingSimilarity(
  textA: string,
  textB: string,
): Promise<number> {
  try {
    const [embA, embB] = await Promise.all([
      generateEmbedding(textA),
      generateEmbedding(textB),
    ]);
    return cosineSimilarity(embA, embB);
  } catch {
    return 0;
  }
}
