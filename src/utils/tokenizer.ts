/**
 * Lightweight token estimator for mixed English/Korean text.
 *
 * Unicode-aware estimation:
 *   - ASCII/Latin text: ~1.3 tokens per whitespace-delimited word
 *   - CJK characters (Korean/Chinese/Japanese): ~2.0 tokens per character
 *   - Other Unicode: ~1.5 tokens per word
 *
 * This replaces the old 0.75 tokens/word estimate which underestimated
 * by ~50%, causing sun token budget overflows.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let tokens = 0;

  // CJK Unicode ranges:
  //   Hangul Syllables: U+AC00–U+D7AF
  //   Hangul Jamo:      U+1100–U+11FF
  //   CJK Unified:      U+4E00–U+9FFF
  //   Katakana/Hiragana: U+3040–U+30FF
  const CJK_REGEX = /[\u1100-\u11FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

  // Split into whitespace-delimited segments
  const segments = text.split(/\s+/).filter(w => w.length > 0);

  for (const segment of segments) {
    if (CJK_REGEX.test(segment)) {
      // For CJK-containing segments, count chars individually
      for (const char of segment) {
        if (CJK_REGEX.test(char)) {
          tokens += 2.0;  // CJK chars typically split into 2+ tokens
        } else {
          tokens += 0.5;  // Punctuation/ASCII mixed in with CJK
        }
      }
    } else {
      // English/Latin word: ~1.3 tokens per word
      tokens += 1.3;
    }
  }

  // Account for whitespace tokens (roughly 1 token per 4 spaces/newlines)
  const whitespace = text.length - text.replace(/\s/g, '').length;
  tokens += whitespace * 0.25;

  return Math.ceil(tokens);
}
