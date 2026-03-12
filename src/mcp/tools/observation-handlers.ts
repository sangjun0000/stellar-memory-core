/**
 * mcp/tools/observation-handlers.ts — Observation and consolidation handlers.
 *
 * Exports: handleObserve, handleConsolidate
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { processConversation } from '../../engine/observation.js';
import { findConsolidationCandidates, runConsolidation } from '../../engine/consolidation.js';
import { noteObserve } from '../../engine/session-policy.js';
import { type McpResponse, resolveProject } from './shared.js';

// ---------------------------------------------------------------------------
// observe
// ---------------------------------------------------------------------------

export async function handleObserve(args: {
  conversation: string;
  project?: string;
}): Promise<McpResponse> {
  try {
    const proj = args.project ?? resolveProject();
    const stats = await processConversation(args.conversation, proj);

    // Track in session-policy for smart auto-commit
    if (stats.memoriesCreated > 0 || stats.memoriesReinforced > 0) {
      noteObserve(proj, `Extracted ${stats.memoriesCreated} new, reinforced ${stats.memoriesReinforced}`);
    }

    const text = [
      `Observation complete for project "${proj}":`,
      `  Memories created:    ${stats.memoriesCreated}`,
      `  Memories reinforced: ${stats.memoriesReinforced}`,
      `  Conflicts detected:  ${stats.conflictsDetected}`,
    ].join('\n');

    return { content: [{ type: 'text' as const, text }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `observe failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// consolidate
// ---------------------------------------------------------------------------

export async function handleConsolidate(args: {
  project?: string;
  dry_run?: boolean;
}): Promise<McpResponse> {
  try {
    const proj   = args.project ?? resolveProject();
    const dryRun = args.dry_run ?? true;

    if (dryRun) {
      const candidates = await findConsolidationCandidates(proj);

      if (candidates.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No consolidation candidates found in project "${proj}".` }],
        };
      }

      const lines: string[] = [
        `Consolidation candidates in "${proj}" (${candidates.length} groups) — dry run:`,
        '',
      ];

      for (const { memories, similarity } of candidates) {
        lines.push(`  Group (similarity: ${(similarity * 100).toFixed(0)}%, ${memories.length} memories):`);
        for (const m of memories) {
          lines.push(`    [${m.type.toUpperCase()}] ${m.summary} | ${m.id.slice(0, 8)}`);
        }
        lines.push('');
      }

      lines.push('Run with dry_run=false to merge these groups.');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }

    const stats = await runConsolidation(proj);

    const text = [
      `Consolidation complete for "${proj}":`,
      `  Groups found:           ${stats.groupsFound}`,
      `  Memories consolidated:  ${stats.memoriesConsolidated}`,
      `  New memories created:   ${stats.newMemoriesCreated}`,
    ].join('\n');

    return { content: [{ type: 'text' as const, text }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `consolidate failed: ${String(err)}`);
  }
}
