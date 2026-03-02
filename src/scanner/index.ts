import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ScanConfig, ScanResult, FileEntry } from './types.js';
import { DEFAULT_SCAN_CONFIG } from './types.js';
import { collectFilesWithStats, readTextFile, buildSourceHash, watchDirectory } from './local/filesystem.js';
import { getParser } from './local/parsers/index.js';
import { scanGitHistory } from './local/git.js';
import {
  memoryExistsForSource,
  getMemoryBySourcePath,
  insertMemory,
  insertDataSource,
  updateDataSource,
  getAllDataSources,
  getDataSourceByPath,
} from '../storage/queries.js';
import type { MemoryType } from '../engine/types.js';
import { IMPACT_DEFAULTS } from '../engine/types.js';
import {
  recencyScore,
  frequencyScore,
  importanceToDistance,
} from '../engine/orbit.js';
import { getConfig } from '../utils/config.js';

// ---------------------------------------------------------------------------
// Progress event type for scanWithProgress()
// ---------------------------------------------------------------------------

export type ScanProgressEvent = {
  phase: 'collecting' | 'collected' | 'processing' | 'path_complete';
  path: string;
  currentFile?: string;
  totalFiles?: number;
  scannedFiles?: number;
  createdMemories?: number;
  skippedFiles?: number;
  errorFiles?: number;
};

// Full-scan exclude patterns (home directory scan)
export const FULL_SCAN_EXTRA_EXCLUDES = [
  'AppData', 'Application Data', '.npm', '.yarn', '.pnpm-store',
  '.docker', '.gradle', '.m2', 'Temp', 'tmp', '.Trash', '.local',
  'Library', 'Pictures', 'Videos', 'Music', 'Downloads', 'Desktop',
  'OneDrive', '$Recycle.Bin', 'System Volume Information',
  'ProgramData', 'Program Files', 'Program Files (x86)', 'Windows',
];

// ---------------------------------------------------------------------------
// StellarScanner
// ---------------------------------------------------------------------------

export class StellarScanner {
  private readonly config: ScanConfig;
  private stopWatchers: Array<() => void> = [];

  constructor(config: Partial<ScanConfig> = {}) {
    this.config = {
      ...DEFAULT_SCAN_CONFIG,
      ...config,
      // Merge array overrides rather than replacing defaults entirely
      excludePatterns: config.excludePatterns ?? DEFAULT_SCAN_CONFIG.excludePatterns,
      fileExtensions:  config.fileExtensions  ?? DEFAULT_SCAN_CONFIG.fileExtensions,
    };
  }

  // -------------------------------------------------------------------------
  // scan() — one-shot scan of all configured paths
  // -------------------------------------------------------------------------

  async scan(): Promise<ScanResult> {
    const startMs = Date.now();
    let scannedFiles   = 0;
    let createdMemories = 0;
    let skippedFiles   = 0;
    let errorFiles     = 0;

    const cfg      = getConfig();
    const project  = cfg.defaultProject;

    for (const scanPath of this.config.paths) {
      const absPath = resolve(scanPath);

      // Register or update data source record
      await this._ensureDataSource(absPath);

      // Collect files
      const { entries, skippedCount } = await collectFilesWithStats(absPath, this.config);
      skippedFiles += skippedCount;

      // Process each file
      for (const entry of entries) {
        scannedFiles++;
        const result = await this._processFile(entry, project);
        if (result === 'created')  createdMemories++;
        else if (result === 'skip') skippedFiles++;
        else                        errorFiles++;
      }

      // Update data source stats
      const ds = getDataSourceByPath(absPath);
      if (ds) {
        updateDataSource(ds.id, {
          status: 'active',
          last_scanned_at: new Date().toISOString(),
          file_count: entries.length,
          total_size: entries.reduce((sum, e) => sum + e.size, 0),
        });
      }
    }

    // Git history scanning (if a configured path is a git repo)
    for (const scanPath of this.config.paths) {
      const absPath = resolve(scanPath);
      createdMemories += this._insertGitMemories(absPath, project);
    }

    return {
      scannedFiles,
      createdMemories,
      skippedFiles,
      errorFiles,
      durationMs: Date.now() - startMs,
    };
  }

  // -------------------------------------------------------------------------
  // scanPath() — scan a single directory path (used by MCP tool)
  // -------------------------------------------------------------------------

