import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../src/utils/tokenizer.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates tokens for English text', () => {
    const tokens = estimateTokens('Hello world this is a test');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('estimates tokens for Korean text', () => {
    const tokens = estimateTokens('안녕하세요 세계 이것은 테스트입니다');
    expect(tokens).toBeGreaterThan(0);
  });

  it('handles whitespace-only text', () => {
    expect(estimateTokens('   ')).toBe(0);
  });
});
