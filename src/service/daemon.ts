/**
 * service/daemon.ts — Stellar Memory background daemon.
 *
 * Entry point when running `npm run daemon`.
 *
 * Responsibilities:
 *   - Initialise the SQLite database
 *   - Create the scheduler with default intervals
 *   - Handle SIGTERM / SIGINT for graceful shutdown
 *   - Expose status via exit code (0 = clean, 1 = error)
 */

import { initDatabase } from '../storage/database.js';
import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import {
  StellarScheduler,
  DEFAULT_SCHEDULE_CONFIG,
  type DaemonStatus,
  type TaskStatus,
  type ScheduledTask,
} from './scheduler.js';

const log = createLogger('daemon');

// ---------------------------------------------------------------------------
// StellarDaemon
// ---------------------------------------------------------------------------

export class StellarDaemon {
  private scheduler: StellarScheduler;
  private isRunning = false;
  private startedAt: Date | null = null;

  constructor() {
    this.scheduler = new StellarScheduler(DEFAULT_SCHEDULE_CONFIG);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Daemon already running');
      return;
    }

    const config = getConfig();
    log.info('Stellar Memory daemon starting', {
      project: config.defaultProject,
      db:      config.dbPath,
    });

    initDatabase(config.dbPath);
    this.scheduler.start();
    this.isRunning = true;
    this.startedAt = new Date();

    log.info('Stellar Memory daemon started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    log.info('Stellar Memory daemon stopping — waiting for in-progress tasks');
    this.scheduler.stop();
    this.isRunning = false;
    log.info('Stellar Memory daemon stopped cleanly');
  }

  status(): DaemonStatus {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      tasks:     this.scheduler.getStatus(),
    };
  }
}

// ---------------------------------------------------------------------------
// printStatus — human-readable daemon status table to stderr
// ---------------------------------------------------------------------------

function printStatus(status: DaemonStatus): void {
  const tasks = status.tasks as Record<ScheduledTask, TaskStatus>;
  const lines = [
    `[stellar-daemon] Running: ${status.isRunning}`,
    status.startedAt ? `[stellar-daemon] Started: ${status.startedAt.toISOString()}` : '',
    '[stellar-daemon] Tasks:',
    ...Object.entries(tasks).map(([name, t]) => {
      const last = t.lastRunAt ? t.lastRunAt.toISOString() : 'never';
      const dur  = t.lastDuration !== null ? `${t.lastDuration}ms` : '—';
      const err  = t.lastError ? ` ERR: ${t.lastError}` : '';
      return `  ${name.padEnd(22)} runs=${t.runCount} last=${last} dur=${dur}${err}`;
    }),
  ].filter(Boolean);

  for (const line of lines) {
    process.stderr.write(line + '\n');
  }
}

// ---------------------------------------------------------------------------
// main — run the daemon as a standalone process
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const daemon = new StellarDaemon();

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal} — shutting down gracefully`);
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  // Print status every 5 minutes to stderr for observability
  const statusInterval = setInterval(() => {
    printStatus(daemon.status());
  }, 5 * 60 * 1000);
  if (statusInterval.unref) statusInterval.unref();

  await daemon.start();
  printStatus(daemon.status());
}

main().catch(err => {
  console.error('[stellar-daemon] Fatal error:', err);
  process.exit(1);
});

// Re-export for use from other modules (e.g. MCP server tool)
export type { DaemonStatus };
