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
 *
 * Cloud connectors are injected at startup from environment variables
 * following the convention STELLAR_<SERVICE>_<CREDENTIAL>=value.
 *
 * Supported env vars for automatic connector activation:
 *
 *   Google Drive (Service Account):
 *     STELLAR_GDRIVE_CLIENT_EMAIL
 *     STELLAR_GDRIVE_PRIVATE_KEY
 *
 *   Google Drive (OAuth2):
 *     STELLAR_GDRIVE_CLIENT_ID
 *     STELLAR_GDRIVE_CLIENT_SECRET
 *     STELLAR_GDRIVE_REFRESH_TOKEN
 *
 *   Notion:
 *     STELLAR_NOTION_API_KEY
 *
 *   GitHub:
 *     STELLAR_GITHUB_PAT
 *     STELLAR_GITHUB_REPOS (optional CSV)
 *
 *   Slack:
 *     STELLAR_SLACK_BOT_TOKEN
 *     STELLAR_SLACK_INCLUDE_DMS (optional, 'true'/'false')
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
import type { CloudConnector } from '../scanner/cloud/types.js';
import { GoogleDriveConnector } from '../scanner/cloud/google-drive.js';
import { NotionConnector }      from '../scanner/cloud/notion.js';
import { GitHubConnector }      from '../scanner/cloud/github.js';
import { SlackConnector }       from '../scanner/cloud/slack.js';

const log = createLogger('daemon');

// ---------------------------------------------------------------------------
// StellarDaemon
// ---------------------------------------------------------------------------

export class StellarDaemon {
  private scheduler: StellarScheduler;
  private isRunning = false;
  private startedAt: Date | null = null;

  constructor(connectors: CloudConnector[] = []) {
    this.scheduler = new StellarScheduler(DEFAULT_SCHEDULE_CONFIG, connectors);
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
// buildConnectors — construct connectors from environment variables
// ---------------------------------------------------------------------------

async function buildConnectors(): Promise<CloudConnector[]> {
  const connectors: CloudConnector[] = [];

  // Google Drive
  const gdriveServiceAccount =
    process.env['STELLAR_GDRIVE_CLIENT_EMAIL'] &&
    process.env['STELLAR_GDRIVE_PRIVATE_KEY'];

  const gdriveOAuth2 =
    process.env['STELLAR_GDRIVE_CLIENT_ID'] &&
    process.env['STELLAR_GDRIVE_CLIENT_SECRET'] &&
    process.env['STELLAR_GDRIVE_REFRESH_TOKEN'];

  if (gdriveServiceAccount || gdriveOAuth2) {
    try {
      const gdrive = new GoogleDriveConnector();
      const creds = gdriveServiceAccount
        ? {
            client_email: process.env['STELLAR_GDRIVE_CLIENT_EMAIL']!,
            private_key:  process.env['STELLAR_GDRIVE_PRIVATE_KEY']!,
          }
        : {
            client_id:     process.env['STELLAR_GDRIVE_CLIENT_ID']!,
            client_secret: process.env['STELLAR_GDRIVE_CLIENT_SECRET']!,
            refresh_token: process.env['STELLAR_GDRIVE_REFRESH_TOKEN']!,
          };

      await gdrive.authenticate(creds as unknown as Record<string, string>);
      connectors.push(gdrive);
      log.info('Google Drive connector activated');
    } catch (err) {
      log.error('Failed to activate Google Drive connector',
        err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Notion
  if (process.env['STELLAR_NOTION_API_KEY']) {
    try {
      const notion = new NotionConnector();
      await notion.authenticate({ api_key: process.env['STELLAR_NOTION_API_KEY']! });
      connectors.push(notion);
      log.info('Notion connector activated');
    } catch (err) {
      log.error('Failed to activate Notion connector',
        err instanceof Error ? err : new Error(String(err)));
    }
  }

  // GitHub
  if (process.env['STELLAR_GITHUB_PAT']) {
    try {
      const github = new GitHubConnector();
      const creds: Record<string, string> = {
        personal_access_token: process.env['STELLAR_GITHUB_PAT']!,
      };
      if (process.env['STELLAR_GITHUB_REPOS']) {
        creds['repositories'] = process.env['STELLAR_GITHUB_REPOS']!;
      }
      await github.authenticate(creds);
      connectors.push(github);
      log.info('GitHub connector activated');
    } catch (err) {
      log.error('Failed to activate GitHub connector',
        err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Slack
  if (process.env['STELLAR_SLACK_BOT_TOKEN']) {
    try {
      const slack = new SlackConnector();
      const creds: Record<string, string> = {
        bot_token: process.env['STELLAR_SLACK_BOT_TOKEN']!,
      };
      if (process.env['STELLAR_SLACK_INCLUDE_DMS']) {
        creds['include_dms'] = process.env['STELLAR_SLACK_INCLUDE_DMS']!;
      }
      await slack.authenticate(creds);
      connectors.push(slack);
      log.info('Slack connector activated');
    } catch (err) {
      log.error('Failed to activate Slack connector',
        err instanceof Error ? err : new Error(String(err)));
    }
  }

  return connectors;
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
  const connectors = await buildConnectors();
  const daemon     = new StellarDaemon(connectors);

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
