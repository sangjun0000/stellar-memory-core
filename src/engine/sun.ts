/**
 * sun.ts ??Sun state management
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
  getRecentMemories,
  getConflicts,
} from '../storage/queries.js';
import { getDatabase } from '../storage/database.js';
import { estimateTokens } from '../utils/tokenizer.js';
import { getConfig } from '../utils/config.js';
import { filterActiveMemories } from './validity.js';
import { createMemory } from './planet.js';
import { corona } from './corona.js';
import { getSessionCommitDraft } from './session-policy.js';

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

  // Read from the corona in-memory cache instead of hitting the DB (single pass).
  const { core, near } = corona.getCoreAndNear();
  const coreMemories = filterActiveMemories(core);
  const nearMemories = filterActiveMemories(near);
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

  // Refresh corona cache before token estimation to avoid stale data.
  corona.warmup(project);
  const { core: coreMemories, near: nearMemories } = corona.getCoreAndNear();
  const formatted     = formatSunContent(updated, coreMemories, nearMemories);
  updated.token_count = estimateTokens(formatted);

  // Warn in dev if we exceed the budget ??the consumer (getSunContent) is
  // responsible for truncation, but we record the real count here.
  if (updated.token_count > config.sunTokenBudget) {
    process.stderr.write(
      `[sun] token count ${updated.token_count} exceeds budget ${config.sunTokenBudget} for project "${project}"\n`,
    );
  }

  upsertSunState(updated);
}

// ---------------------------------------------------------------------------
// Proactive alerts
// ---------------------------------------------------------------------------

/**
 * Build an array of single-line alert strings (max 100 chars each) for the
 * ALERTS section of the sun context.  Priorities:
 *   1. Unresolved conflicts (high urgency)
 *   2. Stale task memories (> 7 days old, never accessed)
 *   3. Core/near decision memories related to current work
 *
 * Returns at most MAX_ALERTS entries.
 */