  async scanPath(
    dirPath: string,
    opts: { recursive?: boolean; includeGit?: boolean } = {},
  ): Promise<ScanResult> {
    const absPath = resolve(dirPath);
    const startMs = Date.now();
    let scannedFiles   = 0;
    let createdMemories = 0;
    let skippedFiles   = 0;
    let errorFiles     = 0;

    const cfg     = getConfig();
    const project = cfg.defaultProject;

    await this._ensureDataSource(absPath);

    const localConfig: ScanConfig = { ...this.config };
    if (opts.recursive === false) {
      // Non-recursive: override with a sentinel — collectFiles checks for it
      localConfig.paths = [absPath];
    }

    const { entries, skippedCount } = await collectFilesWithStats(absPath, localConfig);
    skippedFiles += skippedCount;

    for (const entry of entries) {
      scannedFiles++;
      const result = await this._processFile(entry, project);
      if (result === 'created')  createdMemories++;
      else if (result === 'skip') skippedFiles++;
      else                        errorFiles++;
    }

    const ds = getDataSourceByPath(absPath);
    if (ds) {
      updateDataSource(ds.id, {
        status: 'active',
        last_scanned_at: new Date().toISOString(),
        file_count: entries.length,
        total_size: entries.reduce((sum, e) => sum + e.size, 0),
      });
    }

    if (opts.includeGit !== false) {
      createdMemories += this._insertGitMemories(absPath, project);
    }

    return {
      scannedFiles,
      createdMemories,
      skippedFiles,
      errorFiles,
      durationMs: Date.now() - startMs,
    };
  }

  // -------------------------------------------------------------------------
  // scanWithProgress() — scan with progress callbacks + abort support
  // -------------------------------------------------------------------------

  async scanWithProgress(opts: {
    paths?: string[];
    includeGit?: boolean;
    onProgress: (event: ScanProgressEvent) => void;
    abortSignal?: AbortSignal;
  }): Promise<ScanResult> {
    const startMs = Date.now();
    let scannedFiles = 0;
    let createdMemories = 0;
    let skippedFiles = 0;
    let errorFiles = 0;

    const cfg = getConfig();
    const project = cfg.defaultProject;
    const scanPaths = opts.paths && opts.paths.length > 0
      ? opts.paths
      : this.config.paths;

    for (const scanPath of scanPaths) {
      if (opts.abortSignal?.aborted) break;

      const absPath = resolve(scanPath);

      opts.onProgress({ phase: 'collecting', path: absPath });

      await this._ensureDataSource(absPath);

      const { entries, skippedCount } = await collectFilesWithStats(absPath, this.config);
      skippedFiles += skippedCount;

      opts.onProgress({
        phase: 'collected',
        path: absPath,
        totalFiles: entries.length,
      });

      for (const entry of entries) {
        if (opts.abortSignal?.aborted) break;

        scannedFiles++;
        opts.onProgress({
          phase: 'processing',
          path: absPath,
          currentFile: entry.path,
          totalFiles: entries.length,
          scannedFiles,
          createdMemories,
          skippedFiles,
          errorFiles,
        });

        const result = await this._processFile(entry, project);
        if (result === 'created') createdMemories++;
        else if (result === 'skip') skippedFiles++;
        else errorFiles++;
      }

      // Update data source stats
      const ds = getDataSourceByPath(absPath);
      if (ds) {
        updateDataSource(ds.id, {
          status: 'active',
          last_scanned_at: new Date().toISOString(),
          file_count: entries.length,
          total_size: entries.reduce((sum, e) => sum + e.size, 0),
        });
      }

      opts.onProgress({
        phase: 'path_complete',
        path: absPath,
        scannedFiles,
        createdMemories,
        skippedFiles,
        errorFiles,
      });
    }

    // Git history scanning
    if (opts.includeGit !== false && !opts.abortSignal?.aborted) {
      for (const scanPath of scanPaths) {
        if (opts.abortSignal?.aborted) break;
        const absPath = resolve(scanPath);
        createdMemories += this._insertGitMemories(absPath, project);
      }
    }

    return {
      scannedFiles,
      createdMemories,
      skippedFiles,
      errorFiles,
      durationMs: Date.now() - startMs,
    };
  }

  // -------------------------------------------------------------------------
  // watch() — start watching all configured paths for changes
  // -------------------------------------------------------------------------

  watch(): void {
    const cfg     = getConfig();
    const project = cfg.defaultProject;

    for (const scanPath of this.config.paths) {
      const absPath = resolve(scanPath);
      const stop    = watchDirectory(absPath, this.config, async (_event, filePath) => {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        const parser = getParser(ext);
        if (!parser) return;

        try {
          const stat = await import('node:fs/promises').then((m) => m.stat(filePath));
          const entry: FileEntry = {
            path:      filePath,
            size:      stat.size,
            mtimeMs:   stat.mtimeMs,
            extension: ext,
          };
          await this._processFile(entry, project);
        } catch {
          // Ignore watcher errors
        }
      });

      this.stopWatchers.push(stop);
    }
  }

  // -------------------------------------------------------------------------
  // stop() — stop all file watchers
  // -------------------------------------------------------------------------

  stop(): void {
    for (const stop of this.stopWatchers) stop();
    this.stopWatchers = [];
  }

  // -------------------------------------------------------------------------
  // Private: process one file entry
  // -------------------------------------------------------------------------

