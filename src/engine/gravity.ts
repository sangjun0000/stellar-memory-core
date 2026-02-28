/**
 * gravity.ts — Relevance calculation (keyword + vector)
 *
 * Phase 1: keyword overlap between memory content and sun context.
 * Phase 2: cosine vector similarity + hybrid score combining both.
 *
 * Hybrid formula:  0.7 × vectorRelevance + 0.3 × keywordRelevance
 *
 * The keyword score is retained as a fast fallback when embeddings are not
 * available (e.g., during unit tests or before the model has loaded).
 */

// Hybrid weighting constants
const VECTOR_WEIGHT  = 0.7;
const KEYWORD_WEIGHT = 0.3;

/**
 * Tokenize text: split by whitespace, lowercase, strip punctuation, filter
 * words shorter than 2 characters.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\w]/g, ''))
    .filter(word => word.length >= 2);
}

/**
 * Calculate keyword relevance between a memory and the current sun context.
 *
 * Algorithm:
 *   1. Tokenize both texts.
 *   2. Build a Set from sun tokens.
 *   3. Count how many memory tokens appear in the sun set.
 *   4. Score = min(1.0, overlap / max(3, sunTokens.length * 0.3))
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

  let overlap = 0;
  for (const token of memoryTokens) {
    if (sunSet.has(token)) {
      overlap++;
    }
  }

  const denominator = Math.max(3, sunTokens.length * 0.3);
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
  const sim = cosineSimilarity(memoryEmbedding, sunEmbedding);
  // Already in [0, 1] for normalized vecs, but apply the rescale for safety.
  return (sim + 1) / 2;
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
