/**
 * analytics.ts — Memory Analytics
 *
 * Purely computational analysis of memory usage patterns, health metrics,
 * and insights derived from memory and orbit_log data.
 *
 * No side effects — all functions are read-only queries.
 */

import type { MemoryAnalytics } from './types.js';
import { ORBIT_ZONES } from './types.js';
import {
  getAnalytics,
  getTopTags,
  getMemoriesByProject,
  getConflicts,
  getSurvivalData,
  getOrbitMovementLog,
  getAccessEventLog,
} from '../storage/queries.js';

// ---------------------------------------------------------------------------
// getFullAnalytics
// ---------------------------------------------------------------------------

/**
 * Get comprehensive analytics for a project.
 * Wraps queries.getAnalytics() and ensures all fields are populated.
 */
export function getFullAnalytics(project: string): MemoryAnalytics {
  return getAnalytics(project);
}

// ---------------------------------------------------------------------------
// getSurvivalCurve
// ---------------------------------------------------------------------------

/**
 * Memory survival analysis — how do memories fare over time?
 *
 * Groups memories by age bucket (days since creation) and reports:
 *   - survivingCount: still in habitable zone or closer (distance < 15)
 *   - accessedCount:  accessed at least once
 *   - forgottenCount: pushed to Oort (distance >= 70) or soft-deleted
 */
export function getSurvivalCurve(project: string): Array<{
  ageInDays: number;
  survivingCount: number;
  accessedCount: number;
  forgottenCount: number;
}> {
  const rows = getSurvivalData(project);

  // Bucket by age: 0, 1, 3, 7, 14, 30, 60, 90, 180, 365+
  const BUCKETS = [0, 1, 3, 7, 14, 30, 60, 90, 180, 365];

  function bucketFor(age: number): number {
    for (let i = BUCKETS.length - 1; i >= 0; i--) {
      if (age >= BUCKETS[i]) return BUCKETS[i];
    }
    return 0;
  }

  const bucketMap = new Map<number, { surviving: number; accessed: number; forgotten: number }>();

  for (const row of rows) {
    const bucket = bucketFor(Math.max(0, row.age_days));
    const entry = bucketMap.get(bucket) ?? { surviving: 0, accessed: 0, forgotten: 0 };

    const isDeleted = row.deleted_at !== null;
    const isOort = row.distance >= ORBIT_ZONES.forgotten.min;
    const isActive = row.distance < ORBIT_ZONES.near.max; // core + near (< 15.0 AU)

    if (isDeleted || isOort) {
      entry.forgotten++;
    } else if (isActive) {
      entry.surviving++;
    }

    if (row.access_count > 0) {
      entry.accessed++;
    }

    bucketMap.set(bucket, entry);
  }

  return BUCKETS
    .filter(b => bucketMap.has(b))
    .map(b => {
      const e = bucketMap.get(b)!;
      return {
        ageInDays: b,
        survivingCount: e.surviving,
        accessedCount: e.accessed,
        forgottenCount: e.forgotten,
      };
    });
}

// ---------------------------------------------------------------------------
// getOrbitMovements
// ---------------------------------------------------------------------------

/**
 * Analyze orbit_log to find which memories have moved the most.
 *
 * Returns up to 20 memories sorted by movement activity (most log entries first).
 */
