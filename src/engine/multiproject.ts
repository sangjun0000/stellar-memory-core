/**
 * multiproject.ts — Multi-Project Galaxy management
 *
 * Manages runtime project switching and cross-project knowledge sharing.
 * Universal memories are memories marked to appear in ALL project recall results.
 *
 * State: currentProject is the one mutable singleton in this module.
 *        All other functions are pure queries or side-effectful writes to the DB.
 */

import type { Memory } from './types.js';
import {
  getUniversalMemories,
  setUniversal,
  listProjects,
  upsertSunState,
  getSunState,
  getMemoriesByProject,
} from '../storage/queries.js';
import { getDatabase } from '../storage/database.js';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { corona } from './corona.js';

const log = createLogger('multiproject');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentProject: string = getConfig().defaultProject;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PROJECT_NAME_RE = /^[a-zA-Z0-9-]{1,50}$/;

function validateProjectName(name: string): void {
  if (!PROJECT_NAME_RE.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Must be 1-50 alphanumeric characters or hyphens.`
    );
  }
}

// ---------------------------------------------------------------------------
// getCurrentProject
// ---------------------------------------------------------------------------

/**
 * Return the currently active project name.
 */
export function getCurrentProject(): string {
  return currentProject;
}

// ---------------------------------------------------------------------------
// switchProject
// ---------------------------------------------------------------------------

/**
 * Switch the active project at runtime without restarting.
 *
 * Returns info about the transition so callers can report it to the user.
 */
export function switchProject(project: string): {
  previous: string;
  current: string;
  memoryCount: number;
} {
  validateProjectName(project);

  const previous = currentProject;
  currentProject = project;

  log.info('Switched project', { previous, current: project });

  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as { count: number } | undefined;

  const memoryCount = row?.count ?? 0;

  // Reload the corona cache for the new project.
  corona.switchProject(project);

  return { previous, current: project, memoryCount };
}

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

/**
 * Create a new project by seeding a sun_state entry for it.
 * If the project already has a sun_state, returns created=false.
 */
export function createProject(name: string): { project: string; created: boolean } {
  validateProjectName(name);

  const existing = getSunState(name);
  if (existing) {
    log.debug('Project already exists', { project: name });
    return { project: name, created: false };
  }

  upsertSunState({ project: name });
  log.info('Created new project', { project: name });

  return { project: name, created: true };
}

// ---------------------------------------------------------------------------
// listAllProjects
// ---------------------------------------------------------------------------

/**
 * List all projects with basic statistics.
 * Always includes 'default' even if it has no memories yet.
 */
export function listAllProjects(): Array<{
  project: string;
  memoryCount: number;
  lastUpdated: string;
  hasUniversal: boolean;
}> {
  const projectCounts = listProjects();

  // Build lookup map from DB results
  const countMap = new Map(projectCounts.map(p => [p.project, p.count]));

  // Ensure 'default' is always in the list
  if (!countMap.has('default')) {
    countMap.set('default', 0);
  }

  const db = getDatabase();

  return [...countMap.entries()].map(([project, memoryCount]) => {
    // Get last updated timestamp for this project
    const lastRow = db.prepare(`
      SELECT MAX(updated_at) as last_updated FROM memories
      WHERE project = ? AND deleted_at IS NULL
    `).get(project) as { last_updated: string | null } | undefined;

    const lastUpdated = lastRow?.last_updated ?? new Date().toISOString();

    // Check if this project has any universal memories
    const univRow = db.prepare(`
      SELECT COUNT(*) as count FROM memories
      WHERE project = ? AND is_universal = 1 AND deleted_at IS NULL
    `).get(project) as { count: number } | undefined;

    const hasUniversal = (univRow?.count ?? 0) > 0;

    return { project, memoryCount, lastUpdated, hasUniversal };
  }).sort((a, b) => b.memoryCount - a.memoryCount);
}

// ---------------------------------------------------------------------------
// markUniversal
// ---------------------------------------------------------------------------

/**
 * Mark (or unmark) a memory as universal.
 * Universal memories surface in recall results for all projects.
 */
export function markUniversal(memoryId: string, isUniversal: boolean): void {
  setUniversal(memoryId, isUniversal);
  log.info('Updated universal flag', { memoryId, isUniversal });
}

// ---------------------------------------------------------------------------
// getUniversalContext
// ---------------------------------------------------------------------------

/**
 * Get universal memories relevant to a project.
 * Filters out memories that already belong to the current project
 * (no need to surface them twice) and sorts by importance.
 */
export function getUniversalContext(project: string, limit = 20): Memory[] {
  const universals = getUniversalMemories(limit * 2);

  return universals
    .filter(m => m.project !== project)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// detectUniversalCandidates
// ---------------------------------------------------------------------------

// Words/patterns that suggest project-specific content
const PROJECT_SPECIFIC_PATTERNS = [
  /\b(this project|our project|this repo|this codebase)\b/i,
  /\b(localhost|127\.0\.0\.1|:3000|:8080)\b/i,
  /\bTODO\b/,
];

function looksProjectSpecific(content: string): boolean {
  return PROJECT_SPECIFIC_PATTERNS.some(re => re.test(content));
}

/**
 * Detect memories that are strong candidates to become universal.
 *
 * Criteria:
 *   - type = 'procedural' (behavioral rules are generally universal)
 *   - type = 'context' with generic technical content (no project-specific terms)
 *   - importance > 0.8 (highly important knowledge tends to be broadly applicable)
 *   - not already marked universal
 */
export function detectUniversalCandidates(project: string): Memory[] {
  const memories = getMemoriesByProject(project);

  return memories.filter(m => {
    if (m.is_universal) return false;           // already universal
    if (looksProjectSpecific(m.content)) return false;

    if (m.type === 'procedural') return true;
    if (m.type === 'context' && !looksProjectSpecific(m.content)) return true;
    if (m.importance > 0.8) return true;

    return false;
  });
}

// ---------------------------------------------------------------------------
// getProjectStats
// ---------------------------------------------------------------------------

/**
 * Detailed statistics for a single project.
 */
export function getProjectStats(project: string): {
  memoryCount: number;
  zoneDistribution: Record<string, number>;
  typeDistribution: Record<string, number>;
  universalCount: number;
  oldestMemory: string;
  newestMemory: string;
} {
  const db = getDatabase();

  // Basic count
  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as { count: number } | undefined;

  const memoryCount = countRow?.count ?? 0;

  // Zone distribution
  const zoneRows = db.prepare(`
    SELECT
      CASE
        WHEN distance < 1.0  THEN 'core'
        WHEN distance < 5.0  THEN 'near'
        WHEN distance < 15.0 THEN 'active'
        WHEN distance < 40.0 THEN 'archive'
        WHEN distance < 70.0 THEN 'fading'
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

  // Type distribution
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

  // Universal count
  const univRow = db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE project = ? AND is_universal = 1 AND deleted_at IS NULL
  `).get(project) as { count: number } | undefined;

  const universalCount = univRow?.count ?? 0;

  // Date range
  const rangeRow = db.prepare(`
    SELECT MIN(created_at) as oldest, MAX(created_at) as newest
    FROM memories
    WHERE project = ? AND deleted_at IS NULL
  `).get(project) as { oldest: string | null; newest: string | null } | undefined;

  const oldestMemory = rangeRow?.oldest ?? '';
  const newestMemory = rangeRow?.newest ?? '';

  return {
    memoryCount,
    zoneDistribution,
    typeDistribution,
    universalCount,
    oldestMemory,
    newestMemory,
  };
}
