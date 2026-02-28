/**
 * mcp/tools/daemon-tool.ts — Handler function for the daemon MCP tool.
 *
 * The daemon tool manages the background StellarScheduler. Rather than
 * embedding the scheduler lifecycle inside server.ts, this module owns
 * the state machine (null → running → stopped) and exposes it through a
 * single exported handler function.
 *
 * The scheduler instance and start-time are module-level within this file,
 * keeping them close to the code that uses them while removing them from
 * the main server factory.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { StellarScheduler, DEFAULT_SCHEDULE_CONFIG } from '../../service/scheduler.js';
import type { ConnectorRegistry } from '../connector-registry.js';

// Module-level scheduler state (one daemon per process)
let _scheduler: StellarScheduler | null = null;
let _schedulerStartedAt: Date | null    = null;

function getOrCreateScheduler(registry: ConnectorRegistry): StellarScheduler {
  if (!_scheduler) {
    _scheduler = new StellarScheduler(
      DEFAULT_SCHEDULE_CONFIG,
      registry.values(),
    );
  }
  return _scheduler;
}

/** Reset scheduler state — used when connector registry changes. */
export function resetScheduler(): void {
  if (_scheduler) {
    _scheduler.stop();
    _scheduler = null;
    _schedulerStartedAt = null;
  }
}

type McpResponse = { content: [{ type: 'text'; text: string }] };

// ---------------------------------------------------------------------------
// daemon
// ---------------------------------------------------------------------------

export async function handleDaemon(
  args: { action: 'status' | 'start' | 'stop' },
  registry: ConnectorRegistry,
): Promise<McpResponse> {
  try {
    const scheduler = getOrCreateScheduler(registry);

    switch (args.action) {
      case 'start': {
        scheduler.start();
        _schedulerStartedAt = new Date();
        return { content: [{ type: 'text' as const, text: 'Daemon: started.' }] };
      }

      case 'stop': {
        scheduler.stop();
        _schedulerStartedAt = null;
        return { content: [{ type: 'text' as const, text: 'Daemon: stopped.' }] };
      }

      case 'status': {
        const taskStatus = scheduler.getStatus();
        const isRunning  = _schedulerStartedAt !== null;
        const startedStr = _schedulerStartedAt ? _schedulerStartedAt.toISOString() : '—';
        const services   = registry.keys().join(', ') || 'none';

        const lines: string[] = [
          `Daemon: ${isRunning ? 'RUNNING' : 'STOPPED'} | started: ${startedStr} | services: ${services}`,
          '',
        ];

        for (const [name, status] of Object.entries(taskStatus)) {
          const last = status.lastRunAt ? status.lastRunAt.toISOString() : 'never';
          const dur  = status.lastDuration !== null ? `${status.lastDuration}ms` : '—';
          const err  = status.lastError ? ` ERR: ${status.lastError}` : '';
          lines.push(
            `  ${name.padEnd(22)} runs=${status.runCount}  last=${last}  dur=${dur}${err}`
          );
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `daemon failed: ${String(err)}`);
  }
}
