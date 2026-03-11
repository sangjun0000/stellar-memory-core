/**
 * mcp/tools/analytics-handlers.ts — Analytics and multi-project handlers.
 *
 * Exports: handleAnalytics, handleGalaxy
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import {
  getFullAnalytics,
  getSurvivalCurve,
  getOrbitMovements,
  getTopicClusters,
  detectAccessPatterns,
  getMemoryHealth,
  generateReport,
} from '../../engine/analytics.js';
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
import { type McpResponse, resolveProject } from './shared.js';

// ---------------------------------------------------------------------------
// analytics
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
