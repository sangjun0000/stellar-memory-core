import { opendir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { FileEntry, ScanConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Exclude-pattern matching (no external deps)
// ---------------------------------------------------------------------------

/**
 * Returns true if any segment of `filePath` matches any exclude pattern.
 * Supports simple glob wildcards (* and ?) via a regex conversion.
 */
export function isExcluded(filePath: string, patterns: string[]): boolean {
  // Normalise to forward slashes for consistent matching
  const normalised = filePath.replace(/\\/g, '/');
  const segments   = normalised.split('/');

  for (const pattern of patterns) {
    if (!pattern) continue;

    // Convert glob wildcard to regex
    const reSource = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars (except * and ?)
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const re = new RegExp(`^${reSource}$`, 'i');

    // Match against every path segment
    if (segments.some((seg) => re.test(seg))) return true;

    // Also match against the whole normalised path
    if (re.test(normalised)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Source hash
// ---------------------------------------------------------------------------

/**
 * Build a deterministic dedup hash from the file path and mtime.
 * We intentionally do NOT hash file content — that would be slow for large files.
 * mtime changes whenever the file is modified, which is sufficient for our dedup.
 */
export function buildSourceHash(filePath: string, mtimeMs: number): string {
  return createHash('sha1')
    .update(`${filePath}:${mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Recursive directory walker
// ---------------------------------------------------------------------------

/**
 * Recursively collect all files under `dirPath` that pass config filters.
 * Uses `opendir` (streaming, no giant readdir arrays) so it is memory-efficient.
 */
export async function collectFiles(
  dirPath: string,
  config: ScanConfig,
  _depth = 0,
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  // Guard: never descend into excluded directories
  if (isExcluded(dirPath, config.excludePatterns)) return entries;

  let dir;
  try {
    dir = await opendir(dirPath);
  } catch {
    // Permission denied or not a directory — skip silently
    return entries;
  }

  const extSet = new Set(config.fileExtensions.map((e) => e.toLowerCase()));

  for await (const dirent of dir) {
    const fullPath = join(dirPath, dirent.name);

    if (dirent.isDirectory()) {
      if (!isExcluded(dirent.name, config.excludePatterns)) {
        const sub = await collectFiles(fullPath, config, _depth + 1);
        entries.push(...sub);
      }
      continue;
    }

    if (!dirent.isFile()) continue;

    const ext = extname(dirent.name).toLowerCase();
    if (!extSet.has(ext)) continue;
    if (isExcluded(dirent.name, config.excludePatterns)) continue;
    if (isExcluded(fullPath, config.excludePatterns)) continue;

    // Stat to get size and mtime
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (fileStat.size === 0 || fileStat.size > config.maxFileSize) continue;

    entries.push({
      path:      fullPath,
      size:      fileStat.size,
      mtimeMs:   fileStat.mtimeMs,
      extension: ext,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// File content reader
// ---------------------------------------------------------------------------

/** Read a file as UTF-8 text. Returns null on error (binary, permission, etc.). */
export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath);

    // Quick binary-detection heuristic: if the first 8 KB contains a null byte,
    // treat it as binary and skip.
    const sample = buf.slice(0, 8192);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return null;
    }

    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File watcher (node:fs.watch wrapper)
// ---------------------------------------------------------------------------

import { watch as fsWatch } from 'node:fs';

export type WatchCallback = (event: 'add' | 'change' | 'rename', filePath: string) => void;

/**
 * Watch `dirPath` recursively using Node's built-in `fs.watch`.
 * Returns a cleanup function that stops watching when called.
 */
export function watchDirectory(
  dirPath: string,
  config: ScanConfig,
  callback: WatchCallback,
): () => void {
  const extSet = new Set(config.fileExtensions.map((e) => e.toLowerCase()));

  const watcher = fsWatch(dirPath, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const fullPath = join(dirPath, filename);
    const ext      = extname(filename).toLowerCase();

    if (!extSet.has(ext)) return;
    if (isExcluded(fullPath, config.excludePatterns)) return;

    const mapped: 'add' | 'change' | 'rename' = event === 'rename' ? 'rename' : 'change';
    callback(mapped, fullPath);
  });

  return () => watcher.close();
}

/** Collect all files and also return the base name of skipped/binary files for reporting. */
export async function collectFilesWithStats(
  dirPath: string,
  config: ScanConfig,
): Promise<{ entries: FileEntry[]; skippedCount: number }> {
  // We walk twice only to gather skip count — optimise by tracking inline
  let skippedCount = 0;

  async function walk(p: string): Promise<FileEntry[]> {
    const result: FileEntry[] = [];
    if (isExcluded(p, config.excludePatterns)) return result;

    let dir;
    try { dir = await opendir(p); } catch { return result; }

    const extSet = new Set(config.fileExtensions.map((e) => e.toLowerCase()));

    for await (const dirent of dir) {
      const fullPath = join(p, dirent.name);

      if (dirent.isDirectory()) {
        if (!isExcluded(dirent.name, config.excludePatterns)) {
          result.push(...(await walk(fullPath)));
        }
        continue;
      }
      if (!dirent.isFile()) continue;

      const ext = extname(dirent.name).toLowerCase();
      if (!extSet.has(ext) || isExcluded(dirent.name, config.excludePatterns) || isExcluded(fullPath, config.excludePatterns)) {
        skippedCount++;
        continue;
      }

      let fileStat;
      try { fileStat = await stat(fullPath); } catch { skippedCount++; continue; }

      if (fileStat.size === 0 || fileStat.size > config.maxFileSize) {
        skippedCount++;
        continue;
      }

      result.push({ path: fullPath, size: fileStat.size, mtimeMs: fileStat.mtimeMs, extension: ext });
    }
    return result;
  }

  const entries = await walk(dirPath);
  return { entries, skippedCount };
}

