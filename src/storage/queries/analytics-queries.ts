/**
 * storage/queries/analytics-queries.ts — Analytics and reporting queries
 */

import { getDatabase } from '../database.js';
import type { MemoryAnalytics } from '../../engine/types.js';
import { parseJsonArray } from './shared.js';

export function getTopTags(project: string, limit = 20): Array<{ tag: string; count: number }> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT tags FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).all(project) as unknown[];

  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    const row = r as { tags: string };
    const tags = parseJsonArray(row.tags);
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function getActivityTimeline(
  project: string,
  days = 30
): Array<{ date: string; created: number; accessed: number }> {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const createdRows = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM memories
    WHERE project = ? AND date(created_at) >= ?
    GROUP BY date(created_at)
  `).all(project, cutoff) as unknown[];

  const accessedRows = db.prepare(`
    SELECT date(last_accessed_at) as date, COUNT(*) as count
    FROM memories
    WHERE project = ?
      AND last_accessed_at IS NOT NULL
      AND date(last_accessed_at) >= ?
    GROUP BY date(last_accessed_at)
  `).all(project, cutoff) as unknown[];

  const timeline = new Map<string, { created: number; accessed: number }>();

  for (const r of createdRows) {
    const row = r as { date: string; count: number };
    const entry = timeline.get(row.date) ?? { created: 0, accessed: 0 };
    entry.created = row.count;
    timeline.set(row.date, entry);
  }

  for (const r of accessedRows) {
    const row = r as { date: string; count: number };
    const entry = timeline.get(row.date) ?? { created: 0, accessed: 0 };
    entry.accessed = row.count;
    timeline.set(row.date, entry);
  }

  return [...timeline.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getRecallSuccessRate(project: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN access_count > 0 THEN 1 ELSE 0 END) as accessed
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as unknown;

  const row = result as { total: number; accessed: number } | undefined;
  if (!row || row.total === 0) return 0;
  return row.accessed / row.total;
}

export function getAnalytics(project: string): MemoryAnalytics {
  const db = getDatabase();

  const statsRow = db.prepare(`
    SELECT
      COUNT(*) as total_memories,
      AVG(CASE WHEN quality_score IS NOT NULL THEN quality_score ELSE 0.5 END) as avg_quality,
      AVG(importance) as avg_importance,
      SUM(CASE WHEN consolidated_into IS NOT NULL THEN 1 ELSE 0 END) as consolidation_count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as unknown;

  const stats = (statsRow ?? {}) as {
    total_memories: number;
    avg_quality: number;
    avg_importance: number;
    consolidation_count: number;
  };

  const zoneRows = db.prepare(`
    SELECT
      CASE
        WHEN distance < 3.0  THEN 'core'
        WHEN distance < 15.0 THEN 'near'
        WHEN distance < 60.0 THEN 'stored'
        ELSE 'forgotten'
      END as zone,
      COUNT(*) as count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
    GROUP BY zone
  `).all(project) as unknown[];

  const zone_distribution: Record<string, number> = {};
  for (const r of zoneRows) {
    const row = r as { zone: string; count: number };
    zone_distribution[row.zone] = row.count;
  }

  const typeRows = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
    GROUP BY type
  `).all(project) as unknown[];

  const type_distribution: Record<string, number> = {};
  for (const r of typeRows) {
    const row = r as { type: string; count: number };
    type_distribution[row.type] = row.count;
  }

  const conflictRow = db.prepare(`
    SELECT COUNT(*) as count FROM memory_conflicts
    WHERE project = ? AND status = 'open'
  `).get(project) as unknown;
  const conflict_count = ((conflictRow as { count: number } | undefined)?.count) ?? 0;

  const timelineRows = getActivityTimeline(project, 30);
  const activity_timeline = timelineRows.map((row) => ({
    date: row.date,
    created: row.created,
    accessed: row.accessed,
    forgotten: 0,
  }));

  return {
    total_memories: stats.total_memories ?? 0,
    zone_distribution,
    type_distribution,
    avg_quality: stats.avg_quality ?? 0.5,
    avg_importance: stats.avg_importance ?? 0.5,
    recall_success_rate: getRecallSuccessRate(project),
    consolidation_count: stats.consolidation_count ?? 0,
    conflict_count,
    top_tags: getTopTags(project),
    activity_timeline,
  };
}

/**
 * Survival curve data — used by analytics.ts getSurvivalCurve().
 */
export function getSurvivalData(project: string): Array<{
  age_days: number;
  distance: number;
  access_count: number;
  deleted_at: string | null;
}> {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      CAST(
        (julianday('now') - julianday(created_at)) AS INTEGER
      ) as age_days,
      distance,
      access_count,
      deleted_at
    FROM memories
    WHERE project = ?
  `).all(project) as Array<{
    age_days: number;
    distance: number;
    access_count: number;
    deleted_at: string | null;
  }>;
}

