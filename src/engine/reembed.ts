/**
 * reembed.ts — Background re-embedding queue
 *
 * When the embedding model is upgraded (e.g. from 384d to 1024d), the vec
 * tables are cleared. This module re-generates embeddings for all memories
 * that currently lack one, processing them in priority order (highest
 * importance first) in small batches to stay non-blocking.
 *
 * Memory management:
 *   - Batch size is kept small (10) to limit peak memory.
 *   - Between batches, we hint V8 to garbage-collect (if --expose-gc).
 *   - RSS is monitored; if it exceeds the RAM cap, we pause and GC.
 *   - Batch delay is longer (500ms) to give the OS time to reclaim pages.
 *
 * Usage:
 *   startReembedding();          // kick off the background queue
 *   getReembeddingStatus();      // poll for current progress
 */

import { getDatabase } from '../storage/database.js';
import { insertEmbedding } from '../storage/vec.js';
import { generateEmbedding, generateEmbeddingCpu } from './embedding.js';

// ---------------------------------------------------------------------------
// Memory management constants
// ---------------------------------------------------------------------------

/** Max RSS in bytes before we force a GC pause (default: 2 GB) */
const MAX_RSS_BYTES = parseInt(
  process.env['STELLAR_REEMBED_MAX_RSS_MB'] ?? '2048', 10
) * 1024 * 1024;

/** Batch size: smaller = less peak memory, more overhead */
const BATCH_SIZE = 10;

/** Delay between batches in ms — gives GC and OS time to reclaim */
const BATCH_DELAY_MS = 500;

/** Extra pause when RSS exceeds the cap, to let GC work */
const GC_PAUSE_MS = 2000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ReembedStatus {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  startedAt: Date | null;
}

const _status: ReembedStatus = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  startedAt: null,
};

/** Returns a snapshot of the current re-embedding progress. */
export function getReembeddingStatus(): Readonly<ReembedStatus> {
  return { ..._status };
}

// ---------------------------------------------------------------------------
// Memory helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to trigger garbage collection.
 * Requires the process to have been started with --expose-gc,
 * otherwise this is a no-op.
 */
function tryGC(): void {
  if (typeof globalThis.gc === 'function') {
    try { globalThis.gc(); } catch { /* ignore */ }
  }
}

/** Returns current RSS in bytes. */
function getRSS(): number {
  return process.memoryUsage.rss();
}

/** Format bytes as a human-readable string. */
function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

/**
 * Find memories that have no entry in memory_embedding_map, ordered by
 * importance descending so the most critical memories are embedded first.
 */
function getUnembeddedBatch(): Array<{ id: string; content: string; summary: string }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT m.id, m.content, m.summary
    FROM memories m
    LEFT JOIN memory_embedding_map map ON map.memory_id = m.id
    WHERE map.memory_id IS NULL
      AND m.deleted_at IS NULL
    ORDER BY m.importance DESC
    LIMIT ?
  `).all(BATCH_SIZE) as Array<{ id: string; content: string; summary: string }>;
}

function countUnembedded(): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM memories m
    LEFT JOIN memory_embedding_map map ON map.memory_id = m.id
    WHERE map.memory_id IS NULL
      AND m.deleted_at IS NULL
  `).get() as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

/**
 * Start the background re-embedding queue.
 * Safe to call multiple times — will no-op if already running.
 */
export function startReembedding(): void {
  if (_status.running) return;

  _status.running = true;
  _status.startedAt = new Date();
  _status.done = 0;
  _status.failed = 0;
  _status.total = countUnembedded();

  if (_status.total === 0) {
    _status.running = false;
    return;
  }

  process.stderr.write(
    `[stellar-memory] Re-embedding ${_status.total} memories for new model ` +
    `(batch=${BATCH_SIZE}, maxRSS=${formatMB(MAX_RSS_BYTES)})...\n`
  );

  // Run the queue asynchronously so it doesn't block server startup.
  void _runQueue();
}

async function _runQueue(): Promise<void> {
  const db = getDatabase();

  while (true) {
    const batch = getUnembeddedBatch();
    if (batch.length === 0) break;

    for (const mem of batch) {
      try {
        // Embed content + summary concatenation for richer representation
        const text = mem.summary
          ? `${mem.summary}\n\n${mem.content}`
          : mem.content;

        const embedding = await generateEmbeddingCpu(text);
        insertEmbedding(db, mem.id, embedding);
        _status.done++;
      } catch (err) {
        _status.failed++;
        process.stderr.write(
          `[stellar-memory] Re-embed failed for ${mem.id}: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }

    // Log progress every batch
    const pct = _status.total > 0
      ? Math.round((_status.done / _status.total) * 100)
      : 100;
    const rss = getRSS();
    process.stderr.write(
      `[stellar-memory] Re-embedding progress: ${_status.done}/${_status.total} (${pct}%)` +
      `${_status.failed > 0 ? ` [${_status.failed} failed]` : ''}` +
      ` | RSS: ${formatMB(rss)}\n`
    );

    // Memory pressure check: if RSS exceeds cap, GC and pause longer
    if (rss > MAX_RSS_BYTES) {
      process.stderr.write(
        `[stellar-memory] RSS ${formatMB(rss)} exceeds cap ${formatMB(MAX_RSS_BYTES)}, pausing for GC...\n`
      );
      tryGC();
      await sleep(GC_PAUSE_MS);
    } else {
      // Hint GC between batches even when under the cap
      tryGC();
    }

    // Yield between batches to stay non-blocking and let memory settle
    await sleep(BATCH_DELAY_MS);
  }

  // Final GC after all embeddings are done
  tryGC();

  _status.running = false;
  process.stderr.write(
    `[stellar-memory] Re-embedding complete: ${_status.done} embedded, ${_status.failed} failed.\n`
  );
}