  private async _processFile(
    entry: FileEntry,
    project: string,
  ): Promise<'created' | 'skip' | 'error'> {
    const parser = getParser(entry.extension);
    if (!parser) return 'skip';

    const sourceHash = buildSourceHash(entry.path, entry.mtimeMs);

    // Dedup check: same path + same mtime hash → skip
    if (memoryExistsForSource(entry.path, sourceHash)) return 'skip';

    // Check if there's an older memory for this path — soft-delete it so the
    // FTS index stays tidy, then create a fresh one.
    const existing = getMemoryBySourcePath(entry.path);

    const content = await readTextFile(entry.path);
    if (content === null) return 'skip'; // binary or unreadable

    let parsed;
    try {
      parsed = parser.parse(entry.path, content);
    } catch {
      return 'error';
    }

    if (existing) {
      // Reuse the existing memory's position / importance rather than starting fresh.
      // We update the stored memory inline to avoid polluting the orbit log.
      try {
        const db = await import('../storage/database.js').then((m) => m.getDatabase());
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE memories
          SET content = ?, summary = ?, tags = ?, metadata = ?,
              source_hash = ?, updated_at = ?
          WHERE id = ?
        `).run(
          parsed.content,
          parsed.summary,
          JSON.stringify(parsed.tags),
          JSON.stringify({ ...parsed.metadata }),
          sourceHash,
          now,
          existing.id,
        );
        return 'created'; // "created" in the sense of "produced an up-to-date memory"
      } catch {
        return 'error';
      }
    }

    // Brand-new file — create a fresh memory planet using insertMemory directly
    // so we can pass scanner-specific source fields (source, source_path, source_hash).
    try {
      const cfg       = getConfig();
      const type      = parsed.type as MemoryType;
      const impact    = IMPACT_DEFAULTS[type] ?? 0.35;
      const now       = new Date().toISOString();
      const rec       = recencyScore(null, now, cfg.decayHalfLifeHours);
      const freq      = frequencyScore(0, cfg.frequencySaturationPoint);
      const importance = Math.min(
        1.0,
        cfg.weights.recency   * rec   +
        cfg.weights.frequency * freq  +
        cfg.weights.impact    * impact +
        cfg.weights.relevance * 0,
      );
      const distance = importanceToDistance(importance);

      const raw  = parsed.content.trim();
      const summary = parsed.summary
        ? parsed.summary
        : raw.slice(0, 50).trimEnd() + (raw.length > 50 ? '\u2026' : '');

      insertMemory({
        id:              randomUUID(),
        project,
        content:         parsed.content,
        summary,
        type,
        tags:            parsed.tags,
        distance,
        importance,
        velocity:        0,
        impact,
        access_count:    0,
        last_accessed_at: null,
        metadata:        parsed.metadata,
        source:          'scanner',
        source_path:     entry.path,
        source_hash:     sourceHash,
        created_at:      now,
        updated_at:      now,
        deleted_at:      null,
      });
      return 'created';
    } catch {
      return 'error';
    }
  }

  // -------------------------------------------------------------------------
  // Private: insert git commit memories using insertMemory directly
  // -------------------------------------------------------------------------

  private _insertGitMemories(repoPath: string, project: string): number {
    const gitMemories = scanGitHistory(repoPath, 50);
    const cfg = getConfig();
    let count = 0;

    for (const mem of gitMemories) {
      try {
        const type     = mem.type as MemoryType;
        const impact   = IMPACT_DEFAULTS[type] ?? 0.5;
        const now      = new Date().toISOString();
        const rec      = recencyScore(null, now, cfg.decayHalfLifeHours);
        const freq     = frequencyScore(0, cfg.frequencySaturationPoint);
        const importance = Math.min(
          1.0,
          cfg.weights.recency   * rec   +
          cfg.weights.frequency * freq  +
          cfg.weights.impact    * impact +
          cfg.weights.relevance * 0,
        );
        const distance = importanceToDistance(importance);

        insertMemory({
          id:              randomUUID(),
          project,
          content:         mem.content,
          summary:         mem.summary,
          type,
          tags:            mem.tags,
          distance,
          importance,
          velocity:        0,
          impact,
          access_count:    0,
          last_accessed_at: null,
          metadata:        mem.metadata,
          source:          'git',
          source_path:     repoPath,
          source_hash:     null,
          created_at:      now,
          updated_at:      now,
          deleted_at:      null,
        });
        count++;
      } catch {
        // Best-effort
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Private: ensure a data_sources row exists for a path
  // -------------------------------------------------------------------------

  private async _ensureDataSource(absPath: string): Promise<void> {
    const existing = getDataSourceByPath(absPath);
    if (existing) return;

    insertDataSource({
      id:              randomUUID(),
      path:            absPath,
      type:            'local',
      status:          'active',
      last_scanned_at: null,
      file_count:      0,
      total_size:      0,
      config:          this.config,
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience: list all registered sources
// ---------------------------------------------------------------------------

export function listDataSources() {
  return getAllDataSources();
}
