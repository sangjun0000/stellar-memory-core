/**
 * metadata-scanner.ts — Fast file scanner using only fs.stat() metadata.
 *
 * Scans directories without reading file contents. Calculates importance
 * based on recency, file type, path location, and size. Designed to handle
 * an entire drive (C:\) in seconds rather than hours.
 */

import { opendir, stat } from 'node:fs/promises';
import { extname, basename, dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileMetaEntry {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
}

export interface MetaScanConfig {
  /** Root paths to scan (default: ['C:\\']) */
  paths: string[];
  /** Maximum directory depth (default: Infinity) */
  maxDepth?: number;
  /** AbortSignal to cancel scan */
  abortSignal?: AbortSignal;
}

type MetaScanCategory = 'core' | 'active' | 'archive' | 'forgotten';

// ---------------------------------------------------------------------------
// Classification sets
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.java', '.kt', '.kts',
  '.go',
  '.rs',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.scala',
  '.lua',
  '.sh', '.bash', '.zsh', '.ps1',
  '.sql',
  '.r', '.R',
  '.dart',
  '.vue', '.svelte',
]);

const DOC_EXTENSIONS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.pdf', '.txt', '.md', '.mdx', '.rst', '.rtf',
  '.odt', '.ods', '.odp',
  '.csv', '.tsv',
  '.tex', '.latex',
]);

const CONFIG_EXTENSIONS = new Set([
  '.env', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.xml', '.conf', '.config', '.properties',
  '.editorconfig', '.gitignore', '.gitattributes',
  '.eslintrc', '.prettierrc', '.babelrc',
]);

const DATA_EXTENSIONS = new Set([
  '.csv', '.sql', '.db', '.sqlite', '.sqlite3',
  '.parquet', '.avro', '.json', '.jsonl', '.ndjson',
  '.xls', '.xlsx',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.bmp', '.ico', '.tiff', '.tif',
  '.psd', '.ai', '.sketch', '.fig', '.xd',
]);

const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz',
  '.7z', '.rar', '.cab',
]);

const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.sys', '.msi', '.msp', '.msm',
  '.ocx', '.drv', '.cpl', '.scr',
  '.so', '.dylib', '.a', '.lib', '.obj', '.o',
  '.bin', '.dat', '.iso', '.img', '.vmdk', '.vhd',
  '.wasm',
]);

const MEDIA_EXTENSIONS = new Set([
  '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.wmv',
  '.flac', '.wav', '.ogg', '.aac', '.m4a',
  '.webm', '.flv', '.m4v',
]);

// ---------------------------------------------------------------------------
// Directory exclusion / classification patterns
// ---------------------------------------------------------------------------

/** Directories to completely skip (never enter) */
const SYSTEM_EXCLUDE_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log',
  'dumpstack.log.tmp',
  'recovery',
  'msocache',
  '$windows.~bt',
  '$windows.~ws',
  'config.msi',
]);

/** Additional dir names to exclude (deep caches / generated content) */
const CACHE_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.cache',
  '.npm',
  '.yarn',
  '.pnpm-store',
  '.cargo',
  '.rustup',
  '.gradle',
  '.m2',
  '.nuget',
  'packages',
  'obj',
  'bin',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.tox',
  '.venv',
  'venv',
  'env',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'coverage',
  '.nyc_output',
]);

/** Path segments that indicate game directories */
const GAME_DIR_PATTERNS = [
  'steam', 'steamapps', 'epic games', 'riot games',
  'ubisoft', 'origin', 'gog galaxy', 'battlenet',
  'ea games', 'rockstar games',
];

/** Path segments that indicate system directories */
const SYSTEM_PATH_SEGMENTS = [
  'windows', 'program files', 'program files (x86)',
  'programdata', 'appdata\\local\\temp',
  'winsxs', 'assembly',
];

/** Path segments that indicate user work directories */
const USER_WORK_SEGMENTS = [
  'documents', 'desktop', 'projects', 'source', 'repos',
  'workspace', 'dev', 'code', 'src', 'work',
  'downloads',
];

// ---------------------------------------------------------------------------
// Importance calculation
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function daysSince(mtimeMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - mtimeMs) / MS_PER_DAY);
}

/**
 * Determine if a path is inside a game directory.
 */
function isGamePath(lowerPath: string): boolean {
  return GAME_DIR_PATTERNS.some((p) => lowerPath.includes(p));
}

/**
 * Determine if a path is inside a system directory.
 */
function isSystemPath(lowerPath: string): boolean {
  return SYSTEM_PATH_SEGMENTS.some((p) => lowerPath.includes(p));
}

/**
 * Determine if a path is inside a user work directory.
 */
function isUserWorkPath(lowerPath: string): boolean {
  // Must be under Users/<username>/...
  const usersMatch = /[/\\]users[/\\][^/\\]+[/\\]/i.test(lowerPath);
  if (!usersMatch) return false;
  return USER_WORK_SEGMENTS.some((seg) => lowerPath.includes(seg));
}

/**
 * Calculate file importance (0.0–1.0) from metadata alone.
 *
 * Scoring factors:
 *   - recencyBonus:   0.00–0.35  (how recently modified)
 *   - typeBonus:      0.00–0.25  (file type category)
 *   - pathBonus:      0.00–0.20  (user work directory)
 *   - sizePenalty:    0.00–-0.50 (very large files penalized)
 *   - blacklist:      forces 0.05 for game/system paths
 */
