/**
 * gravity.ts — Relevance calculation (keyword + vector) and retrieval scoring
 *
 * Phase 1: keyword overlap between memory content and sun context.
 * Phase 2: cosine vector similarity + hybrid score combining both.
 *
 * Hybrid formula (storage relevance):  0.7 × vectorRelevance + 0.3 × keywordRelevance
 *
 * Retrieval formula (search ranking):
 *   retrieval_score = semanticW × semantic_similarity
 *                   + keywordW  × keyword_overlap
 *                   + proximityW × proximity_bonus
 *   where proximity_bonus = 1.0 - (distance / 100)
 *
 * The keyword score is retained as a fast fallback when embeddings are not
 * available (e.g., during unit tests or before the model has loaded).
 */

// Hybrid weighting constants (storage relevance)
const VECTOR_WEIGHT  = 0.7;
const KEYWORD_WEIGHT = 0.3;

// Default retrieval scoring weights
const DEFAULT_RETRIEVAL_SEMANTIC_WEIGHT  = 0.55;
const DEFAULT_RETRIEVAL_KEYWORD_WEIGHT   = 0.25;
const DEFAULT_RETRIEVAL_PROXIMITY_WEIGHT = 0.20;

/**
 * Tokenize text: split by whitespace, lowercase, strip punctuation, filter
 * words shorter than 2 characters.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\w\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]/g, ''))
    .filter(word => word.length >= 2);
}

/**
 * Calculate keyword relevance between a memory and the current sun context.
 *
 * Algorithm:
 *   1. Tokenize both texts.
 *   2. Build a Set from sun tokens.
 *   3. Count how many memory tokens appear in the sun set.
 *   4. Score = min(1.0, overlap / max(5, sunTokens.length * 0.3))
 *
 * Returns a score between 0 and 1.
 * Returns 0 if sunText is empty.
 */
export function keywordRelevance(memoryText: string, sunText: string): number {
  if (!sunText || sunText.trim().length === 0) {
    return 0;
  }

  const sunTokens = tokenize(sunText);
  if (sunTokens.length === 0) {
    return 0;
  }

  const sunSet = new Set(sunTokens);
  const memoryTokens = tokenize(memoryText);

  const memorySet = new Set(memoryTokens);
  let overlap = 0;
  for (const token of memorySet) {
    if (sunSet.has(token)) {
      overlap++;
    }
  }

  const denominator = Math.max(5, sunTokens.length * 0.3);
  return Math.min(1.0, overlap / denominator);
}

// ---------------------------------------------------------------------------
// Vector relevance (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two Float32Arrays of equal length.
 *
 * Formula: dot(a, b) / (‖a‖ × ‖b‖)
 *
 * Returns a value in [-1, 1]; in practice [0, 1] for embeddings produced
 * by all-MiniLM-L6-v2 (which are L2-normalized, so norm(a) = norm(b) = 1).
 *
 * Returns 0 for zero-length or mismatched vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot  = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  // Clamp to [0, 1] — cosine can be slightly negative due to float rounding.
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Vector relevance between a memory embedding and the sun (context) embedding.
 *
 * Wraps cosineSimilarity and converts the [-1, 1] cosine distance into a
 * [0, 1] relevance score:  score = (similarity + 1) / 2
 *
 * For normalized embeddings (all-MiniLM-L6-v2), similarity is already [0, 1]
 * in practice, but the rescaling ensures the contract is always satisfied.
 *
 * Returns 0 when either embedding is null/undefined.
 */
export function vectorRelevance(
  memoryEmbedding: Float32Array | null | undefined,
  sunEmbedding:   Float32Array | null | undefined,
): number {
  if (!memoryEmbedding || !sunEmbedding) return 0;
  return Math.max(0, cosineSimilarity(memoryEmbedding, sunEmbedding));
}

/**
 * Hybrid relevance: combines vector semantic similarity with keyword overlap.
 *
 *   score = VECTOR_WEIGHT × vectorRelevance + KEYWORD_WEIGHT × keywordRelevance
 *
 * Falls back gracefully:
 *   - If embeddings are absent → pure keyword score.
 *   - If sunText is empty      → pure vector score (if embedding available).
 */
export function hybridRelevance(
  memoryText: string,
  sunText: string,
  memoryEmbedding: Float32Array | null | undefined,
  sunEmbedding:   Float32Array | null | undefined,
): number {
  const vecScore = vectorRelevance(memoryEmbedding, sunEmbedding);
  const kwScore  = keywordRelevance(memoryText, sunText);

  // If we have no vector signal, fall back entirely to keywords.
  if (!memoryEmbedding || !sunEmbedding) return kwScore;

  return Math.min(1.0, VECTOR_WEIGHT * vecScore + KEYWORD_WEIGHT * kwScore);
}

// ---------------------------------------------------------------------------
// Retrieval score (search ranking)
// ---------------------------------------------------------------------------

/**
 * Calculate retrieval score for ranking search results.
 *
 * Separate from storage importance — this score is computed at query time
 * and reflects how well a memory matches the user's current query, biased
 * toward memories that are already close (high proximity bonus).
 *
 *   retrieval_score = semanticW  × semantic_similarity
 *                   + keywordW   × keyword_overlap
 *                   + proximityW × proximity_bonus
 *
 *   proximity_bonus = 1.0 - clamp(distance / 100, 0, 1)
 *     → 1.0 for a memory at 0 AU (core), 0.0 at 100 AU (forgotten)
 *
 * Falls back to keyword + proximity when embeddings are absent.
 *
 * Weights default to 0.55 / 0.25 / 0.20 but can be overridden from config.
 */
export function retrievalScore(
  memoryText: string,
  queryText: string,
  memoryDistance: number,
  memoryEmbedding: Float32Array | null | undefined,
  queryEmbedding:  Float32Array | null | undefined,
  weights?: {
    semantic:  number;
    keyword:   number;
    proximity: number;
  },
): number {
  const w = weights ?? {
    semantic:  DEFAULT_RETRIEVAL_SEMANTIC_WEIGHT,
    keyword:   DEFAULT_RETRIEVAL_KEYWORD_WEIGHT,
    proximity: DEFAULT_RETRIEVAL_PROXIMITY_WEIGHT,
  };

  const semantic  = vectorRelevance(memoryEmbedding, queryEmbedding);
  const keyword   = keywordRelevance(memoryText, queryText);
  const proximity = 1.0 - Math.min(1.0, Math.max(0.0, memoryDistance / 100));

  // When no embeddings available, redistribute semantic weight to keyword
  if (!memoryEmbedding || !queryEmbedding) {
    const totalNonSemantic = w.keyword + w.proximity;
    const kwNorm  = totalNonSemantic > 0 ? w.keyword   / totalNonSemantic : 0.5;
    const prxNorm = totalNonSemantic > 0 ? w.proximity / totalNonSemantic : 0.5;
    return Math.min(1.0, kwNorm * keyword + prxNorm * proximity);
  }

  return Math.min(1.0, w.semantic * semantic + w.keyword * keyword + w.proximity * proximity);
}
