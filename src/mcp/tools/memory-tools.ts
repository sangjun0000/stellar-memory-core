/**
 * mcp/tools/memory-tools.ts — Handler functions for memory-related MCP tools.
 *
 * Exported functions:
 *   handleStatus  — status tool
 *   handleCommit  — commit tool
 *   handleRecall  — recall tool
 *   handleRemember — remember tool
 *   handleOrbit   — orbit tool
 *   handleForget  — forget tool
 *   handleExport  — export tool
 *
 * Each function receives only the parsed tool arguments it needs plus any
 * dependencies injected at call-site. It returns the MCP response object
 * `{ content: [{ type: 'text', text: string }] }`.
 *
 * No McpServer or SDK imports are needed here — that coupling lives in server.ts.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import type { Memory, OrbitChange, OrbitZone } from '../../engine/types.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import type { MemoryType } from '../../engine/types.js';
import { getSunContent, commitToSun } from '../../engine/sun.js';
import { createMemory, recallMemoriesAsync, forgetMemory } from '../../engine/planet.js';
import { recalculateOrbits, getOrbitZone } from '../../engine/orbit.js';
import { getMemoriesByProject, getObservations, getMemoryById } from '../../storage/queries.js';
import { getConfig } from '../../utils/config.js';
import { listDataSources } from '../../scanner/index.js';
import {
  extractRelationships,
  getConstellationGraph,
  findRelatedMemories,
} from '../../engine/constellation.js';
import {
  switchProject,
  getCurrentProject,
  listAllProjects,
  createProject,
  getProjectStats,
  markUniversal,
  getUniversalContext,
  detectUniversalCandidates,
} from '../../engine/multiproject.js';
import {
  getFullAnalytics,
  getSurvivalCurve,
  getOrbitMovements,
  getTopicClusters,
  detectAccessPatterns,
  getMemoryHealth,
  generateReport,
} from '../../engine/analytics.js';
import { calculateQuality, getQualityFeedback } from '../../engine/quality.js';
import {
  detectConflicts,
  formatConflictWarnings,
  getUnresolvedConflicts,
  resolveConflict as resolveConflictEngine,
} from '../../engine/conflict.js';
import {
  detectSupersession,
  supersedeMemory,
  getContextAtTime,
  getEvolutionChain,
  getTemporalSummary,
  setTemporalBounds,
} from '../../engine/temporal.js';
import { processConversation } from '../../engine/observation.js';
import { findConsolidationCandidates, runConsolidation } from '../../engine/consolidation.js';
import {
  getProceduralMemories,
  formatProceduralSection,
} from '../../engine/procedural.js';
import { corona } from '../../engine/corona.js';

// ---------------------------------------------------------------------------
// Corona lazy initialization
// ---------------------------------------------------------------------------

let coronaReady = false;
function ensureCorona(): void {
  if (!coronaReady) {
    corona.warmup(resolveProject());
    coronaReady = true;
  }
}

// ---------------------------------------------------------------------------
// Async background task error tracking
// ---------------------------------------------------------------------------

const bgErrors = {
  embedding: 0,
  constellation: 0,
  consolidation: 0,
};

/** Increment a background error counter. Called from fire-and-forget tasks. */
export function trackBgError(category: keyof typeof bgErrors): void {
  bgErrors[category]++;
}

