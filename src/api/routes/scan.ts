import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { homedir } from 'node:os';
import { StellarScanner, listDataSources, FULL_SCAN_EXTRA_EXCLUDES } from '../../scanner/index.js';
import type { ScanProgressEvent } from '../../scanner/index.js';
import { DEFAULT_SCAN_CONFIG } from '../../scanner/types.js';
import type { ScanConfig, ScanResult } from '../../scanner/types.js';
import {
  scanMetadata,
  calculateFileImportance,
  categorizeImportance,
  formatSize,
  buildTags,
} from '../../scanner/metadata-scanner.js';
import type { MetaScanConfig } from '../../scanner/metadata-scanner.js';
import { importanceToDistance } from '../../engine/orbit.js';
import { insertMemory, getMemoryBySourcePath, updateMemoryOrbit } from '../../storage/queries.js';
import { getConfig } from '../../utils/config.js';

// ---------------------------------------------------------------------------
// Module-level active scan state (prevents concurrent scans)
// ---------------------------------------------------------------------------

let activeScan: {
  abortController: AbortController;
  startedAt: number;
  progress: {
    scannedFiles: number;
    createdMemories: number;
    totalFiles: number;
    currentFile: string;
    percentComplete: number;
  };
} | null = null;

// ---------------------------------------------------------------------------
// POST /api/scan — trigger a one-shot directory scan (existing)
// ---------------------------------------------------------------------------

export const scanRouter = new Hono();