function generateProactiveAlerts(
  project: string,
  coreMemories: Memory[],
  nearMemories: Memory[],
  sun: SunState,
): string[] {
  const MAX_ALERTS = 5;
  const MAX_ALERT_LEN = 100;
  const alerts: string[] = [];

  const trunc = (s: string): string =>
    s.length > MAX_ALERT_LEN ? s.slice(0, MAX_ALERT_LEN - 3).trimEnd() + '...' : s;

  // 1. Unresolved conflicts
  try {
    const conflicts = getConflicts(project, 'open');
    for (const c of conflicts.slice(0, 2)) {
      const desc = c.description.slice(0, 60);
      alerts.push(trunc(`! CONFLICT: ${desc}`));
      if (alerts.length >= MAX_ALERTS) return alerts;
    }
  } catch {
    // Non-fatal: conflicts table may not exist in older DBs.
  }

  // 2. Stale tasks (> 7 days old, access_count <= 1)
  try {
    const db = getDatabase();
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT id, summary, created_at, access_count
      FROM memories
      WHERE project = ?
        AND type = 'task'
        AND access_count <= 1
        AND created_at < ?
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 3
    `).all(project, cutoff) as Array<{
      id: string;
      summary: string;
      created_at: string;
      access_count: number;
    }>;

    for (const row of rows) {
      const ageMs = Date.now() - new Date(
        /[Zz]$|[+-]\d{2}:\d{2}$/.test(row.created_at)
          ? row.created_at
          : row.created_at + 'Z'
      ).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      const accessed = row.access_count === 0 ? 'never accessed' : 'rarely accessed';
      const summary = row.summary.length > 40
        ? row.summary.slice(0, 40).trimEnd() + '...'
        : row.summary;
      alerts.push(trunc(`STALE TASK: "${summary}" (${ageDays}d ago, ${accessed})`));
      if (alerts.length >= MAX_ALERTS) return alerts;
    }
  } catch {
    // Non-fatal: skip stale task alerts if DB query fails.
  }

  // 3. Recent decisions in core/near that may relate to current work
  if (sun.current_work && sun.current_work.trim().length > 0) {
    const currentWorkWords = new Set(
      sun.current_work.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    const decisionCandidates = [...coreMemories, ...nearMemories]
      .filter(m => m.type === 'decision');

    for (const m of decisionCandidates) {
      if (alerts.length >= MAX_ALERTS) break;
      const summaryWords = m.summary.toLowerCase().split(/\s+/);
      const hasOverlap = summaryWords.some(w => w.length > 3 && currentWorkWords.has(w));
      if (!hasOverlap) continue;

      const ageMs = Date.now() - new Date(
        /[Zz]$|[+-]\d{2}:\d{2}$/.test(m.created_at)
          ? m.created_at
          : m.created_at + 'Z'
      ).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      const ageStr = ageDays === 0 ? 'today' : `${ageDays}d ago`;
      const summary = m.summary.length > 45
        ? m.summary.slice(0, 45).trimEnd() + '...'
        : m.summary;
      alerts.push(trunc(`DECISION: "${summary}" (${ageStr}) -- may relate to current work`));
    }
  }

  return alerts;
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
 * Priority order (Corona-aware):
 *   1. Header
 *   2. ALERTS    -- proactive conflict/stale-task/decision notices (high priority)
 *   3. CORE      -- core zone memories (instant recall, ~40% budget)
 *   4. WORKING ON  (current_work, ~10%)
 *   5. NEAR      -- near zone memories (~25%)
 *   6. RECENT DECISIONS / NEXT STEPS / ACTIVE ISSUES (~25%)
 *
 * IMPORTANT: Callers must NOT append additional content to the result.
 * All sections (alerts, core, near, working state) are budget-managed here.
 */
export function formatSunContent(
  sun: SunState,
  coreMemories: Memory[],
  nearMemories: Memory[],
): string {
  const config = getConfig();
  const budget = config.sunTokenBudget;
  const activeCoreMemories = filterActiveMemories(coreMemories);
  const activeNearMemories = filterActiveMemories(nearMemories);

  const MAX_CORE_DISPLAY = 5;
  const MAX_NEAR_DISPLAY = 5;
  const SUMMARY_LIMIT = 80;

  /** Truncate summary to SUMMARY_LIMIT characters. */
  const truncSummary = (s: string): string =>
    s.length > SUMMARY_LIMIT ? s.slice(0, SUMMARY_LIMIT).trimEnd() + '...' : s;

  // Build candidate sections in priority order.
  const sections: string[] = [];

  // 1. Header ??always included. Add [STALE] warning if last commit > 24h ago.
  let header = `[STELLAR MEMORY - project: ${sun.project}]`;
  if (sun.last_commit_at) {
    const lastCommitMs = new Date(
      /[Zz]$|[+-]\d{2}:\d{2}$/.test(sun.last_commit_at)
        ? sun.last_commit_at
        : sun.last_commit_at + 'Z'
    ).getTime();
    const hoursSince = (Date.now() - lastCommitMs) / (1000 * 60 * 60);
    if (hoursSince > 24) {
      header += ` [STALE ??last commit ${Math.floor(hoursSince)}h ago. Run commit to refresh.]`;
    }
  }
  sections.push(header);

  // 2. ALERTS -- proactive notices (conflicts, stale tasks, related decisions).
  // Generated before CORE so high-priority alerts appear near the top of output
  // and are subject to the same progressive budget truncation as other sections.
  const alertLines = generateProactiveAlerts(sun.project, activeCoreMemories, activeNearMemories, sun);
  if (alertLines.length > 0) {
    sections.push(`\nALERTS:\n${alertLines.map(a => `  ${a}`).join('\n')}`);
  }

  // 3. CORE IDENTITY -- core zone memories (distance < 1.0 AU).
  // Compressed format: [TYPE] summary (no AU distance ??saves tokens)
  if (activeCoreMemories.length > 0) {
    const displayed = activeCoreMemories.slice(0, MAX_CORE_DISPLAY);
    const lines = displayed
      .map(m => `  [${m.type.toUpperCase()}] ${truncSummary(m.summary)}`)
      .join('\n');
    const overflow = activeCoreMemories.length > MAX_CORE_DISPLAY
      ? `\n  (+${activeCoreMemories.length - MAX_CORE_DISPLAY} more)`
      : '';
    sections.push(`\nCORE (${activeCoreMemories.length}):\n${lines}${overflow}`);
  }

  // 4. Current work.
  if (sun.current_work && sun.current_work.trim().length > 0) {
    sections.push(`\nWORKING ON:\n${sun.current_work.trim()}`);
  }

  // 5. NEAR zone memories (1.0-5.0 AU).
  if (activeNearMemories.length > 0) {
    const displayed = activeNearMemories.slice(0, MAX_NEAR_DISPLAY);
    const lines = displayed
      .map(m => `  [${m.type.toUpperCase()}] ${truncSummary(m.summary)}`)
      .join('\n');
    const overflow = activeNearMemories.length > MAX_NEAR_DISPLAY
      ? `\n  (+${activeNearMemories.length - MAX_NEAR_DISPLAY} more)`
      : '';
    sections.push(`\nNEAR (${activeNearMemories.length}):\n${lines}${overflow}`);
  }

  // 6. Recent decisions (max 3).
  const decisions = sun.recent_decisions.slice(0, 3);
  if (decisions.length > 0) {
    const lines = decisions.map((d, i) => `  ${i + 1}. ${d}`).join('\n');
    sections.push(`\nRECENT DECISIONS:\n${lines}`);
  }

  // 7. Next steps (max 3).
  const steps = sun.next_steps.slice(0, 3);
  if (steps.length > 0) {
    const lines = steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    sections.push(`\nNEXT STEPS:\n${lines}`);
  }

  // 8. Active issues (max 2).
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
      // This section would push us over ??stop here.
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

// ---------------------------------------------------------------------------
// Auto-commit on process exit
// ---------------------------------------------------------------------------

/**
 * Automatically commit the sun state from recent memories when the
 * MCP server process is shutting down.
 *
 * This prevents session context from being lost when Claude's process
 * ends (e.g., SIGTERM from Claude Desktop, pipe close from Claude Code).
 *
 * Uses synchronous DB calls only ??async is unsafe in exit handlers.
 */
/**
 * Auto-commit modes:
 *   - 'shutdown': final commit on process exit ??always writes
 *   - 'periodic': background timer ??skips if a manual commit happened recently
 */
export function autoCommitOnClose(project: string, mode: 'shutdown' | 'periodic' = 'shutdown'): void {
  try {
    const existing = getSunState(project);
    const sessionDraft = getSessionCommitDraft(project, existing);

    // Protect recent manual commits from being overwritten by auto-generated content.
    // Shutdown: skip if commit < 30 min ago. Periodic: skip if commit < 10 min ago.
    if (existing?.last_commit_at) {
      const lastCommitMs = new Date(
        /[Zz]$|[+-]\d{2}:\d{2}$/.test(existing.last_commit_at)
          ? existing.last_commit_at
          : existing.last_commit_at + 'Z'
      ).getTime();
      const minutesSince = (Date.now() - lastCommitMs) / (1000 * 60);
      const threshold = mode === 'periodic' ? 5 : 30;
      if (minutesSince < threshold) return;
    }

    const recent = getRecentMemories(project, 3);
    if (recent.length === 0 && !sessionDraft) return;

    // Group by type
    const byType = new Map<string, string[]>();
    for (const m of recent) {
      const list = byType.get(m.type) ?? [];
      list.push(m.summary);
      byType.set(m.type, list);
    }

    // Always merge with existing sun state ??never overwrite.
    // Keep existing current_work/decisions and supplement with new memories.
    const current_work = existing?.current_work
      || sessionDraft?.current_work
      || byType.get('context')?.slice(0, 3).join('; ')
      || byType.get('task')?.slice(0, 3).join('; ')
      || `${recent.length} memories from last session`;

    const newDecisions = byType.get('decision')?.slice(0, 5) ?? [];
    const sessionDecisions = sessionDraft?.decisions ?? [];
    const decisions = existing?.recent_decisions?.length
      ? [...existing.recent_decisions, ...sessionDecisions.filter(d => !existing.recent_decisions.includes(d)), ...newDecisions.filter(d => !existing.recent_decisions.includes(d) && !sessionDecisions.includes(d))].slice(0, 10)
      : [...sessionDecisions, ...newDecisions.filter(d => !sessionDecisions.includes(d))].slice(0, 10);

    const newSteps = byType.get('task')?.slice(0, 5) ?? [];
    const sessionSteps = sessionDraft?.next_steps ?? [];
    const next_steps = existing?.next_steps?.length
      ? [...existing.next_steps, ...sessionSteps.filter(s => !existing.next_steps.includes(s)), ...newSteps.filter(s => !existing.next_steps.includes(s) && !sessionSteps.includes(s))].slice(0, 10)
      : [...sessionSteps, ...newSteps.filter(s => !sessionSteps.includes(s))].slice(0, 10);

    const recentErrors = byType.get('error')?.slice(0, 3) ?? [];
    const sessionErrors = sessionDraft?.errors ?? [];
    const errors = [...sessionErrors, ...recentErrors.filter(e => !sessionErrors.includes(e))].slice(0, 5);

    const now = new Date().toISOString();

    const updated: SunState = {
      project,
      content:          current_work,
      current_work,
      recent_decisions: decisions,
      next_steps,
      active_errors:    errors.length > 0 ? errors : (existing?.active_errors ?? []),
      project_context:  existing?.project_context || sessionDraft?.context || '',
      token_count:      0,
      last_commit_at:   now,
      updated_at:       now,
    };

    upsertSunState(updated);

    process.stderr.write(
      `[stellar-memory] Auto-committed sun state (${mode}, ${recent.length} recent memories)\n`
    );
  } catch (err) {
    // Exit handler must never throw ??silently log and continue
    process.stderr.write(
      `[stellar-memory] Auto-commit failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}


