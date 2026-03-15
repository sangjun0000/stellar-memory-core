import { describe, it, expect } from 'vitest';
import { tokenize, keywordRelevance } from '../src/engine/gravity.js';

describe('tokenize', () => {
  it('lowercases and splits by whitespace', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips punctuation', () => {
    expect(tokenize('auth: login, signup!')).toEqual(['auth', 'login', 'signup']);
  });

  it('filters words shorter than 2 characters', () => {
    expect(tokenize('a I am ok')).toEqual(['am', 'ok']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('preserves Korean (Hangul) characters', () => {
    const tokens = tokenize('인증 마이그레이션 완료');
    expect(tokens).toEqual(['인증', '마이그레이션', '완료']);
  });

  it('preserves CJK characters mixed with ASCII', () => {
    const tokens = tokenize('PostgreSQL 인증 schema 변경');
    expect(tokens).toEqual(['postgresql', '인증', 'schema', '변경']);
  });

  it('preserves Japanese characters', () => {
    const tokens = tokenize('認証 スキーマ');
    expect(tokens).toEqual(['認証', 'スキーマ']);
  });
});

describe('keywordRelevance', () => {
  it('returns 0 when sunText is empty', () => {
    expect(keywordRelevance('some memory content', '')).toBe(0);
  });

  it('returns 0 when sunText is whitespace only', () => {
    expect(keywordRelevance('some memory content', '   ')).toBe(0);
  });

  it('returns positive score when keywords overlap', () => {
    const score = keywordRelevance(
      'implementing authentication with JWT tokens',
      'working on authentication module',
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 when no keywords overlap', () => {
    const score = keywordRelevance(
      'database migration postgresql',
      'frontend react component styling',
    );
    expect(score).toBe(0);
  });

  it('caps at 1.0 for high overlap', () => {
    const sun = 'auth login user token';
    const memory = 'auth login user token session cookie password';
    const score = keywordRelevance(memory, sun);
    expect(score).toBeLessThanOrEqual(1.0);
  });
});