export function getOrbitMovements(
  project: string,
  days = 30
): Array<{
  memoryId: string;
  summary: string;
  movements: Array<{ timestamp: string; oldDistance: number; newDistance: number; trigger: string }>;
  netMovement: number;
}> {
  const logRows = getOrbitMovementLog(project, days);

  // Group by memory_id
  const grouped = new Map<string, {
    summary: string;
    movements: Array<{ timestamp: string; oldDistance: number; newDistance: number; trigger: string }>;
  }>();

  for (const row of logRows) {
    const entry = grouped.get(row.memory_id) ?? {
      summary: row.summary ?? row.memory_id.slice(0, 8),
      movements: [],
    };
    entry.movements.push({
      timestamp: row.created_at,
      oldDistance: row.old_distance,
      newDistance: row.new_distance,
      trigger: row.trigger,
    });
    grouped.set(row.memory_id, entry);
  }

  // Calculate net movement and sort by most active
  return [...grouped.entries()]
    .map(([memoryId, data]) => {
      const first = data.movements[0]!;
      const last = data.movements[data.movements.length - 1]!;
      const netMovement = last.newDistance - first.oldDistance; // positive = moved away

      return {
        memoryId,
        summary: data.summary,
        movements: data.movements,
        netMovement,
      };
    })
    .sort((a, b) => b.movements.length - a.movements.length)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// getTopicClusters
// ---------------------------------------------------------------------------

/**
 * Group memories by their primary tag to find topic clusters.
 *
 * For each tag, computes:
 *   - memory count
 *   - average importance
 *   - average distance
 *   - recent activity (accesses in last 7 days)
 *
 * Sorted by recent activity (most active clusters first).
 */
export function getTopicClusters(project: string): Array<{
  topic: string;
  memoryCount: number;
  avgImportance: number;
  avgDistance: number;
  recentActivity: number;
}> {
  const memories = getMemoriesByProject(project);

  if (memories.length === 0) return [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Build cluster map using primary tag (first tag in the array)
  const clusterMap = new Map<string, {
    count: number;
    importanceSum: number;
    distanceSum: number;
    recentActivity: number;
  }>();

  for (const memory of memories) {
    const primaryTag = memory.tags[0];
    if (!primaryTag) continue; // skip untagged memories

    const existing = clusterMap.get(primaryTag) ?? {
      count: 0,
      importanceSum: 0,
      distanceSum: 0,
      recentActivity: 0,
    };

    existing.count++;
    existing.importanceSum += memory.importance;
    existing.distanceSum += memory.distance;

    const recentlyAccessed =
      memory.last_accessed_at !== null &&
      memory.last_accessed_at >= sevenDaysAgo;

    if (recentlyAccessed) {
      existing.recentActivity++;
    }

    clusterMap.set(primaryTag, existing);
  }

  return [...clusterMap.entries()]
    .map(([topic, data]) => ({
      topic,
      memoryCount: data.count,
      avgImportance: data.importanceSum / data.count,
      avgDistance: data.distanceSum / data.count,
      recentActivity: data.recentActivity,
    }))
    .sort((a, b) => b.recentActivity - a.recentActivity || b.memoryCount - a.memoryCount);
}

// ---------------------------------------------------------------------------
// detectAccessPatterns
// ---------------------------------------------------------------------------

/**
 * Detect periodic access patterns from orbit_log entries.
 *
 * Heuristics:
 *   - Daily pattern: a tag/group accessed multiple times in a day consistently
 *   - Weekly pattern: accesses concentrated on specific day-of-week
 *   - Burst pattern: high access concentration in recent days
 */
export function detectAccessPatterns(project: string): Array<{
  pattern: string;
  description: string;
  frequency: string;
}> {
  const accessRows = getAccessEventLog(project, 30);

  if (accessRows.length === 0) return [];

  const patterns: Array<{ pattern: string; description: string; frequency: string }> = [];

  // Day-of-week analysis
  const dowCounts = new Array(7).fill(0);
  const hourCounts = new Array(24).fill(0);

  for (const row of accessRows) {
    const d = new Date(row.created_at);
    dowCounts[d.getDay()]++;
    hourCounts[d.getHours()]++;
  }

  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const avgPerDay = accessRows.length / 7;

  // Find days with significantly above-average access (>2x average)
  const activeDays = dowCounts
    .map((count, day) => ({ day, count }))
    .filter(d => d.count > avgPerDay * 2)
    .sort((a, b) => b.count - a.count);

  if (activeDays.length > 0) {
    const dayNames = activeDays.map(d => DOW_NAMES[d.day]).join(', ');
    patterns.push({
      pattern: 'weekly',
      description: `Memory access concentrated on ${dayNames}`,
      frequency: `${activeDays[0]!.count} accesses on peak day`,
    });
  }

  // Find peak hours (>2x average)
  const avgPerHour = accessRows.length / 24;
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter(h => h.count > avgPerHour * 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (peakHours.length > 0) {
    const hourStrs = peakHours.map(h => `${h.hour}:00`).join(', ');
    patterns.push({
      pattern: 'daily',
      description: `Peak memory access at ${hourStrs}`,
      frequency: `${peakHours[0]!.count} accesses in peak hour`,
    });
  }

  // Burst detection: compare last 7 days vs previous 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const recentCount = accessRows.filter(r => r.created_at >= sevenDaysAgo).length;
  const prevCount = accessRows.filter(r => r.created_at >= fourteenDaysAgo && r.created_at < sevenDaysAgo).length;

  if (recentCount > prevCount * 2 && recentCount >= 5) {
    patterns.push({
      pattern: 'burst',
      description: `Memory access surged this week (${recentCount} vs ${prevCount} prior week)`,
      frequency: `${recentCount} accesses in last 7 days`,
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// getMemoryHealth
// ---------------------------------------------------------------------------

/**
 * Compute health metrics and generate actionable recommendations.
 */
export function getMemoryHealth(project: string): {
  totalMemories: number;
  activeRatio: number;
  staleRatio: number;
  qualityAvg: number;
  conflictRatio: number;
  consolidationOpportunities: number;
  recommendations: string[];
} {
  const memories = getMemoriesByProject(project);
  const totalMemories = memories.length;

  if (totalMemories === 0) {
    return {
      totalMemories: 0,
      activeRatio: 0,
      staleRatio: 0,
      qualityAvg: 0,
      conflictRatio: 0,
      consolidationOpportunities: 0,
      recommendations: ['No memories found. Start storing memories with the remember tool.'],
    };
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Active = core + near (distance < 15.0 AU in 4-zone system)
  const activeCount = memories.filter(m => m.distance < ORBIT_ZONES.near.max).length;
  const activeRatio = activeCount / totalMemories;

  // Stale = not accessed in 30+ days
  const staleCount = memories.filter(m => {
    const lastAccess = m.last_accessed_at ?? m.created_at;
    return lastAccess < thirtyDaysAgo;
  }).length;
  const staleRatio = staleCount / totalMemories;

  // Quality average
  const qualityValues = memories
    .map(m => m.quality_score)
    .filter((q): q is number => q !== undefined && q !== null);
  const qualityAvg = qualityValues.length > 0
    ? qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length
    : 0.5;

  // Conflicts
  const openConflicts = getConflicts(project, 'open');
  const conflictRatio = openConflicts.length / totalMemories;

  // Consolidation opportunities: memories with consolidated_into set
  // indicate past consolidations; estimate future opportunities by finding
  // memories with very similar summaries (same type + close distance + similar importance)
  const consolidationOpportunities = estimateConsolidationOpportunities(memories);

  // Build recommendations
  const recommendations: string[] = [];

  if (staleCount > 10) {
    recommendations.push(
      `${staleCount} memories have not been accessed in 30+ days. Run orbit to recalculate positions.`
    );
  }

  if (consolidationOpportunities > 3) {
    recommendations.push(
      `${consolidationOpportunities} similar memories may be consolidatable. Run consolidate to merge them.`
    );
  }

  if (openConflicts.length > 0) {
    recommendations.push(
      `${openConflicts.length} unresolved conflict${openConflicts.length > 1 ? 's' : ''} detected. Review and resolve them.`
    );
  }

  if (qualityAvg < 0.4 && qualityValues.length > 0) {
    recommendations.push(
      'Average quality score is below 0.4. Store more specific, actionable memories.'
    );
  }

  if (activeRatio < 0.3 && totalMemories > 20) {
    recommendations.push(
      `Only ${Math.round(activeRatio * 100)}% of memories are in active zones. Run orbit to refresh positions.`
    );
  }

  return {
    totalMemories,
    activeRatio,
    staleRatio,
    qualityAvg,
    conflictRatio,
    consolidationOpportunities,
    recommendations,
  };
}

/**
 * Estimate how many memories could be consolidated.
 * Heuristic: same type AND within similar importance range (±0.1) AND similar distance.
 * We use a simple O(n²) check bounded at n=200 to avoid performance issues.
 */
function estimateConsolidationOpportunities(
  memories: Array<{ type: string; importance: number; distance: number; summary: string }>
): number {
  const sample = memories.slice(0, 200);
  const visited = new Set<number>();
  let count = 0;

  for (let i = 0; i < sample.length; i++) {
    if (visited.has(i)) continue;
    for (let j = i + 1; j < sample.length; j++) {
      if (visited.has(j)) continue;
      const a = sample[i]!;
      const b = sample[j]!;
      if (
        a.type === b.type &&
        Math.abs(a.importance - b.importance) < 0.1 &&
        Math.abs(a.distance - b.distance) < 5
      ) {
        count++;
        visited.add(j);
        break; // one pair per memory — don't double count
      }
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------

/**
 * Compile all analytics into a readable text report.
 * Suitable for display in terminal or chat.
 */
export function generateReport(project: string): string {
  const analytics = getFullAnalytics(project);
  const health = getMemoryHealth(project);
  const clusters = getTopicClusters(project).slice(0, 5);
  const patterns = detectAccessPatterns(project);
  const topTags = getTopTags(project, 10);

  const lines: string[] = [
    `# Stellar Memory Report — Project: ${project}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Overview',
    `Total memories:     ${analytics.total_memories}`,
    `Average importance: ${(analytics.avg_importance * 100).toFixed(1)}%`,
    `Average quality:    ${(analytics.avg_quality * 100).toFixed(1)}%`,
    `Recall success rate: ${(analytics.recall_success_rate * 100).toFixed(1)}%`,
    `Consolidations:     ${analytics.consolidation_count}`,
    `Open conflicts:     ${analytics.conflict_count}`,
    '',
    '## Zone Distribution',
  ];

  const zoneOrder = ['core', 'near', 'stored', 'forgotten'];
  for (const zone of zoneOrder) {
    const count = analytics.zone_distribution[zone] ?? 0;
    const bar = '#'.repeat(Math.min(20, count));
    lines.push(`  ${zone.padEnd(10)} ${String(count).padStart(4)}  ${bar}`);
  }

  lines.push('');
  lines.push('## Type Distribution');
  for (const [type, count] of Object.entries(analytics.type_distribution).sort(([, a], [, b]) => b - a)) {
    lines.push(`  ${type.padEnd(12)} ${count}`);
  }

  if (topTags.length > 0) {
    lines.push('');
    lines.push('## Top Tags');
    for (const { tag, count } of topTags) {
      lines.push(`  ${tag.padEnd(20)} ${count}`);
    }
  }

  if (clusters.length > 0) {
    lines.push('');
    lines.push('## Active Topic Clusters');
    for (const cluster of clusters) {
      lines.push(
        `  ${cluster.topic.padEnd(20)} ${cluster.memoryCount} memories` +
        `  avg importance: ${(cluster.avgImportance * 100).toFixed(0)}%` +
        `  recent activity: ${cluster.recentActivity}`
      );
    }
  }

  if (patterns.length > 0) {
    lines.push('');
    lines.push('## Access Patterns');
    for (const p of patterns) {
      lines.push(`  [${p.pattern}] ${p.description} (${p.frequency})`);
    }
  }

  lines.push('');
  lines.push('## Health Assessment');
  lines.push(`Active ratio:   ${(health.activeRatio * 100).toFixed(1)}%`);
  lines.push(`Stale ratio:    ${(health.staleRatio * 100).toFixed(1)}%`);
  lines.push(`Conflict ratio: ${(health.conflictRatio * 100).toFixed(1)}%`);
  lines.push(`Consolidation opportunities: ${health.consolidationOpportunities}`);

  if (health.recommendations.length > 0) {
    lines.push('');
    lines.push('## Recommendations');
    for (const rec of health.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }

  return lines.join('\n');
}
