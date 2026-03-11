/**
 * constellation.ts — Knowledge Graph engine module
 *
 * Memories form a "constellation" — a graph where edges represent semantic
 * and structural relationships between memory planets.
 *
 * Relationships are inferred using fast, local keyword heuristics:
 *   - Type-based rules (error → decision = caused_by, etc.)
 *   - Contradiction detection (negation/replacement keywords near shared terms)
 *   - Content reference detection (one memory's text mentions another's keywords)
 *   - Shared tag overlap (same domain/topic)
 *   - Default fallback: related_to
 *
 * All functions are synchronous except extractRelationships, which is async
 * because it may use vector similarity as the primary similarity signal.
 */

import { randomUUID } from 'node:crypto';
import type { Memory, ConstellationEdge, RelationType } from './types.js';
import {
  createEdge,
  getEdges,
  getConstellation,
  deleteEdge,
  getMemoryByIds,
  searchMemories,
  getEdgeIdsForMemory,
} from '../storage/queries.js';
import { getDatabase } from '../storage/database.js';
import { generateEmbedding } from './embedding.js';
import { searchByVector } from '../storage/vec.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('constellation');

/** Minimum similarity weight required to create an edge. */
const WEIGHT_THRESHOLD = 0.3;

/** Maximum number of similar memories to evaluate per new memory. */
const TOP_K = 5;

// ---------------------------------------------------------------------------
// Relationship inference
// ---------------------------------------------------------------------------

/**
 * Negation and replacement signal words. If both memories share a significant
 * keyword AND one of them contains these signals near that keyword, the
 * relationship is likely a contradiction.
 */
const CONTRADICTION_SIGNALS = [
  'instead', 'replaced', 'switched', 'no longer', 'not ', "don't", "doesn't",
  'removed', 'deprecated', 'reverted', 'cancelled', 'abandoned',
  '대신', '변경', '제거', '취소', '중단', '아님',
];

/** Keywords that suggest one memory uses/depends-on another. */
const DEPENDENCY_SIGNALS = [
  'uses', 'using', 'depends on', 'requires', 'needs', 'via', 'through',
  'built on', 'extends', 'imports', 'calls', 'powered by',
  '사용', '의존', '필요', '통해', '기반',
];

/**
 * Extract significant keywords from text — words longer than 3 characters,
 * lowercased, de-duplicated, with common stop-words removed.
 */
function extractKeywords(text: string): Set<string> {
  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'will',
    'been', 'when', 'then', 'than', 'into', 'also', 'some', 'more', 'each',
    'they', 'were', 'their', 'what', 'which', 'about',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  return new Set(words);
}

/**
 * Compute the Jaccard-like overlap ratio between two keyword sets.
 * Returns 0.0–1.0.
 */
function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) {
    if (b.has(w)) shared++;
  }
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Return true if one content string contains contradiction signals near a
 * keyword that the other string also contains.
 */
function hasContradictionSignals(a: string, b: string): boolean {
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  const keywordsA = extractKeywords(a);
  const keywordsB = extractKeywords(b);

  // Find shared keywords
  const shared: string[] = [];
  for (const w of keywordsA) {
    if (keywordsB.has(w)) shared.push(w);
  }
  if (shared.length === 0) return false;

  // For each shared keyword, check if a contradiction signal appears nearby
  // in either string (within a 60-character window around the keyword).
  for (const keyword of shared) {
    for (const text of [aLow, bLow]) {
      const idx = text.indexOf(keyword);
      if (idx === -1) continue;
      const window = text.slice(Math.max(0, idx - 60), idx + keyword.length + 60);
      for (const signal of CONTRADICTION_SIGNALS) {
        if (window.includes(signal)) return true;
      }
    }
  }

  return false;
}

/**
 * Return true if `sourceContent` references key terms from `targetSummary`.
 * This indicates a "uses" or "depends_on" relationship.
 */
function contentReferences(sourceContent: string, targetSummary: string): boolean {
  const srcLow = sourceContent.toLowerCase();
  const targetKeywords = extractKeywords(targetSummary);

  // Must share at least 2 keywords AND have a dependency signal
  const sharedCount = [...targetKeywords].filter(w => srcLow.includes(w)).length;
  if (sharedCount < 2) return false;

  for (const signal of DEPENDENCY_SIGNALS) {
    if (srcLow.includes(signal)) return true;
  }

  return false;
}

/**
 * Return true if source and target have meaningful tag overlap (≥ 1 shared tag).
 */
