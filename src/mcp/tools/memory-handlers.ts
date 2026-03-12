/**
 * mcp/tools/memory-handlers.ts — Core memory operation handlers.
 *
 * Exports: handleRemember, handleRecall, handleForget
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import type { Memory } from '../../engine/types.js';
import type { MemoryType } from '../../engine/types.js';
import { createMemory, recallMemoriesAsync, forgetMemory } from '../../engine/planet.js';
import { getOrbitZone } from '../../engine/orbit.js';
import { getMemoriesByProject } from '../../storage/queries.js';
import { extractRelationships, findRelatedMemories } from '../../engine/constellation.js';
import { getUniversalContext } from '../../engine/multiproject.js';
import { calculateQuality, getQualityFeedback } from '../../engine/quality.js';
import { detectConflicts, formatConflictWarnings } from '../../engine/conflict.js';
import { detectSupersession, supersedeMemory, setTemporalBounds } from '../../engine/temporal.js';
import { corona } from '../../engine/corona.js';
import { noteRecall, noteRemember } from '../../engine/session-policy.js';
import {
  type McpResponse,
  trackBgError,
  ensureCorona,
  resolveProject,
  formatDistance,
} from './shared.js';

// ---------------------------------------------------------------------------
// remember
// ---------------------------------------------------------------------------

export async function handleRemember(args: {
  content: string;
  summary?: string;
  type?: MemoryType;
  impact?: number;
  tags?: string[];
}): Promise<McpResponse> {
  try {
    const proj = resolveProject();

    const memory: Memory = createMemory({
      project: proj,
      content: args.content,
      summary: args.summary,
      type:    (args.type ?? 'observation') as MemoryType,
      impact:  args.impact,
      tags:    args.tags,
    });

    // Track in session-policy for smart auto-commit
    noteRemember(proj, { type: memory.type, summary: memory.summary, content: memory.content });

    // Background: auto-extract relationships with existing memories.
    // Fire-and-forget — does not block the response.
    extractRelationships(memory, proj).catch(() => {
      trackBgError('constellation');
    });

    // Set valid_from to now on the new memory
    setTemporalBounds(memory.id, new Date().toISOString(), undefined);

    // Calculate quality score
    const existingMemories = getMemoriesByProject(proj);
    const quality = calculateQuality(memory, existingMemories);
    const qualityFeedback = getQualityFeedback(quality);

    // Detect conflicts
    const conflicts = await detectConflicts(memory, proj);
    const conflictWarnings = formatConflictWarnings(conflicts);

    // Detect temporal supersession — auto-supersede if detected
    const supersessionCandidate = detectSupersession(memory, existingMemories);
    let supersessionNote = '';
    if (supersessionCandidate) {
      supersedeMemory(supersessionCandidate.id, memory.id);
      supersessionNote = `\nSuperseded: ${supersessionCandidate.id.slice(0, 8)} → this memory (${supersessionCandidate.summary.slice(0, 60)})`;
    }

    const zoneLabel = getOrbitZone(memory.distance);

    const lines: string[] = [
      `✦ Stored [${memory.type.toUpperCase()}] at ${memory.distance.toFixed(2)} AU (${zoneLabel}) | ID: ${memory.id} | quality: ${(quality.overall * 100).toFixed(0)}%`,
    ];

    if (supersessionNote) lines.push(supersessionNote);
    if (qualityFeedback) lines.push(`\nQuality tip: ${qualityFeedback}`);
    if (conflictWarnings) lines.push(`\n${conflictWarnings}`);

    return {
      content: [{
        type: 'text' as const,
        text: lines.join(''),
      }],
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `remember failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// recall
// ---------------------------------------------------------------------------

export async function handleRecall(args: {
  query: string;
  type?: 'all' | MemoryType;
  max_au?: number;
  limit?: number;
  include_universal?: boolean;
  at?: string;
}): Promise<McpResponse> {
  try {
    const proj = resolveProject();
    const limit = args.limit ?? 10;
    ensureCorona();

    // Track in session-policy for smart auto-commit
    noteRecall(proj, args.query);

    const memoryType: MemoryType | undefined =
      args.type === 'all' || args.type === undefined ? undefined : (args.type as MemoryType);

    // If `at` is provided, use temporal point-in-time query instead of normal recall
    let results: Memory[];
    if (args.at) {
      const { getContextAtTime } = await import('../../engine/temporal.js');
      results = getContextAtTime(proj, args.at).slice(0, limit);
    } else {
      // Exclude memories already visible in the Sun resource (corona cache)
      // to avoid token-wasting duplication between Sun and recall output.
      const coreIds = corona.getCoreMemories().map(m => m.id);
      const nearIds = corona.getNearMemories().map(m => m.id);
      const excludeIds = new Set([...coreIds, ...nearIds]);

      results = await recallMemoriesAsync(proj, args.query, {
        type:        memoryType,
        maxDistance: args.max_au,
        limit,
        excludeIds,
      });
    }

    // Optionally merge universal memories from other projects
    let universals: Memory[] = [];
    if (args.include_universal) {
      universals = getUniversalContext(proj, Math.ceil(limit / 2));
    }

    if (results.length === 0 && universals.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `No memories found matching "${args.query}".` }],
      };
    }

    const temporalNote = args.at ? ` (at ${args.at})` : ' (pulled closer to Sun)';
    const lines: string[] = [
      `Recall: "${args.query}" — ${results.length} result${results.length === 1 ? '' : 's'}${temporalNote}`,
      '',
    ];

    for (const m of results) {
      const preview = m.content.slice(0, 100) + (m.content.length > 100 ? '…' : '');
      const tags    = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      const shortId = m.id.slice(0, 8);
      lines.push(`[${m.type.toUpperCase()}] ${m.summary}${tags} | ${formatDistance(m.distance)} | ${shortId}`);
      lines.push(`  ${preview}`);

      // Include top 3 related memories (constellation)
      const related = findRelatedMemories(m.id, proj, 3);
      if (related.length > 0) {
        lines.push(`  Related: ${related.map(r => `${r.summary.slice(0, 40)} (${r.id.slice(0, 8)})`).join(', ')}`);
      }
      lines.push('');
    }

    if (universals.length > 0) {
      lines.push(`Universal memories (${universals.length} from other projects):`);
      lines.push('');
      for (const m of universals) {
        const preview = m.content.slice(0, 120) + (m.content.length > 120 ? '…' : '');
        lines.push(`[UNIVERSAL/${m.project}] ${m.summary} | ${m.id}`);
        lines.push(`  ${preview}`);
        lines.push('');
      }
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `recall failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// forget
// ---------------------------------------------------------------------------

export async function handleForget(args: {
  id: string;
  mode?: 'push' | 'delete';
}): Promise<McpResponse> {
  try {
    const effectiveMode = args.mode ?? 'push';

    // Clean up constellation edges before forgetting
    const { cleanupEdges } = await import('../../engine/constellation.js');
    cleanupEdges(args.id);

    forgetMemory(args.id, effectiveMode);

    if (effectiveMode === 'delete') {
      return { content: [{ type: 'text' as const, text: `✗ Deleted memory ${args.id} (constellation edges removed).` }] };
    }

    const oortDistance = 95.0;
    const zoneLabel    = getOrbitZone(oortDistance);

    return {
      content: [{
        type: 'text' as const,
        text: `↑ Pushed ${args.id} to ${oortDistance.toFixed(2)} AU (${zoneLabel}) — still recoverable via recall. Constellation edges removed.`,
      }],
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `forget failed: ${String(err)}`);
  }
}