export function calculateFileImportance(entry: FileMetaEntry, nowMs?: number): number {
  const now = nowMs ?? Date.now();
  const lowerPath = entry.path.toLowerCase().replace(/\\/g, '/');
  const ext = entry.extension.toLowerCase();

  // ── Blacklist: game/system → forced low importance ──
  if (isGamePath(lowerPath) || isSystemPath(lowerPath)) {
    return 0.05;
  }

  // ── Recency bonus (0.00 – 0.35) ──
  const days = daysSince(entry.mtimeMs, now);
  let recencyBonus: number;
  if (days <= 7)       recencyBonus = 0.35;
  else if (days <= 30) recencyBonus = 0.20;
  else if (days <= 90) recencyBonus = 0.10;
  else                 recencyBonus = 0.0;

  // ── Type bonus (0.00 – 0.25) ──
  let typeBonus: number;
  if (CODE_EXTENSIONS.has(ext) || CONFIG_EXTENSIONS.has(ext)) {
    typeBonus = 0.25;
  } else if (DOC_EXTENSIONS.has(ext)) {
    typeBonus = 0.25;
  } else if (DATA_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) {
    typeBonus = 0.10;
  } else if (ARCHIVE_EXTENSIONS.has(ext)) {
    typeBonus = 0.05;
  } else if (BINARY_EXTENSIONS.has(ext) || MEDIA_EXTENSIONS.has(ext)) {
    typeBonus = 0.0;
  } else {
    // Unknown extension — small baseline
    typeBonus = 0.05;
  }

  // ── Path bonus (0.00 – 0.20) ──
  const pathBonus = isUserWorkPath(lowerPath) ? 0.20 : 0.0;

  // ── Size penalty (0.00 – -0.50) ──
  const sizeMB = entry.size / (1024 * 1024);
  let sizePenalty: number;
  if (sizeMB >= 500)      sizePenalty = -0.50;
  else if (sizeMB >= 100) sizePenalty = -0.30;
  else if (sizeMB >= 50)  sizePenalty = -0.10;
  else                    sizePenalty = 0.0;

  const raw = recencyBonus + typeBonus + pathBonus + sizePenalty;
  return Math.min(1.0, Math.max(0.0, raw));
}

/**
 * Classify a file into a category based on importance.
 */
export function categorizeImportance(importance: number): MetaScanCategory {
  if (importance >= 0.45) return 'core';
  if (importance >= 0.25) return 'active';
  if (importance >= 0.10) return 'archive';
  return 'forgotten';
}

/**
 * Build a human-readable size string.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Directory scanner (streaming, no file reads)
// ---------------------------------------------------------------------------

function shouldExcludeDir(name: string): boolean {
  const lower = name.toLowerCase();
  return SYSTEM_EXCLUDE_DIRS.has(lower) || CACHE_EXCLUDE_DIRS.has(lower);
}

/**
 * Async generator that yields FileMetaEntry for every file found.
 *
 * Uses opendir() for streaming and stat() for metadata.
 * Never calls readFile(). Memory-efficient for 100k+ files.
 */
export async function* scanMetadata(
  config: MetaScanConfig,
): AsyncGenerator<FileMetaEntry> {
  const maxDepth = config.maxDepth ?? Infinity;

  async function* walkDir(dirPath: string, depth: number): AsyncGenerator<FileMetaEntry> {
    if (depth > maxDepth) return;
    if (config.abortSignal?.aborted) return;

    let dir;
    try {
      dir = await opendir(dirPath);
    } catch {
      // Permission denied, not a directory, etc. — skip silently.
      return;
    }

    try {
      for await (const dirent of dir) {
        if (config.abortSignal?.aborted) return;

        const entryName = dirent.name;
        const entryPath = resolve(dirPath, entryName);

        if (dirent.isDirectory()) {
          if (shouldExcludeDir(entryName)) continue;
          yield* walkDir(entryPath, depth + 1);
        } else if (dirent.isFile()) {
          try {
            const st = await stat(entryPath);
            yield {
              path: entryPath,
              name: entryName,
              extension: extname(entryName).toLowerCase(),
              size: st.size,
              mtimeMs: st.mtimeMs,
              isDirectory: false,
            };
          } catch {
            // stat failed (e.g. broken symlink) — skip
          }
        }
      }
    } catch {
      // readdir iteration error — skip
    }
  }

  for (const rootPath of config.paths) {
    yield* walkDir(resolve(rootPath), 0);
  }
}

/**
 * Build tags array from file metadata.
 */
export function buildTags(entry: FileMetaEntry): string[] {
  const tags: string[] = [];

  // Extension tag (without dot)
  if (entry.extension) {
    tags.push(entry.extension.slice(1));
  }

  // Parent folder name
  const parentDir = basename(dirname(entry.path));
  if (parentDir && parentDir !== '.' && parentDir !== entry.name) {
    tags.push(parentDir);
  }

  // Category tag
  const ext = entry.extension.toLowerCase();
  if (CODE_EXTENSIONS.has(ext))        tags.push('code');
  else if (DOC_EXTENSIONS.has(ext))    tags.push('document');
  else if (CONFIG_EXTENSIONS.has(ext)) tags.push('config');
  else if (DATA_EXTENSIONS.has(ext))   tags.push('data');
  else if (IMAGE_EXTENSIONS.has(ext))  tags.push('image');
  else if (MEDIA_EXTENSIONS.has(ext))  tags.push('media');
  else if (BINARY_EXTENSIONS.has(ext)) tags.push('binary');
  else if (ARCHIVE_EXTENSIONS.has(ext)) tags.push('archive');

  return tags;
}