function hasSharedTags(source: Memory, target: Memory): boolean {
  if (source.tags.length === 0 || target.tags.length === 0) return false;
  const targetTags = new Set(target.tags.map(t => t.toLowerCase()));
  return source.tags.some(t => targetTags.has(t.toLowerCase()));
}

/**
 * Infer the most appropriate RelationType between a source and a target memory
 * using type-based rules and keyword heuristics.
 */
function inferRelationType(source: Memory, target: Memory): RelationType {
  // ── Type-based structural rules ───────────────────────────────────────────
  if (source.type === 'error' && target.type === 'decision') return 'caused_by';
  if (source.type === 'decision' && target.type === 'error') return 'caused_by';

  if (source.type === 'milestone' && target.type === 'task') return 'derived_from';
  if (source.type === 'task' && target.type === 'milestone') return 'part_of';

  if (source.type === 'decision' && target.type === 'decision') {
    if (hasContradictionSignals(source.content, target.content)) return 'contradicts';
    return 'related_to';
  }

  if (source.type === 'context' && target.type === 'decision') return 'part_of';

  // ── Content-based heuristics ──────────────────────────────────────────────
  if (contentReferences(source.content, target.summary)) return 'uses';
  if (contentReferences(target.content, source.summary)) return 'depends_on';

  if (hasContradictionSignals(source.content, target.content)) return 'contradicts';

  return 'related_to';
}

// ---------------------------------------------------------------------------
// extractRelationships — primary public function
// ---------------------------------------------------------------------------

/**
 * Auto-extract relationships for a newly stored memory.
 *
 * Algorithm:
 *   1. Find the top-K most similar existing memories using vector KNN if
 *      available, falling back to FTS5 keyword search.
 *   2. For each candidate, compute a weight (cosine similarity or keyword
 *      overlap ratio).
 *   3. Filter candidates below WEIGHT_THRESHOLD.
 *   4. Infer the relationship type using keyword heuristics.
 *   5. Persist edges via queries.createEdge().
 *
 * Returns the list of edges that were created.
 */
