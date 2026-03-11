/**
 * mcp/tools/temporal-handlers.ts — Temporal query handler.
 *
 * Exports: handleTemporal
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import {
  getContextAtTime,
  getEvolutionChain,
  getTemporalSummary,
  setTemporalBounds,
} from '../../engine/temporal.js';
import { type McpResponse, resolveProject } from './shared.js';

// ---------------------------------------------------------------------------
// temporal
// ---------------------------------------------------------------------------

export async function handleTemporal(args: {
  action: 'at' | 'chain' | 'summary' | 'set_bounds';
  timestamp?: string;
  memory_id?: string;
  valid_from?: string;
  valid_until?: string;
  project?: string;
}): Promise<McpResponse> {
  try {
    const proj = args.project ?? resolveProject();

    switch (args.action) {
      case 'at': {
        if (!args.timestamp) throw new McpError(ErrorCode.InvalidParams, 'timestamp is required for action="at"');
        const memories = getContextAtTime(proj, args.timestamp);
        if (memories.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No memories active at ${args.timestamp} in "${proj}".` }],
          };
        }
        const lines = [
          `Context at ${args.timestamp} — "${proj}" (${memories.length} active memories):`,
          '',
          ...memories.slice(0, 20).map(m =>
            `  [${m.type.toUpperCase()}] ${m.summary} | ${m.distance.toFixed(2)} AU | ${m.id.slice(0, 8)}`
          ),
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'chain': {
        if (!args.memory_id) throw new McpError(ErrorCode.InvalidParams, 'memory_id is required for action="chain"');
        const chain = getEvolutionChain(args.memory_id);
        if (chain.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No evolution chain found for memory ${args.memory_id}.` }],
          };
        }
        const lines = [
          `Evolution chain for ${args.memory_id.slice(0, 8)} (${chain.length} entries, oldest first):`,
          '',
          ...chain.map((m, i) => {
            const date = m.created_at.slice(0, 10);
            const superseded = m.superseded_by ? ` → ${m.superseded_by.slice(0, 8)}` : ' [current]';
            return `  ${i + 1}. [${date}] ${m.summary.slice(0, 80)}${superseded}`;
          }),
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'summary': {
        const summary = getTemporalSummary(proj);
        return { content: [{ type: 'text' as const, text: summary }] };
      }

      case 'set_bounds': {
        if (!args.memory_id) throw new McpError(ErrorCode.InvalidParams, 'memory_id is required for action="set_bounds"');
        setTemporalBounds(args.memory_id, args.valid_from, args.valid_until);
        const parts: string[] = [];
        if (args.valid_from) parts.push(`valid_from: ${args.valid_from}`);
        if (args.valid_until) parts.push(`valid_until: ${args.valid_until}`);
        return {
          content: [{
            type: 'text' as const,
            text: `Temporal bounds set for ${args.memory_id.slice(0, 8)}: ${parts.join(', ')}`,
          }],
        };
      }

      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown action: ${String(args.action)}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `temporal failed: ${String(err)}`);
  }
}
