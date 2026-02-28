import type { MemoryType } from '../engine/types.js';

// ---------------------------------------------------------------------------
// DataSource — a registered directory (or cloud source) to scan
// ---------------------------------------------------------------------------

export interface DataSource {
  id: string;
  path: string;
  type: 'local' | 'cloud';
  status: 'active' | 'paused' | 'error';
  last_scanned_at: string | null;
  file_count: number;
  total_size: number;
  config: ScanConfig;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// ScanConfig — options for a single scan run
// ---------------------------------------------------------------------------

export interface ScanConfig {
  paths: string[];
  excludePatterns: string[];
  fileExtensions: string[];
  maxFileSize: number;   // bytes
  watchMode: boolean;
}

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  paths: [],
  excludePatterns: [
    'node_modules', '.git', '.svn', 'dist', 'build', '.next',
    '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.nyc_output',
    '*.min.js', '*.min.css', '*.lock', 'package-lock.json', 'yarn.lock',
    'pnpm-lock.yaml',
  ],
  fileExtensions: [
    '.md', '.mdx', '.txt', '.log',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h',
    '.json', '.jsonl', '.yaml', '.yml', '.toml',
    '.sh', '.bash', '.zsh',
  ],
  maxFileSize: 1_048_576, // 1 MB
  watchMode: false,
};

// ---------------------------------------------------------------------------
// ParsedContent — output of any FileParser
// ---------------------------------------------------------------------------

export interface ParsedContent {
  title: string;
  summary: string;
  content: string;
  type: MemoryType;
  tags: string[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// FileParser — interface all parsers must implement
// ---------------------------------------------------------------------------

export interface FileParser {
  extensions: string[];
  parse(filePath: string, content: string): ParsedContent;
}

// ---------------------------------------------------------------------------
// FileEntry — metadata collected during directory traversal
// ---------------------------------------------------------------------------

export interface FileEntry {
  path: string;          // absolute path
  size: number;          // bytes
  mtimeMs: number;       // mtime as milliseconds since epoch
  extension: string;     // lowercase, including dot
}

// ---------------------------------------------------------------------------
// ScanResult — summary returned after a scan completes
// ---------------------------------------------------------------------------

export interface ScanResult {
  scannedFiles: number;
  createdMemories: number;
  skippedFiles: number;   // already up-to-date or excluded
  errorFiles: number;
  durationMs: number;
}
