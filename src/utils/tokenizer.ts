/**
 * Lightweight token estimator for mixed English/Korean text.
 *
 * Approximation basis:
 *   - English: ~1.3 tokens/word on average (GPT-style BPE)
 *   - Korean:  ~2–3 tokens/word (jamo splitting)
 *   - Blended: ~0.75 tokens per whitespace-delimited word is a practical
 *     middle-ground that avoids per-character detection overhead while
 *     remaining accurate enough for budget decisions.
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return Math.ceil(words.length * 0.75);
}