/** Get background error stats snapshot. */
export function getBgErrorStats(): typeof bgErrors {
  return { ...bgErrors };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveProject(): string {
  // getCurrentProject() reflects runtime switches via the galaxy tool;
  // falls back to the config default on first call (same initial value).
  return getCurrentProject();
}

function labelToZoneKey(label: string): OrbitZone {
  for (const [key, info] of Object.entries(ORBIT_ZONES) as [OrbitZone, { min: number; max: number; label: string }][]) {
    if (info.label === label) return key;
  }
  return 'forgotten';
}

function formatDistance(distance: number): string {
  const label = getOrbitZone(distance);
  return `${distance.toFixed(2)} AU (${label})`;
}

function formatMemoryLine(m: Memory): string {
  const pct = (m.importance * 100).toFixed(0);
  return `  [${m.type.toUpperCase()}] ${m.summary} | ${m.distance.toFixed(2)} AU | ${pct}% | ${m.id}`;
}

type McpResponse = { content: [{ type: 'text'; text: string }] };

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function handleStatus(args: {
  zone?: 'all' | 'core' | 'near' | 'active' | 'archive' | 'fading' | 'forgotten';
  limit?: number;
  show?: 'memories' | 'sources' | 'all';
}): Promise<McpResponse> {
  try {
    const proj          = resolveProject();
    ensureCorona();
    const effectiveLimit = args.limit ?? 50;
    const effectiveZone  = args.zone  ?? 'all';
    const effectiveShow  = args.show  ?? 'memories';

    const lines: string[] = [];

    if (effectiveShow === 'memories' || effectiveShow === 'all') {
      const all      = getMemoriesByProject(proj);
      const memories = all.slice(0, effectiveLimit);

      const filtered =
        effectiveZone === 'all'
          ? memories
          : memories.filter((m) => {
              const zoneKey = labelToZoneKey(getOrbitZone(m.distance));
              return zoneKey === effectiveZone;
            });

      const byZone: Partial<Record<OrbitZone, Memory[]>> = {};
      for (const m of filtered) {
        const zoneKey = labelToZoneKey(getOrbitZone(m.distance));
        const bucket  = byZone[zoneKey] ?? [];
        bucket.push(m);
        byZone[zoneKey] = bucket;
      }
      const zoneOrder: OrbitZone[] = ['core', 'near', 'active', 'archive', 'fading', 'forgotten'];

      // Stats summary
    const unresolvedConflicts = getUnresolvedConflicts(proj);
    const proceduralCount = all.filter(m => m.type === 'procedural').length;
    const qualityValues = all.map(m => m.quality_score).filter((q): q is number => q !== undefined && q !== null);
    const avgQuality = qualityValues.length > 0
      ? qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length
      : null;

    const coronaStats = corona.stats();
    lines.push(`☀ Project: ${proj} | ${filtered.length} memories | corona: ${coronaStats.core} core, ${coronaStats.near} near cached`);

      if (filtered.length > 0) {
        const zoneCounts = zoneOrder
          .map((z) => `${z}: ${(byZone[z] ?? []).length}`)
          .join('  ');
        lines.push(`  ${zoneCounts}`);
      }

      // Extended stats
      const statsLine: string[] = [];
      if (avgQuality !== null) statsLine.push(`avg quality: ${(avgQuality * 100).toFixed(0)}%`);
      if (unresolvedConflicts.length > 0) statsLine.push(`conflicts: ${unresolvedConflicts.length}`);
      if (proceduralCount > 0) statsLine.push(`procedural: ${proceduralCount}`);
      // Background error stats
      const errors = getBgErrorStats();
      const totalBgErrors = errors.embedding + errors.constellation + errors.consolidation;
      if (totalBgErrors > 0) statsLine.push(`bg errors: ${totalBgErrors}`);
      if (statsLine.length > 0) lines.push(`  ${statsLine.join('  |  ')}`);

      if (filtered.length === 0) {
        lines.push(
          effectiveZone !== 'all'
            ? `No memories in zone "${effectiveZone}".`
            : 'No memories yet. Use remember or scan to add some.'
        );
      } else {
        lines.push('');
        for (const zoneName of zoneOrder) {
          const zoneMemories = byZone[zoneName];
          if (!zoneMemories || zoneMemories.length === 0) continue;
          lines.push(`▸ ${ORBIT_ZONES[zoneName].label} (${zoneMemories.length})`);
          for (const m of zoneMemories) lines.push(formatMemoryLine(m));
          lines.push('');
        }
      }
    }

    if (effectiveShow === 'sources' || effectiveShow === 'all') {
      if (effectiveShow === 'all') lines.push('─────────────────────────────────');

      const sources = listDataSources();
      if (sources.length === 0) {
        lines.push('No data sources registered yet. Use scan to index a directory.');
      } else {
        lines.push(`Data sources (${sources.length}):`);
        lines.push('');
        for (const ds of sources) {
          const lastScan = ds.last_scanned_at
            ? new Date(ds.last_scanned_at).toLocaleString()
            : 'never';
          const sizeMB = (ds.total_size / 1_048_576).toFixed(2);
          lines.push(
            `  ${ds.path} | ${ds.status} | ${ds.file_count} files (${sizeMB} MB) | last: ${lastScan} | id: ${ds.id}`
          );
        }
      }
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `status failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

export async function handleCommit(args: {
  current_work: string;
  decisions?: string[];
  next_steps?: string[];
  errors?: string[];
  context?: string;
}): Promise<McpResponse> {
  try {
    const proj   = resolveProject();
    const config = getConfig();

    commitToSun(proj, {
      current_work: args.current_work,
      decisions:    args.decisions  ?? [],
      next_steps:   args.next_steps ?? [],
      errors:       args.errors     ?? [],
      context:      args.context    ?? '',
    });

    const changes: OrbitChange[] = recalculateOrbits(proj, config);

    const lines: string[] = [
      `✓ Committed | decisions: ${(args.decisions ?? []).length} | steps: ${(args.next_steps ?? []).length} | errors: ${(args.errors ?? []).length} | orbit changes: ${changes.length}`,
    ];

    // Include procedural section if any procedural memories exist
    const proceduralMems = getProceduralMemories(proj);
    if (proceduralMems.length > 0) {
      lines.push('');
      lines.push(formatProceduralSection(proceduralMems));
    }

    // Include temporal summary
    const temporalSummary = getTemporalSummary(proj);
    if (temporalSummary) {
      lines.push('');
      lines.push(temporalSummary);
    }

    // Include unresolved conflict count
    const unresolvedConflicts = getUnresolvedConflicts(proj);
    if (unresolvedConflicts.length > 0) {
      lines.push('');
      lines.push(`Unresolved conflicts: ${unresolvedConflicts.length} — use resolve_conflict tool to review.`);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `commit failed: ${String(err)}`);
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

    const memoryType: MemoryType | undefined =
      args.type === 'all' || args.type === undefined ? undefined : (args.type as MemoryType);

    // If `at` is provided, use temporal point-in-time query instead of normal recall
    let results: Memory[];
    if (args.at) {
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
// orbit
// ---------------------------------------------------------------------------

export async function handleOrbit(_args: Record<string, never>): Promise<McpResponse> {
  try {
    const proj    = resolveProject();
    const config  = getConfig();
    const changes: OrbitChange[] = recalculateOrbits(proj, config);

    if (changes.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `Orbit: ${proj} — no changes. All memories are stable.` }],
      };
    }

    let closerCount  = 0;
    let furtherCount = 0;
    const lines: string[] = [];

    for (const change of changes) {
      const delta     = change.new_distance - change.old_distance;
      const direction = delta < 0 ? '↓' : '↑';
      const absAU     = Math.abs(delta).toFixed(2);

      if (delta < 0) closerCount++;
      else furtherCount++;

      const oldZone  = getOrbitZone(change.old_distance);
      const newZone  = getOrbitZone(change.new_distance);
      const zoneChange = oldZone !== newZone ? ` ${oldZone}→${newZone}` : '';

      lines.push(
        `  ${direction}${absAU} AU (${change.old_distance.toFixed(2)}→${change.new_distance.toFixed(2)})${zoneChange} | ${change.trigger} | ${change.memory_id}`
      );
    }

    const header = `Orbit: ${proj} — ${changes.length} change${changes.length === 1 ? '' : 's'} | ↓${closerCount} closer  ↑${furtherCount} further`;

    return { content: [{ type: 'text' as const, text: [header, '', ...lines].join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `orbit failed: ${String(err)}`);
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

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export async function handleExport(args: {
  type?: 'all' | MemoryType;
  zone?: 'all' | OrbitZone;
  format?: 'json' | 'markdown';
}): Promise<McpResponse> {
  try {
    const proj            = resolveProject();
    const effectiveFormat = args.format ?? 'json';

    let memories: Memory[] = getMemoriesByProject(proj);

    if (args.type && args.type !== 'all') {
      memories = memories.filter((m) => m.type === args.type);
    }

    if (args.zone && args.zone !== 'all') {
      memories = memories.filter((m) => labelToZoneKey(getOrbitZone(m.distance)) === args.zone);
    }

    if (effectiveFormat === 'json') {
      const payload = memories.map((m) => ({
        id:         m.id,
        type:       m.type,
        summary:    m.summary,
        content:    m.content,
        tags:       m.tags,
        distance:   m.distance,
        importance: m.importance,
        created_at: m.created_at,
      }));

      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }

    // markdown format
    const lines: string[] = [
      `# Stellar Memory Export`,
      `Project: ${proj} | ${memories.length} memories | ${new Date().toISOString()}`,
      '',
    ];

    for (const m of memories) {
      const zoneLabel = getOrbitZone(m.distance);
      const tagsStr   = m.tags.length > 0 ? m.tags.join(', ') : '—';
      const dateStr   = m.created_at.slice(0, 10);

      lines.push(`## [${m.type.toUpperCase()}] ${m.summary}`);
      lines.push(`- **Distance**: ${m.distance.toFixed(2)} AU (${zoneLabel})`);
      lines.push(`- **Impact**: ${m.importance.toFixed(2)}`);
      lines.push(`- **Tags**: ${tagsStr}`);
      lines.push(`- **Created**: ${dateStr}`);
      lines.push('');
      lines.push(m.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `export failed: ${String(err)}`);
  }
}

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
// galaxy — multi-project management
// ---------------------------------------------------------------------------

export async function handleGalaxy(args: {
  action: 'switch' | 'list' | 'create' | 'stats' | 'mark_universal' | 'universal_context' | 'candidates';
  project?: string;
  memory_id?: string;
  is_universal?: boolean;
  limit?: number;
}): Promise<McpResponse> {
  try {
    const lines: string[] = [];

    switch (args.action) {
      case 'switch': {
        if (!args.project) throw new McpError(ErrorCode.InvalidParams, 'project is required for action="switch"');
        const result = switchProject(args.project);
        lines.push(`Switched project: ${result.previous} → ${result.current}`);
        lines.push(`Memories in "${result.current}": ${result.memoryCount}`);
        break;
      }

      case 'list': {
        const projects = listAllProjects();
        const current  = getCurrentProject();
        lines.push(`Galaxy — ${projects.length} project${projects.length === 1 ? '' : 's'} (active: ${current})`);
        lines.push('');
        for (const p of projects) {
          const active   = p.project === current ? ' *' : '';
          const univFlag = p.hasUniversal ? ' [universal]' : '';
          const updated  = p.lastUpdated.slice(0, 10);
          lines.push(`  ${p.project}${active}${univFlag} | ${p.memoryCount} memories | updated: ${updated}`);
        }
        break;
      }

      case 'create': {
        if (!args.project) throw new McpError(ErrorCode.InvalidParams, 'project is required for action="create"');
        const result = createProject(args.project);
        lines.push(result.created
          ? `Created project "${result.project}".`
          : `Project "${result.project}" already exists.`
        );
        break;
      }

      case 'stats': {
        const proj  = args.project ?? getCurrentProject();
        const stats = getProjectStats(proj);
        lines.push(`Stats — project: ${proj}`);
        lines.push(`Total memories:  ${stats.memoryCount}`);
        lines.push(`Universal:       ${stats.universalCount}`);
        lines.push(`Oldest memory:   ${stats.oldestMemory.slice(0, 10) || '—'}`);
        lines.push(`Newest memory:   ${stats.newestMemory.slice(0, 10) || '—'}`);
        lines.push('');
        lines.push('Zone distribution:');
        for (const [zone, count] of Object.entries(stats.zoneDistribution)) {
          lines.push(`  ${zone.padEnd(10)} ${count}`);
        }
        lines.push('');
        lines.push('Type distribution:');
        for (const [type, count] of Object.entries(stats.typeDistribution)) {
          lines.push(`  ${type.padEnd(12)} ${count}`);
        }
        break;
      }

      case 'mark_universal': {
        if (!args.memory_id) throw new McpError(ErrorCode.InvalidParams, 'memory_id is required for action="mark_universal"');
        const flag = args.is_universal ?? true;
        markUniversal(args.memory_id, flag);
        lines.push(`Memory ${args.memory_id} marked as ${flag ? 'universal' : 'project-specific'}.`);
        break;
      }

      case 'universal_context': {
        const proj     = args.project ?? getCurrentProject();
        const limit    = args.limit ?? 10;
        const memories = getUniversalContext(proj, limit);
        if (memories.length === 0) {
          lines.push('No universal memories from other projects.');
        } else {
          lines.push(`Universal context for "${proj}" (${memories.length} memories from other projects):`);
          lines.push('');
          for (const m of memories) {
            lines.push(`[${m.project}/${m.type.toUpperCase()}] ${m.summary} | ${m.id}`);
            lines.push(`  ${m.content.slice(0, 120)}${m.content.length > 120 ? '…' : ''}`);
            lines.push('');
          }
        }
        break;
      }

      case 'candidates': {
        const proj       = args.project ?? getCurrentProject();
        const candidates = detectUniversalCandidates(proj);
        if (candidates.length === 0) {
          lines.push(`No universal candidates found in project "${proj}".`);
        } else {
          lines.push(`Universal candidates in "${proj}" (${candidates.length}) — review and mark with mark_universal:`);
          lines.push('');
          for (const m of candidates) {
            lines.push(`[${m.type.toUpperCase()}] ${m.summary} | importance: ${(m.importance * 100).toFixed(0)}% | ${m.id}`);
          }
        }
        break;
      }

      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown action: ${String(args.action)}`);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `galaxy failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// analytics — memory insights and pattern detection
// ---------------------------------------------------------------------------

export async function handleAnalytics(args: {
  report?: 'summary' | 'health' | 'topics' | 'survival' | 'movements' | 'full';
  action?: 'overview' | 'survival' | 'movements' | 'clusters' | 'patterns' | 'health' | 'report';
  project?: string;
  days?: number;
}): Promise<McpResponse> {
  try {
    const proj  = args.project ?? resolveProject();
    const lines: string[] = [];
    // Support both `report` (new) and `action` (legacy) param names
    const effectiveAction = args.report ?? args.action ?? 'overview';

    switch (effectiveAction) {
      case 'survival': {
        const curve = getSurvivalCurve(proj);
        lines.push(`Memory survival curve — project: ${proj}`);
        lines.push('');
        lines.push('Age (days)  Surviving  Accessed  Forgotten');
        lines.push('─────────────────────────────────────────');
        for (const row of curve) {
          const age  = String(row.ageInDays).padStart(10);
          const surv = String(row.survivingCount).padStart(9);
          const acc  = String(row.accessedCount).padStart(8);
          const forg = String(row.forgottenCount).padStart(9);
          lines.push(`${age}  ${surv}  ${acc}  ${forg}`);
        }
        break;
      }

      case 'movements': {
        const days = args.days ?? 30;
        const movements = getOrbitMovements(proj, days);
        if (movements.length === 0) {
          lines.push(`No orbit movements in the last ${days} days for project "${proj}".`);
        } else {
          lines.push(`Orbit movements — project: ${proj} (last ${days} days, top ${movements.length})`);
          lines.push('');
          for (const m of movements) {
            const dir = m.netMovement < 0 ? '↓' : '↑';
            lines.push(`${dir} ${m.summary} (${m.movements.length} moves, net: ${m.netMovement > 0 ? '+' : ''}${m.netMovement.toFixed(2)} AU) | ${m.memoryId}`);
            for (const mv of m.movements.slice(-3)) {
              lines.push(`    ${mv.timestamp.slice(0, 16)}  ${mv.oldDistance.toFixed(2)}→${mv.newDistance.toFixed(2)} AU  [${mv.trigger}]`);
            }
            lines.push('');
          }
        }
        break;
      }

      case 'clusters': {
        const topicClusters = getTopicClusters(proj);
        if (topicClusters.length === 0) {
          lines.push(`No topic clusters found for project "${proj}". Add tags to your memories.`);
        } else {
          lines.push(`Topic clusters — project: ${proj} (${topicClusters.length} topics)`);
          lines.push('');
          lines.push('Topic               Count  Avg Imp  Avg Dist  Recent');
          lines.push('────────────────────────────────────────────────────');
          for (const cl of topicClusters) {
            const topicLabel = cl.topic.slice(0, 18).padEnd(18);
            const clCount  = String(cl.memoryCount).padStart(5);
            const imp    = (cl.avgImportance * 100).toFixed(0).padStart(6) + '%';
            const dist   = cl.avgDistance.toFixed(1).padStart(7) + ' AU';
            const recent = String(cl.recentActivity).padStart(6);
            lines.push(`${topicLabel}  ${clCount}  ${imp}  ${dist}  ${recent}`);
          }
        }
        break;
      }

      case 'patterns': {
        const patterns = detectAccessPatterns(proj);
        if (patterns.length === 0) {
          lines.push(`No access patterns detected yet for project "${proj}". Keep using recall to build history.`);
        } else {
          lines.push(`Access patterns — project: ${proj}`);
          lines.push('');
          for (const p of patterns) {
            lines.push(`[${p.pattern.toUpperCase()}] ${p.description}`);
            lines.push(`  Frequency: ${p.frequency}`);
            lines.push('');
          }
        }
        break;
      }

      case 'health': {
        const h = getMemoryHealth(proj);
        lines.push(`Memory health — project: ${proj}`);
        lines.push('');
        lines.push(`Total memories:               ${h.totalMemories}`);
        lines.push(`Active ratio (close zones):   ${(h.activeRatio * 100).toFixed(1)}%`);
        lines.push(`Stale ratio (30+ days idle):  ${(h.staleRatio * 100).toFixed(1)}%`);
        lines.push(`Avg quality score:            ${(h.qualityAvg * 100).toFixed(1)}%`);
        lines.push(`Conflict ratio:               ${(h.conflictRatio * 100).toFixed(1)}%`);
        lines.push(`Consolidation opportunities:  ${h.consolidationOpportunities}`);
        if (h.recommendations.length > 0) {
          lines.push('');
          lines.push('Recommendations:');
          for (const rec of h.recommendations) {
            lines.push(`  - ${rec}`);
          }
        } else {
          lines.push('');
          lines.push('Memory system is healthy. No action needed.');
        }
        break;
      }

      case 'report':
      case 'full': {
        const report = generateReport(proj);
        lines.push(report);
        break;
      }

      case 'topics': {
        // Alias for 'clusters'
        const clusters = getTopicClusters(proj);
        if (clusters.length === 0) {
          lines.push(`No topic clusters found for project "${proj}". Add tags to your memories.`);
        } else {
          lines.push(`Topic clusters — project: ${proj} (${clusters.length} topics)`);
          lines.push('');
          lines.push('Topic               Count  Avg Imp  Avg Dist  Recent');
          lines.push('────────────────────────────────────────────────────');
          for (const cl of clusters) {
            const topic  = cl.topic.slice(0, 18).padEnd(18);
            const count  = String(cl.memoryCount).padStart(5);
            const imp    = (cl.avgImportance * 100).toFixed(0).padStart(6) + '%';
            const dist   = cl.avgDistance.toFixed(1).padStart(7) + ' AU';
            const recent = String(cl.recentActivity).padStart(6);
            lines.push(`${topic}  ${count}  ${imp}  ${dist}  ${recent}`);
          }
        }
        break;
      }

      case 'summary':
      case 'overview': {
        const a = getFullAnalytics(proj);
        lines.push(`Analytics — project: ${proj}`);
        lines.push(`Total memories:      ${a.total_memories}`);
        lines.push(`Avg importance:      ${(a.avg_importance * 100).toFixed(1)}%`);
        lines.push(`Avg quality:         ${(a.avg_quality * 100).toFixed(1)}%`);
        lines.push(`Recall success rate: ${(a.recall_success_rate * 100).toFixed(1)}%`);
        lines.push(`Consolidations:      ${a.consolidation_count}`);
        lines.push(`Open conflicts:      ${a.conflict_count}`);
        lines.push('');
        lines.push('Zone distribution:');
        for (const [zone, count] of Object.entries(a.zone_distribution)) {
          lines.push(`  ${zone.padEnd(10)} ${count}`);
        }
        lines.push('');
        lines.push('Type distribution:');
        for (const [type, count] of Object.entries(a.type_distribution).sort(([, a], [, b]) => b - a)) {
          lines.push(`  ${type.padEnd(12)} ${count}`);
        }
        if (a.top_tags.length > 0) {
          lines.push('');
          lines.push('Top tags:');
          for (const { tag, count } of a.top_tags.slice(0, 10)) {
            lines.push(`  ${tag.padEnd(20)} ${count}`);
          }
        }
        break;
      }

      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown analytics report: ${String(effectiveAction)}`);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `analytics failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// sun resource handler (not a tool, but lives logically with memory tools)
// ---------------------------------------------------------------------------

export function handleSunResource(uriHref: string): { contents: [{ uri: string; text: string }] } {
  const config  = getConfig();
  const proj    = resolveProject();
  ensureCorona();
  let content   = getSunContent(proj);

  // Append procedural memories section (Navigation Rules)
  const proceduralMems = getProceduralMemories(proj);
  if (proceduralMems.length > 0) {
    content += '\n\n' + formatProceduralSection(proceduralMems);
  }

  // Append temporal summary
  const temporalSummary = getTemporalSummary(proj);
  if (temporalSummary) {
    content += '\n\n' + temporalSummary;
  }

  // Append unresolved conflict count
  const unresolvedConflicts = getUnresolvedConflicts(proj);
  if (unresolvedConflicts.length > 0) {
    content += `\n\nUnresolved conflicts: ${unresolvedConflicts.length} — use resolve_conflict tool to review.`;
  }

  return { contents: [{ uri: uriHref, text: content }] };
}

// ---------------------------------------------------------------------------
// New tool handlers
// ---------------------------------------------------------------------------

export async function handleObserve(args: {
  conversation: string;
  project?: string;
}): Promise<McpResponse> {
  try {
    const proj = args.project ?? resolveProject();
    const stats = await processConversation(args.conversation, proj);

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