export async function extractRelationships(
  newMemory: Memory,
  project: string,
): Promise<ConstellationEdge[]> {
  const created: ConstellationEdge[] = [];

  // ── 1. Candidate retrieval ────────────────────────────────────────────────
  let candidates: Array<{ memory: Memory; weight: number }> = [];

  try {
    const db = getDatabase();
    const queryText = newMemory.content + ' ' + newMemory.summary;
    const embedding = await generateEmbedding(queryText);
    const vecResults = searchByVector(db, embedding, TOP_K + 1); // +1 to exclude self

    const ids = vecResults
      .map(r => r.memoryId)
      .filter(id => id !== newMemory.id)
      .slice(0, TOP_K);

    if (ids.length > 0) {
      const memories = getMemoryByIds(ids);
      const idToDistance = new Map(vecResults.map(r => [r.memoryId, r.distance]));

      for (const mem of memories) {
        if (mem.id === newMemory.id) continue;
        // sqlite-vec returns L2 distance — convert to a 0–1 similarity score.
        // L2 distance for unit vectors ranges 0–2; we rescale to [0,1].
        const l2 = idToDistance.get(mem.id) ?? 2;
        const similarity = Math.max(0, 1 - l2 / 2);
        candidates.push({ memory: mem, weight: similarity });
      }
    }
  } catch {
    // Vector search unavailable — fall back to FTS5
    log.debug('Vector search unavailable, falling back to FTS5', { memoryId: newMemory.id });
  }

  // FTS5 fallback (or supplement when vector returns too few results)
  if (candidates.length < TOP_K) {
    const ftsQuery = newMemory.summary || newMemory.content.slice(0, 100);
    const ftsResults = searchMemories(project, ftsQuery, TOP_K + 1);
    const existingIds = new Set([newMemory.id, ...candidates.map(c => c.memory.id)]);

    for (const mem of ftsResults) {
      if (existingIds.has(mem.id)) continue;
      const srcKw  = extractKeywords(newMemory.content);
      const tgtKw  = extractKeywords(mem.content);
      const weight = keywordOverlap(srcKw, tgtKw);
      candidates.push({ memory: mem, weight });
      existingIds.add(mem.id);
      if (candidates.length >= TOP_K) break;
    }
  }

  // ── 2. Filter + deduplicate ───────────────────────────────────────────────
  candidates = candidates
    .filter(c => c.weight >= WEIGHT_THRESHOLD)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, TOP_K);

  // ── 3. Infer & persist edges ──────────────────────────────────────────────
  const now = new Date().toISOString();

  for (const { memory: target, weight } of candidates) {
    const relation = inferRelationType(newMemory, target);

    const edge: ConstellationEdge = {
      id:         randomUUID(),
      source_id:  newMemory.id,
      target_id:  target.id,
      relation,
      weight:     Math.round(weight * 1000) / 1000, // round to 3 decimal places
      project,
      created_at: now,
      metadata:   {},
    };

    try {
      createEdge(edge);
      created.push(edge);
      log.debug('Constellation edge created', {
        source: newMemory.id,
        target: target.id,
        relation,
        weight: edge.weight,
      });
    } catch (err) {
      log.warn('Failed to create constellation edge', { err, source: newMemory.id, target: target.id });
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// getConstellationGraph
// ---------------------------------------------------------------------------

/**
 * Return the full constellation graph (nodes + edges) centred on a memory.
 *
 * Uses queries.getConstellation() which handles multi-depth BFS traversal
 * and deduplication internally. Depth defaults to 1 (immediate neighbours).
 */
export function getConstellationGraph(
  memoryId: string,
  project: string,
  depth = 1,
): { nodes: Memory[]; edges: ConstellationEdge[] } {
  return getConstellation(memoryId, project, depth);
}

// ---------------------------------------------------------------------------
// findRelatedMemories
// ---------------------------------------------------------------------------

/**
 * Return the top N memories most strongly connected to the given memory,
 * sorted by edge weight (descending).
 *
 * Useful for augmenting recall results with graph-traversal neighbours.
 */
export function findRelatedMemories(
  memoryId: string,
  project: string,
  limit = 10,
): Memory[] {
  const edges = getEdges(memoryId, project);

  if (edges.length === 0) return [];

  // Collect the IDs of connected memories (excluding memoryId itself)
  const weightById = new Map<string, number>();
  for (const edge of edges) {
    const connectedId = edge.source_id === memoryId ? edge.target_id : edge.source_id;
    // Keep the highest weight if the same memory appears in multiple edges
    const existing = weightById.get(connectedId) ?? 0;
    if (edge.weight > existing) {
      weightById.set(connectedId, edge.weight);
    }
  }

  // Sort by weight descending, take top N
  const sortedIds = [...weightById.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  if (sortedIds.length === 0) return [];

  const memories = getMemoryByIds(sortedIds);

  // Preserve the weight-sorted order
  const idOrder = new Map(sortedIds.map((id, i) => [id, i]));
  return memories.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
}

// ---------------------------------------------------------------------------
// suggestRelationships
// ---------------------------------------------------------------------------

/**
 * Suggest potential relationships for an existing memory without persisting them.
 * Useful for a "review" UI where a user can approve/reject suggestions.
 *
 * Returns candidates sorted by confidence (descending).
 */
export function suggestRelationships(
  memoryId: string,
  project: string,
): Array<{ target: Memory; suggestedRelation: RelationType; confidence: number }> {
  // Get the source memory from the constellation graph (depth 0 = just the node)
  const { nodes } = getConstellation(memoryId, project, 0);
  const source = nodes.find(n => n.id === memoryId);
  if (!source) return [];

  // Use FTS5 to find candidate memories to evaluate
  const ftsQuery = source.summary || source.content.slice(0, 100);
  const candidates = searchMemories(project, ftsQuery, 20);

  // Get already-existing edge targets so we can exclude them
  const existingEdges = getEdges(memoryId, project);
  const alreadyLinked = new Set([
    memoryId,
    ...existingEdges.map(e => (e.source_id === memoryId ? e.target_id : e.source_id)),
  ]);

  const suggestions: Array<{ target: Memory; suggestedRelation: RelationType; confidence: number }> = [];
  const srcKw = extractKeywords(source.content);

  for (const candidate of candidates) {
    if (alreadyLinked.has(candidate.id)) continue;

    const tgtKw = extractKeywords(candidate.content);
    const confidence = keywordOverlap(srcKw, tgtKw);

    if (confidence < WEIGHT_THRESHOLD) continue;

    const suggestedRelation = inferRelationType(source, candidate);
    suggestions.push({ target: candidate, suggestedRelation, confidence });
  }

  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// cleanupEdges
// ---------------------------------------------------------------------------

/**
 * Remove all constellation edges that reference the given memory ID.
 * Should be called when a memory is deleted to prevent orphan edges.
 */
export function cleanupEdges(memoryId: string): void {
  const ids = getEdgeIdsForMemory(memoryId);

  for (const id of ids) {
    try {
      deleteEdge(id);
    } catch (err) {
      log.warn('Failed to delete constellation edge during cleanup', { edgeId: id, err });
    }
  }

  log.debug('Cleaned up constellation edges', { memoryId, count: ids.length });
}
