/**
 * sun.ts — Sun state management
 *
 * The "sun" is the gravitational centre of the memory system: it holds the
 * current working context (what the AI is doing right now).  Every memory
 * planet orbits the sun at a distance inversely proportional to its relevance
 * to the current work.
 *
 * Responsibilities:
 *   - commitToSun  : persist a new work snapshot and create decision memories.
 *   - getSunContent: produce the formatted MCP resource text within token budget.
 *   - formatSunContent: pure formatter used by getSunContent and tests.
 */

import type { SunState, Memory } from './types.js';
import {
  getSunState,
  upsertSunState,
} from '../storage/queries.js';
import { estimateTokens } from '../utils/tokenizer.js';
import { getConfig } from '../utils/config.js';
import { createMemory } from './planet.js';
import { corona } from './corona.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current sun content formatted for an MCP resource.
 * Guaranteed to stay under the configured sunTokenBudget.
 */
export function getSunContent(project: string): string {
  const sun = getSunState(project);

  if (!sun) {
    return `[STELLAR MEMORY - project: ${project}]\n\nNo memories committed yet. Use stellar_commit to record your current work.`;
  }

  // Read from the corona in-memory cache instead of hitting the DB.
  const coreMemories = corona.getCoreMemories();
  const nearMemories = corona.getNearMemories();
  return formatSunContent(sun, coreMemories, nearMemories);
}

/**
 * Update the sun state from a commit.
 *
 * Steps:
 *   1. Fetch or initialise sun state for the project.
 *   2. Merge the incoming data (new fields overwrite old ones).
 *   3. Auto-create a 'decision' memory planet for each supplied decision.
 *   4. Count tokens and persist via upsertSunState.
 */
export function commitToSun(
  project: string,
  data: {
    current_work: string;
    decisions: string[];
    next_steps: string[];
    errors: string[];
    context?: string;
  },
): void {
  const config = getConfig();

  // Persist each decision as its own memory planet so it enters the orbital
  // system and can be recalled later.
  for (const decision of data.decisions) {
    if (decision.trim().length > 0) {
      createMemory({
        project,
        content: decision,
        type:    'decision',
      });
    }
  }

  // Build the updated sun state object.
  const now = new Date().toISOString();

  const existing = getSunState(project);

  const updated: SunState = {
    project,
    content:          data.current_work,
    current_work:     data.current_work,
    recent_decisions: data.decisions,
    next_steps:       data.next_steps,
    active_errors:    data.errors,
    project_context:  data.context ?? (existing?.project_context ?? ''),
    token_count:      0,         // computed below
    last_commit_at:   now,
    updated_at:       now,
  };

  // Calculate token usage for the formatted sun content so the consumer can
  // make informed truncation decisions.
  const coreMemories  = corona.getCoreMemories();
  const nearMemories  = corona.getNearMemories();
  const formatted     = formatSunContent(updated, coreMemories, nearMemories);
  updated.token_count = estimateTokens(formatted);

  // Warn in dev if we exceed the budget — the consumer (getSunContent) is
  // responsible for truncation, but we record the real count here.
  if (updated.token_count > config.sunTokenBudget) {
    process.stderr.write(
      `[sun] token count ${updated.token_count} exceeds budget ${config.sunTokenBudget} for project "${project}"\n`,
    );
  }

  upsertSunState(updated);
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Format sun state into readable text for the MCP resource.
 *
 * Sections are added in priority order. Each section is checked against the
 * remaining token budget before being appended (progressive truncation).
 * This ensures the most critical context always fits regardless of budget.
 *
 * New priority order (Corona-aware):
 *   1. Header
 *   2. CORE IDENTITY — core zone memories (instant recall, ~40% budget)
 *   3. WORKING ON (current_work, ~10%)
 *   4. ACTIVE CONTEXT — near zone memories (~25%)
 *   5. RECENT DECISIONS / NEXT STEPS / ACTIVE ISSUES (~25%)
 */
export function formatSunContent(
  sun: SunState,
  coreMemories: Memory[],
  nearMemories: Memory[],
): string {
  const config = getConfig();
  const budget = config.sunTokenBudget;

  const MAX_CORE_DISPLAY = 10;
  const MAX_NEAR_DISPLAY = 10;

  // Build candidate sections in priority order.
  const sections: string[] = [];

  // 1. Header — always included.
  sections.push(`[STELLAR MEMORY - project: ${sun.project}]`);

  // 2. CORE IDENTITY — core zone memories (distance < 1.0 AU).
  if (coreMemories.length > 0) {
    const displayed = coreMemories.slice(0, MAX_CORE_DISPLAY);
    const lines = displayed
      .map(m => `  [${m.distance.toFixed(1)} AU] ${m.summary}`)
      .join('\n');
    const overflow = coreMemories.length > MAX_CORE_DISPLAY
      ? `\n  (${coreMemories.length - MAX_CORE_DISPLAY} more)`
      : '';
    sections.push(`\nCORE IDENTITY (${coreMemories.length}):\n${lines}${overflow}`);
  }

  // 3. Current work.
  if (sun.current_work && sun.current_work.trim().length > 0) {
    sections.push(`\nWORKING ON:\n${sun.current_work.trim()}`);
  }

  // 4. ACTIVE CONTEXT — near zone memories (1.0-5.0 AU).
  if (nearMemories.length > 0) {
    const displayed = nearMemories.slice(0, MAX_NEAR_DISPLAY);
    const lines = displayed
      .map(m => `  [${m.distance.toFixed(1)} AU] ${m.summary}`)
      .join('\n');
    const overflow = nearMemories.length > MAX_NEAR_DISPLAY
      ? `\n  (${nearMemories.length - MAX_NEAR_DISPLAY} more)`
      : '';
    sections.push(`\nACTIVE CONTEXT (${nearMemories.length}):\n${lines}${overflow}`);
  }

  // 5. Recent decisions (max 3).
  const decisions = sun.recent_decisions.slice(0, 3);
  if (decisions.length > 0) {
    const lines = decisions.map((d, i) => `  ${i + 1}. ${d}`).join('\n');
    sections.push(`\nRECENT DECISIONS:\n${lines}`);
  }

  // 6. Next steps (max 3).
  const steps = sun.next_steps.slice(0, 3);
  if (steps.length > 0) {
    const lines = steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    sections.push(`\nNEXT STEPS:\n${lines}`);
  }

  // 7. Active issues (max 2).
  const errors = sun.active_errors.slice(0, 2);
  if (errors.length > 0) {
    const lines = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    sections.push(`\nACTIVE ISSUES:\n${lines}`);
  }

  // Progressive truncation: accumulate sections until we hit the token budget.
  let result = '';
  for (const section of sections) {
    const candidate = result + (result.length > 0 ? '\n' : '') + section;
    if (estimateTokens(candidate) > budget) {
      // This section would push us over — stop here.
      break;
    }
    result = candidate;
  }

  // Always return at least the header even if it alone exceeds the budget
  // (highly unlikely but handles pathological configs).
  if (result.length === 0) {
    result = sections[0] ?? `[STELLAR MEMORY - project: ${sun.project}]`;
  }

  return result;
}