/**
 * Orbit movement history — used by analytics.ts getOrbitMovements().
 */
export function getOrbitMovementLog(project: string, days: number): Array<{
  memory_id: string;
  old_distance: number;
  new_distance: number;
  trigger: string;
  created_at: string;
  summary: string | null;
}> {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT ol.memory_id, ol.old_distance, ol.new_distance, ol.trigger, ol.created_at,
           m.summary
    FROM orbit_log ol
    LEFT JOIN memories m ON m.id = ol.memory_id
    WHERE ol.project = ? AND ol.created_at >= ?
    ORDER BY ol.created_at ASC
  `).all(project, cutoff) as Array<{
    memory_id: string;
    old_distance: number;
    new_distance: number;
    trigger: string;
    created_at: string;
    summary: string | null;
  }>;
}

/**
 * Access pattern data for a project — used by analytics.ts detectAccessPatterns().
 */
export function getAccessEventLog(project: string, days: number): Array<{
  memory_id: string;
  created_at: string;
}> {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT memory_id, created_at
    FROM orbit_log
    WHERE project = ? AND trigger = 'access' AND created_at >= ?
    ORDER BY created_at ASC
  `).all(project, cutoff) as Array<{ memory_id: string; created_at: string }>;
}

/**
 * Per-project stats for multiproject.ts listAllProjects().
 */
export function getProjectLastUpdated(project: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT MAX(updated_at) as last_updated FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as { last_updated: string | null } | undefined;
  return row?.last_updated ?? null;
}

export function getProjectHasUniversal(project: string): boolean {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND is_universal = 1 AND deleted_at IS NULL
  `).get(project) as { count: number } | undefined;
  return (row?.count ?? 0) > 0;
}

export function getProjectMemoryCount(project: string): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Detailed zone + type distribution for a single project (multiproject.ts getProjectStats).
 */
export function getProjectDistributions(project: string): {
  zoneDistribution: Record<string, number>;
  typeDistribution: Record<string, number>;
  universalCount: number;
  oldestMemory: string;
  newestMemory: string;
} {
  const db = getDatabase();

  const zoneRows = db.prepare(`
    SELECT
      CASE
        WHEN distance < 3.0  THEN 'core'
        WHEN distance < 15.0 THEN 'near'
        WHEN distance < 60.0 THEN 'stored'
        ELSE 'forgotten'
      END as zone,
      COUNT(*) as count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
    GROUP BY zone
  `).all(project) as Array<{ zone: string; count: number }>;

  const zoneDistribution: Record<string, number> = {};
  for (const row of zoneRows) {
    zoneDistribution[row.zone] = row.count;
  }

  const typeRows = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
    GROUP BY type
  `).all(project) as Array<{ type: string; count: number }>;

  const typeDistribution: Record<string, number> = {};
  for (const row of typeRows) {
    typeDistribution[row.type] = row.count;
  }

  const univRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND is_universal = 1 AND deleted_at IS NULL
  `).get(project) as { count: number } | undefined;

  const universalCount = univRow?.count ?? 0;

  const rangeRow = db.prepare(`
    SELECT MIN(created_at) as oldest, MAX(created_at) as newest
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as { oldest: string | null; newest: string | null } | undefined;

  return {
    zoneDistribution,
    typeDistribution,
    universalCount,
    oldestMemory: rangeRow?.oldest ?? '',
    newestMemory: rangeRow?.newest ?? '',
  };
}
