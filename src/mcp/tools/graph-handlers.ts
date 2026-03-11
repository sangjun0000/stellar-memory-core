/**
 * mcp/tools/graph-handlers.ts — Knowledge graph operation handlers.
 *
 * Exports: handleConstellation, handleResolveConflict
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import {
  extractRelationships,
  getConstellationGraph,
  findRelatedMemories,
} from '../../engine/constellation.js';
import {
  getUnresolvedConflicts,
  resolveConflict as resolveConflictEngine,
} from '../../engine/conflict.js';
import { type McpResponse, resolveProject } from './shared.js';

// ---------------------------------------------------------------------------
// constellation
// ---------------------------------------------------------------------------

export async function handleConstellation(args: {
  id: string;
  action?: 'graph' | 'related' | 'extract';
  depth?: number;
  limit?: number;
}): Promise<McpResponse> {
  try {
    const proj   = resolveProject();
    const action = args.action ?? 'graph';

    if (action === 'extract') {
      // Fetch the memory to extract relationships for
      const { getMemoryById } = await import('../../storage/queries.js');
      const memory = getMemoryById(args.id);
      if (!memory) {
        throw new McpError(ErrorCode.InvalidParams, `Memory not found: ${args.id}`);
      }
      const edges = await extractRelationships(memory, proj);
      const text = edges.length === 0
        ? `No relationships found for memory ${args.id} (weight threshold not met).`
        : [
            `Extracted ${edges.length} relationship${edges.length === 1 ? '' : 's'} for ${args.id}:`,
            '',
            ...edges.map(e => `  [${e.relation}] → ${e.target_id} (weight: ${e.weight.toFixed(3)})`),
          ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    }

    if (action === 'related') {
      const limit   = args.limit ?? 10;
      const related = findRelatedMemories(args.id, proj, limit);
      if (related.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No related memories found for ${args.id}.` }],
        };
      }
      const lines = [
        `Related memories for ${args.id} (${related.length}):`,
        '',
        ...related.map(m => `  [${m.type.toUpperCase()}] ${m.summary} | ${m.distance.toFixed(2)} AU | ${m.id}`),
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    // Default: graph
    const depth = args.depth ?? 1;
    const { nodes, edges } = getConstellationGraph(args.id, proj, depth);

    if (edges.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `Constellation for ${args.id}: no edges yet. Use action="extract" to auto-discover relationships.`,
        }],
      };
    }

    const lines: string[] = [
      `Constellation graph for ${args.id} (depth=${depth}):`,
      `  ${nodes.length} nodes  ${edges.length} edges`,
      '',
      'Edges:',
      ...edges.map(e => `  ${e.source_id.slice(0, 8)} --[${e.relation}]--> ${e.target_id.slice(0, 8)} (w=${e.weight.toFixed(3)})`),
      '',
      'Nodes:',
      ...nodes.map(n => `  [${n.type.toUpperCase()}] ${n.summary} | ${n.distance.toFixed(2)} AU | ${n.id}`),
    ];

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `constellation failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// resolve_conflict
// ---------------------------------------------------------------------------

export async function handleResolveConflict(args: {
  action: 'list' | 'resolve' | 'dismiss';
  conflict_id?: string;
  resolution?: string;
  resolve_action?: 'supersede' | 'dismiss' | 'keep_both';
  project?: string;
}): Promise<McpResponse> {
  try {
    const proj = args.project ?? resolveProject();

    if (args.action === 'list') {
      const conflicts = getUnresolvedConflicts(proj);

      if (conflicts.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No unresolved conflicts in project "${proj}".` }],
        };
      }

      const lines: string[] = [
        `Unresolved conflicts in "${proj}" (${conflicts.length}):`,
        '',
      ];

      for (const c of conflicts) {
        lines.push(`  [${c.severity.toUpperCase()}] ${c.id}`);
        lines.push(`    Memory:     ${c.memory_id.slice(0, 8)}`);
        lines.push(`    Conflicts:  ${c.conflicting_memory_id.slice(0, 8)}`);
        lines.push(`    Reason:     ${c.description}`);
        lines.push('');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    if (args.action === 'resolve' || args.action === 'dismiss') {
      if (!args.conflict_id) {
        throw new McpError(ErrorCode.InvalidParams, 'conflict_id is required for resolve/dismiss actions');
      }

      const resolution = args.resolution ?? (args.action === 'dismiss' ? 'Dismissed by user' : 'Resolved by user');
      const resolveAction = args.resolve_action ?? (args.action === 'dismiss' ? 'dismiss' : 'supersede');

      resolveConflictEngine(args.conflict_id, resolution, resolveAction);

      return {
        content: [{
          type: 'text' as const,
          text: `Conflict ${args.conflict_id.slice(0, 8)} resolved with action "${resolveAction}": ${resolution}`,
        }],
      };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unknown action: ${String(args.action)}`);
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `resolve_conflict failed: ${String(err)}`);
  }
}
