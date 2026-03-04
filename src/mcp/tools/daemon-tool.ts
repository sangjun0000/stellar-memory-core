/**
 * mcp/tools/daemon-tool.ts — Handler function for the daemon MCP tool.
 *
 * The daemon tool manages the background StellarScheduler.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { StellarScheduler, DEFAULT_SCHEDULE_CONFIG } from '../../service/scheduler.js';

// Module-level scheduler state (one daemon per process)
let _scheduler: StellarScheduler | null = null;
let _schedulerStartedAt: Date | null    = null;

function getOrCreateScheduler(): StellarScheduler {
  if (!_scheduler) {
    _scheduler = new StellarScheduler(DEFAULT_SCHEDULE_CONFIG);
  }
  return _scheduler;
}

type McpResponse = { content: [{ type: 'text'; text: string }] };

// ---------------------------------------------------------------------------
// daemon
// ---------------------------------------------------------------------------

export async function handleDaemon(
  args: { action: 'status' | 'start' | 'stop' },
): Promise<McpResponse> {
  try {
    const scheduler = getOrCreateScheduler();

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

        const lines: string[] = [
          `Daemon: ${isRunning ? 'RUNNING' : 'STOPPED'} | started: ${startedStr}`,
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
