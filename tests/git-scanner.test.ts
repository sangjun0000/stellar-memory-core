import { describe, it, expect, vi } from 'vitest';
import { commitToMemory } from '../src/scanner/local/git.js';
import type { GitCommit } from '../src/scanner/local/git.js';

// ---------------------------------------------------------------------------
// commitToMemory — unit tests (no actual git required)
// ---------------------------------------------------------------------------

const BASE_COMMIT: GitCommit = {
  hash:         'abc1234567890abcdef1234567890abcdef12345',
  shortHash:    'abc1234',
  author:       'Alice Dev',
  date:         '2024-01-15T10:30:00Z',
  message:      'feat: add orbital decay calculation',
  body:         'feat: add orbital decay calculation\n\nImplements time-based memory decay.',
  changedFiles: ['src/engine/orbit.ts', 'tests/orbit.test.ts'],
};

describe('commitToMemory', () => {
  it('creates a memory with git tags', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(result.tags).toContain('git');
    expect(result.tags).toContain('commit');
  });

  it('uses commit message as summary', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(result.summary).toBe('feat: add orbital decay calculation');
  });

  it('infers milestone type for feat commits', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(result.type).toBe('milestone');
  });

  it('infers error type for fix commits', () => {
    const commit: GitCommit = {
      ...BASE_COMMIT,
      message: 'fix: resolve null pointer in gravity engine',
    };
    const result = commitToMemory(commit, '/repo/stellar');
    expect(result.type).toBe('error');
  });

  it('infers decision type for refactor commits', () => {
    const commit: GitCommit = {
      ...BASE_COMMIT,
      message: 'refactor: extract orbit calculation into separate module',
    };
    const result = commitToMemory(commit, '/repo/stellar');
    expect(result.type).toBe('decision');
  });

  it('infers decision type for BREAKING CHANGE commits', () => {
    const commit: GitCommit = {
      ...BASE_COMMIT,
      message: 'feat!: breaking API change for memory interface',
    };
    const result = commitToMemory(commit, '/repo/stellar');
    expect(result.type).toBe('decision');
  });

  it('includes git metadata in metadata field', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(result.metadata['gitHash']).toBe(BASE_COMMIT.hash);
    expect(result.metadata['shortHash']).toBe('abc1234');
    expect(result.metadata['author']).toBe('Alice Dev');
    expect(result.metadata['date']).toBe('2024-01-15T10:30:00Z');
    expect(result.metadata['repoPath']).toBe('/repo/stellar');
  });

  it('includes changed files in metadata', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(Array.isArray(result.metadata['changedFiles'])).toBe(true);
    expect((result.metadata['changedFiles'] as string[])).toContain('src/engine/orbit.ts');
  });

  it('adds top-level directory of changed files as tags', () => {
    const commit: GitCommit = {
      ...BASE_COMMIT,
      changedFiles: ['src/engine/orbit.ts', 'tests/orbit.test.ts', 'docs/api.md'],
    };
    const result = commitToMemory(commit, '/repo/stellar');
    expect(result.tags).toContain('src');
    expect(result.tags).toContain('tests');
    expect(result.tags).toContain('docs');
  });

  it('includes author as sanitised tag', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(result.tags).toContain('alice-dev');
  });

  it('includes commit content with repo path', () => {
    const result = commitToMemory(BASE_COMMIT, '/repo/stellar');
    expect(result.content).toContain('abc1234');
    expect(result.content).toContain('/repo/stellar');
    expect(result.content).toContain('Alice Dev');
  });

  it('handles commits with no changed files', () => {
    const commit: GitCommit = { ...BASE_COMMIT, changedFiles: [] };
    const result = commitToMemory(commit, '/repo');
    expect(result.content).not.toContain('Changed files');
  });

  it('truncates very long commit messages in title to 80 chars', () => {
    const longMsg = 'feat: ' + 'a'.repeat(100);
    const commit: GitCommit = { ...BASE_COMMIT, message: longMsg };
    const result = commitToMemory(commit, '/repo');
    expect(result.title.length).toBeLessThanOrEqual(80 + '[git] '.length);
  });
});
