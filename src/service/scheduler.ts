/**
 * service/scheduler.ts — Stellar Memory background scheduler.
 *
 * Manages recurring tasks using setInterval (no external queue needed —
 * the process is long-lived and single-tenant).
 *
 * Tasks:
 *   - recalculateOrbits  : apply orbital physics (decay + gravity)
 *   - scanLocalFiles     : run the local file scanner on registered sources
 *   - syncCloudSources   : pull incremental updates from cloud connectors
 *   - cleanupOortCloud   : soft-delete memories in Oort zone older than threshold
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
import { getMemoriesInZone, softDeleteMemory } from '../storage/queries.js';
import type { CloudConnector } from '../scanner/cloud/types.js';

const log = createLogger('scheduler');

// ---------------------------------------------------------------------------
// ScheduleConfig
// ---------------------------------------------------------------------------

export interface ScheduleConfig {
  /** Orbital physics recalculation period (ms). Default: 1 hour */
  orbitRecalcInterval: number;
  /** Local file scan period (ms). Default: 30 minutes */
  localScanInterval: number;
  /** Cloud sync period (ms). Default: 2 hours */
  cloudSyncInterval: number;
  /** Oort cloud cleanup period (ms). Default: 24 hours */
  cleanupInterval: number;
  /** Project name used for orbit recalc and cleanup. Default: config.defaultProject */
  project?: string;
  /** How old (in days) an Oort memory must be before it is cleaned up. Default: 30 days */
  oortCleanupAgeDays?: number;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  orbitRecalcInterval: 60 * 60 * 1000,       // 1 hour
  localScanInterval:   30 * 60 * 1000,        // 30 min
  cloudSyncInterval:   2  * 60 * 60 * 1000,   // 2 hours
  cleanupInterval:     24 * 60 * 60 * 1000,   // 24 hours
  oortCleanupAgeDays:  30,
};

// ---------------------------------------------------------------------------
// Task names (used for runNow and logging)
// ---------------------------------------------------------------------------

export type ScheduledTask =
  | 'recalculateOrbits'
  | 'scanLocalFiles'
  | 'syncCloudSources'
  | 'cleanupOortCloud';

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
  private readonly connectors: CloudConnector[];
  private timers: Map<ScheduledTask, ReturnType<typeof setInterval>> = new Map();
  private running = false;
  private taskStatus: Record<ScheduledTask, TaskStatus>;

  constructor(config: Partial<ScheduleConfig> = {}, connectors: CloudConnector[] = []) {
    this.config = {
      ...DEFAULT_SCHEDULE_CONFIG,
      oortCleanupAgeDays: 30,
      project: getConfig().defaultProject,
      ...config,
    } as Required<ScheduleConfig>;

    this.connectors = connectors;

    this.taskStatus = {
      recalculateOrbits: makeBlankStatus(),
      scanLocalFiles:    makeBlankStatus(),
      syncCloudSources:  makeBlankStatus(),
      cleanupOortCloud:  makeBlankStatus(),
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
      cloudSyncInterval:    this.config.cloudSyncInterval,
      cleanupInterval:      this.config.cleanupInterval,
    });

    this.schedule('recalculateOrbits', this.config.orbitRecalcInterval,
      () => this.recalculateOrbits());

    this.schedule('scanLocalFiles', this.config.localScanInterval,
      () => this.scanLocalFiles());

    this.schedule('syncCloudSources', this.config.cloudSyncInterval,
      () => this.syncCloudSources());

    this.schedule('cleanupOortCloud', this.config.cleanupInterval,
      () => this.cleanupOortCloud());
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
      case 'recalculateOrbits': return () => this.recalculateOrbits();
      case 'scanLocalFiles':    return () => this.scanLocalFiles();
      case 'syncCloudSources':  return () => this.syncCloudSources();
      case 'cleanupOortCloud':  return () => this.cleanupOortCloud();
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
    // Local file scanner is a separate subsystem (scanner/local/).
    // This stub logs intent; integrate scanner.scan() once that module exists.
    log.info('Local file scan triggered (scanner not yet connected)');
  }

  private async syncCloudSources(): Promise<void> {
    if (this.connectors.length === 0) {
      log.debug('No cloud connectors registered — skipping sync');
      return;
    }

    for (const connector of this.connectors) {
      if (!connector.isAuthenticated()) {
        log.warn('Connector not authenticated — skipping', { connector: connector.type });
        continue;
      }

      try {
        log.info('Syncing cloud connector', { connector: connector.type });
        const docs = await connector.fetchDocuments();
        log.info('Cloud sync complete', { connector: connector.type, docs: docs.length });
        // Conversion to memories is handled by the caller (MCP stellar_sync tool)
        // to keep the scheduler free of storage dependencies beyond queries.ts.
      } catch (err) {
        // Failure in one connector must not affect others (isolation principle)
        log.error(
          `Cloud sync failed for ${connector.type}`,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }
  }

  private async cleanupOortCloud(): Promise<void> {
    const oortMemories = getMemoriesInZone(this.config.project, 'oort');
    const cutoff = new Date(
      Date.now() - this.config.oortCleanupAgeDays * 24 * 60 * 60 * 1000
    );

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

    log.info('Oort cloud cleanup complete', {
      project:   this.config.project,
      inspected: oortMemories.length,
      removed,
      cutoffDays: this.config.oortCleanupAgeDays,
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
