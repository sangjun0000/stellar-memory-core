/**
 * service/scheduler.ts — Stellar Memory background scheduler.
 *
 * Manages recurring tasks using setInterval (no external queue needed —
 * the process is long-lived and single-tenant).
 *
 * Tasks:
 *   - recalculateOrbits  : apply orbital physics (decay + gravity)
 *   - scanLocalFiles     : run the local file scanner on registered sources
 *   - scoreMemoryQuality : score quality of all memories
 *   - cleanupForgottenZone   : soft-delete memories in Forgotten zone older than threshold
 *
 * Design decisions:
 *   - Each task runs in isolation; a failure in one does not affect others.
 *   - On start() all timers fire once immediately (offset 0) then on schedule.
 *   - runNow() lets callers trigger any task out-of-band (e.g. from an MCP tool).
 *   - Graceful stop() waits for any in-progress task to finish before clearing.
 */

import { createLogger } from '../utils/logger.js';
import { recalculateOrbits } from '../engine/orbit.js';
import { getConfig } from '../utils/config.js';
import {
  getMemoriesInZone,
  softDeleteMemory,
  getAllDataSources,
  getMemoriesByProject,
  getAllProjects,
  purgeDeletedMemories,
  curateMemories,
} from '../storage/queries.js';
import { StellarScanner } from '../scanner/index.js';
import { scoreAllMemories } from '../engine/quality.js';
import { runConsolidation } from '../engine/consolidation.js';
import { detectProceduralPattern, createProceduralMemory, getProceduralMemories } from '../engine/procedural.js';

const log = createLogger('scheduler');

// ---------------------------------------------------------------------------
// ScheduleConfig
// ---------------------------------------------------------------------------

export interface ScheduleConfig {
  /** Orbital physics recalculation period (ms). Default: 1 hour */
  orbitRecalcInterval: number;
  /** Local file scan period (ms). Default: 30 minutes */
  localScanInterval: number;
  /** Oort cloud cleanup period (ms). Default: 24 hours */
  cleanupInterval: number;
  /** Quality scoring period (ms). Default: 4 hours */
  qualityScoringInterval: number;
  /** Memory consolidation period (ms). Default: 1 hour */
  consolidationInterval: number;
  /** Procedural pattern detection period (ms). Default: 12 hours */
  proceduralDetectionInterval: number;
  /** Project name used for orbit recalc and cleanup. Default: config.defaultProject */
  project?: string;
  /** How old (in days) an Oort memory must be before it is cleaned up. Default: 30 days */
  oortCleanupAgeDays?: number;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  orbitRecalcInterval:         60 * 60 * 1000,       // 1 hour
  localScanInterval:           30 * 60 * 1000,        // 30 min
  cleanupInterval:             24 * 60 * 60 * 1000,   // 24 hours
  qualityScoringInterval:      4  * 60 * 60 * 1000,   // 4 hours
  consolidationInterval:       1  * 60 * 60 * 1000,   // 1 hour
  proceduralDetectionInterval: 12 * 60 * 60 * 1000,   // 12 hours
  oortCleanupAgeDays:          30,
};

// ---------------------------------------------------------------------------
// Task names (used for runNow and logging)
// ---------------------------------------------------------------------------

export type ScheduledTask =
  | 'recalculateOrbits'
  | 'scanLocalFiles'
  | 'cleanupForgottenZone'
  | 'scoreMemoryQuality'
  | 'runConsolidation'
  | 'detectProceduralPatterns';

// ---------------------------------------------------------------------------
// DaemonStatus (re-exported for daemon.ts)
// ---------------------------------------------------------------------------

export interface DaemonStatus {
  isRunning: boolean;
  startedAt: Date | null;
  tasks: Record<ScheduledTask, TaskStatus>;
}

export interface TaskStatus {
  lastRunAt:    Date | null;
  lastDuration: number | null;  // ms
  lastError:    string | null;
  runCount:     number;
  isRunning:    boolean;
}

// ---------------------------------------------------------------------------
// StellarScheduler
// ---------------------------------------------------------------------------

export class StellarScheduler {
  private readonly config: Required<ScheduleConfig>;
  private timers: Map<ScheduledTask, ReturnType<typeof setInterval>> = new Map();
  private running = false;
  private taskStatus: Record<ScheduledTask, TaskStatus>;