scanRouter.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const path = body.path as string | undefined;
  if (!path || !path.trim()) {
    return c.json({ ok: false, error: 'path is required' }, 400);
  }

  const recursive = body.recursive !== false; // default: true
  const git       = body.git !== false;       // default: true
  const maxKb     = body.max_kb as number | undefined;

  const scannerConfig: Partial<ScanConfig> = {};
  if (maxKb !== undefined && maxKb > 0) {
    scannerConfig.maxFileSize = maxKb * 1024;
  }

  const scanner = new StellarScanner(scannerConfig);

  try {
    const result = await scanner.scanPath(path.trim(), {
      recursive,
      includeGit: git,
    });

    return c.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/scan/full — SSE streaming full scan
// ---------------------------------------------------------------------------

scanRouter.post('/full', async (c) => {
  // Prevent concurrent scans
  if (activeScan) {
    return c.json({ ok: false, error: 'A scan is already in progress' }, 409);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const mode = (body.mode as string) ?? 'full';
  const paths = (body.paths as string[]) ?? [];
  const includeGit = body.includeGit !== false;

  if (mode === 'folders' && paths.length === 0) {
    return c.json({ ok: false, error: 'paths required when mode is "folders"' }, 400);
  }

  // Determine scan paths
  const scanPaths = mode === 'full' ? [homedir()] : paths;

  // Build scanner config with extra excludes for full scan
  const excludePatterns = mode === 'full'
    ? [...DEFAULT_SCAN_CONFIG.excludePatterns, ...FULL_SCAN_EXTRA_EXCLUDES]
    : DEFAULT_SCAN_CONFIG.excludePatterns;

  const scanner = new StellarScanner({ excludePatterns, paths: scanPaths });

  // Set up abort controller
  const abortController = new AbortController();
  activeScan = {
    abortController,
    startedAt: Date.now(),
    progress: {
      scannedFiles: 0,
      createdMemories: 0,
      totalFiles: 0,
      currentFile: '',
      percentComplete: 0,
    },
  };

  return streamSSE(c, async (stream) => {
    let lastEmitMs = 0;
    const THROTTLE_MS = 100;

    // Send start event
    await stream.writeSSE({
      event: 'scan:start',
      data: JSON.stringify({
        mode,
        paths: scanPaths,
        estimatedScope: mode === 'full' ? 'home directory' : `${paths.length} folder(s)`,
      }),
    });

    const onProgress = async (event: ScanProgressEvent) => {
      if (!activeScan) return;

      // Update module-level progress
      activeScan.progress.scannedFiles = event.scannedFiles ?? 0;
      activeScan.progress.createdMemories = event.createdMemories ?? 0;
      activeScan.progress.totalFiles = event.totalFiles ?? activeScan.progress.totalFiles;
      activeScan.progress.currentFile = event.currentFile ?? '';

      const total = activeScan.progress.totalFiles;
      activeScan.progress.percentComplete = total > 0
        ? Math.round(((event.scannedFiles ?? 0) / total) * 1000) / 10
        : 0;

      // Throttle SSE emissions
      const now = Date.now();
      if (event.phase === 'processing' && now - lastEmitMs < THROTTLE_MS) return;
      lastEmitMs = now;

      try {
        if (event.phase === 'collecting') {
          await stream.writeSSE({
            event: 'scan:progress',
            data: JSON.stringify({ phase: 'collecting', path: event.path }),
          });
        } else if (event.phase === 'collected') {
          await stream.writeSSE({
            event: 'scan:progress',
            data: JSON.stringify({
              phase: 'collected',
              path: event.path,
              totalFiles: event.totalFiles,
            }),
          });
        } else {
          await stream.writeSSE({
            event: 'scan:progress',
            data: JSON.stringify({
              scannedFiles: event.scannedFiles ?? 0,
              createdMemories: event.createdMemories ?? 0,
              totalFiles: activeScan.progress.totalFiles,
              currentFile: event.currentFile ?? '',
              percentComplete: activeScan.progress.percentComplete,
            }),
          });
        }
      } catch {
        // Stream closed by client — abort
        abortController.abort();
      }
    };

    try {
      const result: ScanResult = await scanner.scanWithProgress({
        paths: scanPaths,
        includeGit,
        onProgress,
        abortSignal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        await stream.writeSSE({
          event: 'scan:cancelled',
          data: JSON.stringify({
            totalScannedFiles: result.scannedFiles,
            totalCreatedMemories: result.createdMemories,
            durationMs: result.durationMs,
          }),
        });
      } else {
        await stream.writeSSE({
          event: 'scan:complete',
          data: JSON.stringify({
            totalScannedFiles: result.scannedFiles,
            totalCreatedMemories: result.createdMemories,
            totalSkippedFiles: result.skippedFiles,
            totalErrorFiles: result.errorFiles,
            durationMs: result.durationMs,
          }),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      try {
        await stream.writeSSE({
          event: 'scan:error',
          data: JSON.stringify({ error: message, fatal: true }),
        });
      } catch {
        // Stream already closed
      }
    } finally {
      activeScan = null;
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/scan/meta — metadata-only fast scan (SSE streaming)
// ---------------------------------------------------------------------------

scanRouter.post('/meta', async (c) => {
  // Prevent concurrent scans (shares lock with full scan)
  if (activeScan) {
    return c.json({ ok: false, error: 'A scan is already in progress' }, 409);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const paths = (body.paths as string[]) ?? ['C:\\'];

  // Set up abort controller
  const abortController = new AbortController();
  activeScan = {
    abortController,
    startedAt: Date.now(),
    progress: {
      scannedFiles: 0,
      createdMemories: 0,
      totalFiles: 0,
      currentFile: '',
      percentComplete: 0,
    },
  };

  const config = getConfig();

  return streamSSE(c, async (stream) => {
    let lastEmitMs = 0;
    const THROTTLE_MS = 50; // faster emission for metadata scan
    let scannedFiles = 0;
    let createdMemories = 0;
    const startMs = Date.now();

    // Send start event
    await stream.writeSSE({
      event: 'scan:start',
      data: JSON.stringify({
        mode: 'meta',
        paths,
        estimatedScope: `${paths.join(', ')} (metadata only)`,
      }),
    });

    const scanConfig: MetaScanConfig = {
      paths,
      abortSignal: abortController.signal,
    };

    try {
      for await (const entry of scanMetadata(scanConfig)) {
        if (abortController.signal.aborted) break;

        scannedFiles++;

        // Calculate importance from metadata
        const importance = calculateFileImportance(entry);
        const distance = importanceToDistance(importance);
        const category = categorizeImportance(importance);
        const tags = buildTags(entry);
        const mtime = new Date(entry.mtimeMs).toISOString();

        // Update module-level progress
        if (activeScan) {
          activeScan.progress.scannedFiles = scannedFiles;
          activeScan.progress.createdMemories = createdMemories;
          activeScan.progress.currentFile = entry.path;
        }

        // Check for existing memory by source_path (dedup)
        const existing = getMemoryBySourcePath(entry.path);
        if (existing) {
          // Update importance/distance if changed significantly
          if (Math.abs(existing.importance - importance) > 0.01) {
            const velocity = distance - existing.distance;
            updateMemoryOrbit(existing.id, distance, importance, velocity);
          }
        } else {
          // Create new memory
          insertMemory({
            project: config.defaultProject,
            content: entry.path,
            summary: `${entry.name} (${formatSize(entry.size)}, ${mtime.slice(0, 10)})`,
            type: 'context',
            tags,
            distance,
            importance,
            velocity: 0,
            impact: importance, // use importance as impact for meta-scanned files
            source: 'meta-scanner',
            source_path: entry.path,
            metadata: {
              size: entry.size,
              mtimeMs: entry.mtimeMs,
              extension: entry.extension,
              category,
            },
          });
          createdMemories++;
        }

        // Throttle SSE emissions
        const now = Date.now();
        if (now - lastEmitMs >= THROTTLE_MS) {
          lastEmitMs = now;
          try {
            await stream.writeSSE({
              event: 'scan:progress',
              data: JSON.stringify({
                scannedFiles,
                createdMemories,
                totalFiles: 0, // unknown for streaming scan
                currentFile: entry.path,
                percentComplete: 0, // indeterminate
              }),
            });
          } catch {
            // Stream closed by client — abort
            abortController.abort();
          }
        }
      }

      const durationMs = Date.now() - startMs;

      if (abortController.signal.aborted) {
        await stream.writeSSE({
          event: 'scan:cancelled',
          data: JSON.stringify({
            totalScannedFiles: scannedFiles,
            totalCreatedMemories: createdMemories,
            durationMs,
          }),
        });
      } else {
        await stream.writeSSE({
          event: 'scan:complete',
          data: JSON.stringify({
            totalScannedFiles: scannedFiles,
            totalCreatedMemories: createdMemories,
            totalSkippedFiles: 0,
            totalErrorFiles: 0,
            durationMs,
          }),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Meta scan failed';
      try {
        await stream.writeSSE({
          event: 'scan:error',
          data: JSON.stringify({ error: message, fatal: true }),
        });
      } catch {
        // Stream already closed
      }
    } finally {
      activeScan = null;
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/scan/status — check current scan status
// ---------------------------------------------------------------------------

scanRouter.get('/status', (c) => {
  if (!activeScan) {
    return c.json({ ok: true, data: { isScanning: false } });
  }

  return c.json({
    ok: true,
    data: {
      isScanning: true,
      startedAt: activeScan.startedAt,
      progress: { ...activeScan.progress },
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/scan/cancel — cancel an in-progress scan
// ---------------------------------------------------------------------------

scanRouter.post('/cancel', (c) => {
  if (!activeScan) {
    return c.json({ ok: false, error: 'No scan in progress' }, 404);
  }

  activeScan.abortController.abort();
  return c.json({ ok: true, message: 'Scan cancelled' });
});

// ---------------------------------------------------------------------------
// GET /api/sources — list all registered data sources
// ---------------------------------------------------------------------------

export const sourcesRouter = new Hono();

sourcesRouter.get('/', (c) => {
  try {
    const sources = listDataSources();
    return c.json({ ok: true, data: sources, total: sources.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list sources';
    return c.json({ ok: false, error: message }, 500);
  }
});
