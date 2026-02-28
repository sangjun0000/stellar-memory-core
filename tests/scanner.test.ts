import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { setupTestDb, teardownTestDb } from './setup.js';
import { StellarScanner } from '../src/scanner/index.js';
import { isExcluded, buildSourceHash } from '../src/scanner/local/filesystem.js';
import { getMemoriesByProject } from '../src/storage/queries.js';

// ---------------------------------------------------------------------------
// isExcluded — unit tests (no I/O)
// ---------------------------------------------------------------------------

describe('isExcluded', () => {
  const patterns = ['node_modules', '.git', 'dist', '*.min.js'];

  it('excludes exact directory name match', () => {
    expect(isExcluded('/project/node_modules', patterns)).toBe(true);
    expect(isExcluded('/project/node_modules/lodash', patterns)).toBe(true);
  });

  it('excludes .git directories', () => {
    expect(isExcluded('/project/.git', patterns)).toBe(true);
    expect(isExcluded('/project/.git/config', patterns)).toBe(true);
  });

  it('excludes glob pattern *.min.js', () => {
    expect(isExcluded('/project/src/bundle.min.js', patterns)).toBe(true);
  });

  it('does not exclude normal source files', () => {
    expect(isExcluded('/project/src/index.ts', patterns)).toBe(false);
    expect(isExcluded('/project/README.md', patterns)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isExcluded('/project/Node_Modules', patterns)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSourceHash — deterministic hash
// ---------------------------------------------------------------------------

describe('buildSourceHash', () => {
  it('returns a 16-character hex string', () => {
    const hash = buildSourceHash('/path/to/file.ts', 1700000000000);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same inputs', () => {
    const h1 = buildSourceHash('/path/to/file.ts', 1700000000000);
    const h2 = buildSourceHash('/path/to/file.ts', 1700000000000);
    expect(h1).toBe(h2);
  });

  it('differs when path changes', () => {
    const h1 = buildSourceHash('/path/to/a.ts', 1700000000000);
    const h2 = buildSourceHash('/path/to/b.ts', 1700000000000);
    expect(h1).not.toBe(h2);
  });

  it('differs when mtime changes', () => {
    const h1 = buildSourceHash('/path/to/file.ts', 1700000000000);
    const h2 = buildSourceHash('/path/to/file.ts', 1700000001000);
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// StellarScanner — integration tests using a real temp directory
// ---------------------------------------------------------------------------

describe('StellarScanner integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    setupTestDb();
    tmpDir = await mkdtemp(join(tmpdir(), 'stellar-scan-'));
  });

  afterEach(async () => {
    teardownTestDb();
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTmp(relPath: string, content: string): Promise<string> {
    const full = join(tmpDir, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
    return full;
  }

  it('scans a directory and creates memories for .md files', async () => {
    await writeTmp('docs/guide.md', '# Project Guide\n\nThis guide explains how to use the project.');
    await writeTmp('docs/api.md', '# API Reference\n\nDocuments all public APIs.');

    const scanner = new StellarScanner();
    const result  = await scanner.scanPath(tmpDir, { includeGit: false });

    expect(result.scannedFiles).toBe(2);
    expect(result.createdMemories).toBe(2);
    expect(result.errorFiles).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const memories = getMemoriesByProject('default');
    expect(memories.length).toBe(2);
  });

  it('scans .ts files and creates code memories', async () => {
    await writeTmp('src/utils.ts', 'export function add(a: number, b: number): number { return a + b; }');

    const scanner = new StellarScanner();
    const result  = await scanner.scanPath(tmpDir, { includeGit: false });

    expect(result.createdMemories).toBeGreaterThanOrEqual(1);
    const memories = getMemoriesByProject('default');
    expect(memories.some((m) => m.source === 'scanner')).toBe(true);
    expect(memories.some((m) => m.source_path?.endsWith('utils.ts'))).toBe(true);
  });

  it('skips files larger than maxFileSize', async () => {
    // Write a file just over the 100-byte limit
    await writeTmp('big.md', '# Big\n\n' + 'x'.repeat(200));

    const scanner = new StellarScanner({ maxFileSize: 100 });
    const result  = await scanner.scanPath(tmpDir, { includeGit: false });

    expect(result.createdMemories).toBe(0);
    expect(result.skippedFiles).toBeGreaterThanOrEqual(1);
  });

  it('excludes node_modules by default', async () => {
    await mkdir(join(tmpDir, 'node_modules'), { recursive: true });
    await writeTmp('node_modules/lodash/index.js', 'module.exports = {};');
    await writeTmp('src/index.ts', 'export const x = 1;');

    const scanner = new StellarScanner();
    const result  = await scanner.scanPath(tmpDir, { includeGit: false });

    // Only src/index.ts should be scanned, not node_modules
    expect(result.createdMemories).toBe(1);
    const memories = getMemoriesByProject('default');
    expect(memories.every((m) => !m.source_path?.includes('node_modules'))).toBe(true);
  });

  it('is idempotent — scanning twice does not create duplicate memories', async () => {
    await writeTmp('notes/memo.md', '# Meeting Notes\n\nDiscussed quarterly goals.');

    const scanner = new StellarScanner();
    const r1 = await scanner.scanPath(tmpDir, { includeGit: false });
    const r2 = await scanner.scanPath(tmpDir, { includeGit: false });

    expect(r1.createdMemories).toBe(1);
    // Second scan: file unchanged → all skipped
    expect(r2.createdMemories).toBe(0);
    expect(r2.skippedFiles).toBeGreaterThanOrEqual(1);

    // Still only one memory in DB
    const memories = getMemoriesByProject('default');
    expect(memories.length).toBe(1);
  });

  it('stores correct source_path on the created memory', async () => {
    await writeTmp('docs/readme.md', '# Readme\n\nContent here.');

    const scanner = new StellarScanner();
    await scanner.scanPath(tmpDir, { includeGit: false });

    const memories = getMemoriesByProject('default');
    expect(memories.length).toBe(1);
    // Compare normalised to handle Windows backslash vs forward slash
    const storedPath = (memories[0]?.source_path ?? '').replace(/\\/g, '/');
    expect(storedPath).toContain('readme.md');
  });

  it('stores source_hash on the created memory', async () => {
    await writeTmp('docs/readme.md', '# Readme\n\nContent here.');

    const scanner = new StellarScanner();
    await scanner.scanPath(tmpDir, { includeGit: false });

    const memories = getMemoriesByProject('default');
    expect(memories[0]?.source_hash).toBeDefined();
    expect(memories[0]?.source_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('processes JSON files', async () => {
    await writeTmp('config.json', JSON.stringify({ port: 3000, debug: true }));

    const scanner = new StellarScanner();
    const result  = await scanner.scanPath(tmpDir, { includeGit: false });

    expect(result.createdMemories).toBeGreaterThanOrEqual(1);
    const memories = getMemoriesByProject('default');
    expect(memories.some((m) => m.source_path?.endsWith('config.json'))).toBe(true);
  });

  it('handles an empty directory without error', async () => {
    const scanner = new StellarScanner();
    const result  = await scanner.scanPath(tmpDir, { includeGit: false });

    expect(result.scannedFiles).toBe(0);
    expect(result.createdMemories).toBe(0);
    expect(result.errorFiles).toBe(0);
  });

  it('sets memory distance and importance within valid ranges', async () => {
    await writeTmp('context/notes.md', '# Background Context\n\nSome background information.');

    const scanner = new StellarScanner();
    await scanner.scanPath(tmpDir, { includeGit: false });

    const memories = getMemoriesByProject('default');
    expect(memories[0]?.distance).toBeGreaterThanOrEqual(0.1);
    expect(memories[0]?.distance).toBeLessThanOrEqual(100);
    expect(memories[0]?.importance).toBeGreaterThanOrEqual(0);
    expect(memories[0]?.importance).toBeLessThanOrEqual(1);
  });
});