  constructor(config: Partial<ScheduleConfig> = {}) {
    this.config = {
      ...DEFAULT_SCHEDULE_CONFIG,
      oortCleanupAgeDays: 30,
      project: getConfig().defaultProject,
      ...config,
    } as Required<ScheduleConfig>;

    this.taskStatus = {
      recalculateOrbits:       makeBlankStatus(),
      scanLocalFiles:          makeBlankStatus(),
      cleanupForgottenZone:        makeBlankStatus(),
      scoreMemoryQuality:      makeBlankStatus(),
      runConsolidation:        makeBlankStatus(),
      detectProceduralPatterns: makeBlankStatus(),
    };
  }

  // -------------------------------------------------------------------------
  // start / stop
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) {
      log.warn('Scheduler already running — ignoring duplicate start()');
      return;
    }

    this.running = true;
    log.info('Scheduler starting', {
      project:              this.config.project,
      orbitRecalcInterval:  this.config.orbitRecalcInterval,
      localScanInterval:    this.config.localScanInterval,
      cleanupInterval:      this.config.cleanupInterval,
    });

    this.schedule('recalculateOrbits', this.config.orbitRecalcInterval,
      () => this.recalculateOrbits());

    this.schedule('scanLocalFiles', this.config.localScanInterval,
      () => this.scanLocalFiles());

    this.schedule('cleanupForgottenZone', this.config.cleanupInterval,
      () => this.cleanupForgottenZone());

    this.schedule('scoreMemoryQuality', this.config.qualityScoringInterval,
      () => this.scoreMemoryQuality());

    this.schedule('runConsolidation', this.config.consolidationInterval,
      () => this.runConsolidationTask());

    this.schedule('detectProceduralPatterns', this.config.proceduralDetectionInterval,
      () => this.detectProceduralPatterns());
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const [task, timer] of this.timers) {
      clearInterval(timer);
      log.debug('Cleared timer', { task });
    }
    this.timers.clear();
    log.info('Scheduler stopped');
  }

  /** Run a specific task immediately (out-of-band). */
  async runNow(task: ScheduledTask): Promise<void> {
    log.info('Running task out-of-band', { task });
    await this.executeTask(task, this.getTaskFn(task));
  }

  /** Returns a snapshot of the current status for all tasks. */
  getStatus(): Record<ScheduledTask, TaskStatus> {
    return { ...this.taskStatus };
  }

  // -------------------------------------------------------------------------
  // Private — scheduling infrastructure
  // -------------------------------------------------------------------------

  private schedule(
    name: ScheduledTask,
    intervalMs: number,
    fn: () => Promise<void>,
  ): void {
    // Fire once immediately (async — do not block start())
    void this.executeTask(name, fn);

    const timer = setInterval(() => void this.executeTask(name, fn), intervalMs);
    // Allow Node.js to exit even if the timer is still pending
    if (timer.unref) timer.unref();

    this.timers.set(name, timer);
    log.debug('Scheduled task', { task: name, intervalMs });
  }

  private async executeTask(name: ScheduledTask, fn: () => Promise<void>): Promise<void> {
    if (this.taskStatus[name].isRunning) {
      log.warn('Task already running — skipping', { task: name });
      return;
    }

    this.taskStatus[name].isRunning = true;
    const start = Date.now();

    try {
      await fn();
      const duration = Date.now() - start;
      this.taskStatus[name] = {
        ...this.taskStatus[name],
        lastRunAt:    new Date(),
        lastDuration: duration,
        lastError:    null,
        runCount:     this.taskStatus[name].runCount + 1,
        isRunning:    false,
      };
      log.info('Task completed', { task: name, durationMs: duration });
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      this.taskStatus[name] = {
        ...this.taskStatus[name],
        lastRunAt:    new Date(),
        lastDuration: duration,
        lastError:    message,
        runCount:     this.taskStatus[name].runCount + 1,
        isRunning:    false,
      };
      log.error('Task failed', err instanceof Error ? err : new Error(message), { task: name });
    }
  }

  private getTaskFn(task: ScheduledTask): () => Promise<void> {
    switch (task) {
      case 'recalculateOrbits':       return () => this.recalculateOrbits();
      case 'scanLocalFiles':          return () => this.scanLocalFiles();
      case 'cleanupForgottenZone':        return () => this.cleanupForgottenZone();
      case 'scoreMemoryQuality':      return () => this.scoreMemoryQuality();
      case 'runConsolidation':        return () => this.runConsolidationTask();
      case 'detectProceduralPatterns': return () => this.detectProceduralPatterns();
    }
  }

  // -------------------------------------------------------------------------
  // Scheduled task implementations
  // -------------------------------------------------------------------------

  private async recalculateOrbits(): Promise<void> {
    const config  = getConfig();
    const changes = recalculateOrbits(this.config.project, config);
    log.info('Orbit recalculation complete', {
      project: this.config.project,
      changes: changes.length,
    });
  }

  private async scanLocalFiles(): Promise<void> {
    const sources = getAllDataSources();
    const localSources = sources.filter((ds) => ds.type === 'local' && ds.status !== 'error');

    if (localSources.length === 0) {
      log.debug('No local data sources registered — skipping scan');
      return;
    }

    log.info('Local file scan triggered', { sources: localSources.length });

    for (const ds of localSources) {
      try {
        const scanner = new StellarScanner({ paths: [ds.path] });
        const result  = await scanner.scan();
        log.info('Local scan complete', {
          path:    ds.path,
          created: result.createdMemories,
          skipped: result.skippedFiles,
          errors:  result.errorFiles,
        });
      } catch (err) {
        // Failure in one source must not prevent others from being scanned
        log.error(
          `Local scan failed for ${ds.path}`,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }
  }

  private async cleanupForgottenZone(): Promise<void> {
    // Process every project that has memories, not just the configured default.
    const projects = getAllProjects();
    const cutoff = new Date(
      Date.now() - this.config.oortCleanupAgeDays * 24 * 60 * 60 * 1000
    );

    let totalInspected = 0;
    let totalRemoved = 0;
    let totalPurged = 0;
    let totalCurated = 0;

    for (const project of projects) {
      // 1. Soft-delete stale Oort cloud (forgotten zone) memories
      const oortMemories = getMemoriesInZone(project, 'forgotten');
      let removed = 0;
      for (const memory of oortMemories) {
        const lastTouched = memory.last_accessed_at
          ? new Date(memory.last_accessed_at)
          : new Date(memory.created_at);

        if (lastTouched < cutoff) {
          softDeleteMemory(memory.id);
          removed++;
        }
      }
      totalInspected += oortMemories.length;
      totalRemoved += removed;

      // 2. Curate noisy / superseded / consolidated memories
      const curationResult = curateMemories(project);
      totalCurated += curationResult.deleted;

      // 3. Hard-delete soft-deleted memories older than oortCleanupAgeDays
      const purged = purgeDeletedMemories(project, this.config.oortCleanupAgeDays);
      totalPurged += purged;
    }

    log.info('Oort cloud cleanup complete', {
      projects:   projects.length,
      inspected:  totalInspected,
      softDeleted: totalRemoved,
      curated:    totalCurated,
      purged:     totalPurged,
      cutoffDays: this.config.oortCleanupAgeDays,
    });
  }

  private async scoreMemoryQuality(): Promise<void> {
    const result = scoreAllMemories(this.config.project);
    log.info('Quality scoring complete', {
      project:    this.config.project,
      scored:     result.scored,
      avgQuality: result.avgQuality.toFixed(3),
    });
  }

  private async runConsolidationTask(): Promise<void> {
    const result = await runConsolidation(this.config.project);
    log.info('Consolidation pass complete', {
      project:              this.config.project,
      groupsFound:          result.groupsFound,
      memoriesConsolidated: result.memoriesConsolidated,
      newMemoriesCreated:   result.newMemoriesCreated,
    });
  }

  private async detectProceduralPatterns(): Promise<void> {
    const memories = getMemoriesByProject(this.config.project);
    const patterns = detectProceduralPattern(memories, this.config.project);

    // Get existing procedural memories to avoid duplicates
    const existing = getProceduralMemories(this.config.project);
    const existingRules = new Set(existing.map(m => {
      const match = m.content.match(/^Rule:\s*(.+?)(\n|$)/);
      return match ? match[1].trim().toLowerCase() : m.summary.toLowerCase();
    }));

    let created = 0;
    for (const pattern of patterns) {
      const ruleKey = pattern.suggestedRule.toLowerCase();
      if (existingRules.has(ruleKey)) continue;

      const evidence = memories
        .filter(m => m.tags.some(t => pattern.pattern.includes(`"${t}"`)))
        .map(m => m.summary);

      try {
        createProceduralMemory(pattern.suggestedRule, evidence, this.config.project);
        existingRules.add(ruleKey);
        created++;
      } catch (err) {
        log.warn('Failed to create procedural memory', {
          pattern: pattern.pattern,
          error:   String(err),
        });
      }
    }

    log.info('Procedural pattern detection complete', {
      project:        this.config.project,
      patternsFound:  patterns.length,
      rulesCreated:   created,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlankStatus(): TaskStatus {
  return {
    lastRunAt:    null,
    lastDuration: null,
    lastError:    null,
    runCount:     0,
    isRunning:    false,
  };
}
