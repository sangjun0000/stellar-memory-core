/**
 * mcp/tools/system-handlers.ts — System management handlers.
 *
 * Exports: handleStatus, handleCommit, handleExport, handleOrbit
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import type { Memory, OrbitChange, OrbitZone } from '../../engine/types.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import type { MemoryType } from '../../engine/types.js';
import { getSunContent, commitToSun } from '../../engine/sun.js';
import { recalculateOrbits, getOrbitZone } from '../../engine/orbit.js';
import { getMemoriesByProject } from '../../storage/queries.js';
import { getConfig } from '../../utils/config.js';
import { listDataSources } from '../../scanner/index.js';
import { getUnresolvedConflicts } from '../../engine/conflict.js';
import { getTemporalSummary } from '../../engine/temporal.js';
import { getProceduralMemories, formatProceduralSection } from '../../engine/procedural.js';
import { corona } from '../../engine/corona.js';
import {
  type McpResponse,
  getBgErrorStats,
  ensureCorona,
  resolveProject,
  labelToZoneKey,
  formatMemoryLine,
} from './shared.js';
import { getReembeddingStatus } from '../../engine/reembed.js';
import { addLedgerEntry } from '../../engine/ledger.js';

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function handleStatus(args: {
  zone?: 'all' | 'core' | 'near' | 'stored' | 'forgotten';
  limit?: number;
  show?: 'memories' | 'sources' | 'all';
}): Promise<McpResponse> {
  try {
    const proj          = resolveProject();
    ensureCorona();

    // Record in session ledger (non-fatal, low priority)
    addLedgerEntry({ tool_name: 'status', project: proj });

    const effectiveLimit = args.limit ?? 20;
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
      const zoneOrder: OrbitZone[] = ['core', 'near', 'stored', 'forgotten'];

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

      // Re-embedding progress (shown when model upgrade is in progress)
      const reembed = getReembeddingStatus();
      if (reembed.running || reembed.done > 0) {
        const pct = reembed.total > 0
          ? Math.round((reembed.done / reembed.total) * 100)
          : 100;
        const label = reembed.running ? 'Re-embedding' : 'Re-embed done';
        lines.push(`  ${label}: ${reembed.done}/${reembed.total} (${pct}%)${reembed.failed > 0 ? ` [${reembed.failed} failed]` : ''}`);
      }

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
  project?: string;
}): Promise<McpResponse> {
  try {
    const proj   = args.project ?? resolveProject();
    const config = getConfig();

    commitToSun(proj, {
      current_work: args.current_work,
      decisions:    args.decisions  ?? [],
      next_steps:   args.next_steps ?? [],
      errors:       args.errors     ?? [],
      context:      args.context    ?? '',
    });

    // Record in session ledger (non-fatal)
    addLedgerEntry({ tool_name: 'commit', project: proj });

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
