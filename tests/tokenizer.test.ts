import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../src/utils/tokenizer.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates tokens for English text', () => {
    // 6 English words × ~1.3 + whitespace ≈ 9-10 tokens
    const tokens = estimateTokens('Hello world this is a test');
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThanOrEqual(15);
  });

  it('estimates tokens for Korean text', () => {
    // Korean chars are ~2.0 tokens each, should be higher than English
    const tokens = estimateTokens('안녕하세요 세계 이것은 테스트입니다');
    expect(tokens).toBeGreaterThan(10);
  });

  it('handles whitespace-only text', () => {
    // Whitespace-only splits to 0 segments → small token count from whitespace
    const tokens = estimateTokens('   ');
    expect(tokens).toBeLessThanOrEqual(1);
  });
});
