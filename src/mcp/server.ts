/**
 * mcp/server.ts — Thin factory that wires tool handlers to the MCP server.
 *
 * Responsibilities:
 *   1. Instantiate McpServer.
 *   2. Register the stellar://sun resource.
 *   3. Register each tool, forwarding parsed args to the appropriate handler.
 *   4. Inject sun context automatically on the first tool call of each session
 *      so Claude restores context without needing CLAUDE.md protocol instructions.
 *
 * Business logic lives in mcp/tools/. This file contains no logic beyond wiring.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  handleStatus,
  handleCommit,
  handleRecall,
  handleRemember,
  handleOrbit,
  handleForget,
  handleExport,
  handleConstellation,
  handleGalaxy,
  handleAnalytics,
  handleSunResource,
  handleObserve,
  handleConsolidate,
  handleResolveConflict,
  handleTemporal,
} from './tools/memory-tools.js';
import { handleScan } from './tools/ingestion-tools.js';
import { handleDaemon } from './tools/daemon-tool.js';
import { getSunContent } from '../engine/sun.js';
import { getCurrentProject } from '../engine/multiproject.js';

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createStellarServer(): McpServer {
  const server = new McpServer({ name: 'stellar-memory', version: '0.4.0' });

  // ── Session auto-context injection ────────────────────────────────────────
  //
  // Prepend sun context to the first tool response of this server instance.
  //
  // When a new MCP server process starts (= new Claude session), the first
  // tool call the model makes will receive the sun context prepended to its
  // normal response. This restores working context automatically without
  // requiring any CLAUDE.md protocol instructions.
  //
  // The flag is per-server-instance so tests creating multiple servers are
  // not affected by each other.
  let sessionContextInjected = false;

  type McpTextResponse = { content: [{ type: 'text'; text: string }] };

  function withSessionContext(response: McpTextResponse): McpTextResponse {
    if (sessionContextInjected) return response;
    sessionContextInjected = true;

    const project = getCurrentProject();
    const sunContext = getSunContent(project);

    // Only inject if there's meaningful content (not the "no memories yet" placeholder)
    if (sunContext.includes('No memories committed yet')) return response;

    const injected =
      `[STELLAR MEMORY \u2014 SESSION CONTEXT RESTORED]\n${sunContext}\n\n---\n\n${response.content[0].text}`;
    return { content: [{ type: 'text' as const, text: injected }] };
  }

  // ── Resource: stellar://sun ───────────────────────────────────────────────

  server.resource(
    'sun',
    'stellar://sun',
    {
      description:
        'Current working context (the Sun). Contains the active project state, recent decisions, ' +
        'next steps, and the most important memories in the core orbital zone. ' +
        'Reading this resource restores full session context instantly. ' +
        'Read it at the start of every conversation to know what was being worked on.',
      mimeType: 'text/plain',
    },
    (uri) => handleSunResource(uri.href)
  );

  // ── Tool: status ──────────────────────────────────────────────────────────

  server.tool(
    'status',
    'View the current state of your stellar memory system. Shows memories grouped by orbital zone ' +
    '(core = most important, forgotten = least relevant), and optionally lists registered data sources. ' +
    'Call this at the start of a session to see the full memory landscape.',
    {
      zone: z.enum(['all', 'core', 'near', 'active', 'archive', 'fading', 'forgotten'])
        .optional()
        .describe('Filter memories to a specific orbital zone. Defaults to "all".'),
      limit: z.number().int().min(1).max(200)
        .optional()
        .describe('Maximum number of memories to return. Defaults to 50.'),
      show: z.enum(['memories', 'sources', 'all'])
        .optional()
        .describe('What to display: memories, data sources, or both. Default: "memories".'),
    },
    async (args) => withSessionContext(await handleStatus(args))
  );

  // ── Tool: commit ──────────────────────────────────────────────────────────

  server.tool(
    'commit',
    'Save the current session state into the Sun (working context). ' +
    'Preserves current work, decisions made, next steps, and active errors for the next session. ' +
    'Call this before ending a conversation or switching tasks to ensure nothing is lost.',
    {
      current_work: z.string().min(1)
        .describe('A clear description of what you are currently working on.'),
      decisions: z.array(z.string()).optional()
        .describe('Key decisions made during this session.'),
      next_steps: z.array(z.string()).optional()
        .describe('Concrete next actions to take in future sessions.'),
      errors: z.array(z.string()).optional()
        .describe('Active errors or blockers that need attention.'),
      context: z.string().optional()
        .describe('Additional background context for the project.'),
    },
    (args) => handleCommit(args)
  );

  // ── Tool: recall ──────────────────────────────────────────────────────────

  server.tool(
    'recall',
    'Search memories by content and pull relevant ones closer to the Sun. ' +
    'Uses hybrid FTS5 + vector search for best results. ' +
    'Call this when starting work on a specific topic to surface relevant past context.',
    {
      query: z.string().min(1)
        .describe('Search query to find relevant memories.'),
      type: z.enum(['all', 'decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Filter by memory type. Defaults to "all".'),
      max_au: z.number().min(0.1).max(100).optional()
        .describe('Only return memories within this distance in AU.'),
      limit: z.number().int().min(1).max(50).optional()
        .describe('Maximum number of memories to return. Defaults to 10.'),
      include_universal: z.boolean().optional()
        .describe('Also include universal memories from other projects. Default: false.'),
      at: z.string().optional()
        .describe('ISO date string. If provided, returns memories that were active at this point in time (temporal query) instead of normal recall.'),
    },
    async (args) => withSessionContext(await handleRecall(args))
  );

  // ── Tool: remember ────────────────────────────────────────────────────────

  server.tool(
    'remember',
    'Store a new memory in the stellar system. Memories are automatically placed in an orbital zone ' +
    'based on their type and impact. ' +
    'Store memories immediately when: a design decision is made, a bug is resolved, ' +
    'a feature milestone is reached, or important technical context is discovered. ' +
    'Do not wait — store memories as soon as the information becomes clear.',
    {
      content: z.string().min(1)
        .describe('The full content of the memory to store.'),
      summary: z.string().optional()
        .describe('A short one-line summary. If omitted, first 50 chars of content are used.'),
      type: z.enum(['decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Memory type. Defaults to "observation".'),
      impact: z.number().min(0).max(1).optional()
        .describe('Impact score 0.0–1.0 affecting orbital distance.'),
      tags: z.array(z.string()).optional()
        .describe('Tags for categorizing and searching this memory.'),
    },
    (args) => handleRemember(args)
  );

  // ── Tool: orbit ───────────────────────────────────────────────────────────

  server.tool(
    'orbit',
    'Force a recalculation of all orbital positions for the project. ' +
    'Call this after storing 5 or more memories in a single session to keep distances accurate.',
    {},
    () => handleOrbit({} as Record<string, never>)
  );

  // ── Tool: forget ──────────────────────────────────────────────────────────

  server.tool(
    'forget',
    'Push a memory into a distant orbit (soft forget) or permanently delete it. ' +
    'Use "push" to move a memory to the Oort cloud (it still exists but is deprioritized). ' +
    'Use "delete" to permanently remove it.',
    {
      id: z.string().min(1)
        .describe('The ID of the memory to forget.'),
      mode: z.enum(['push', 'delete']).optional()
        .describe('"push" moves to Oort Cloud; "delete" permanently removes. Defaults to "push".'),
    },
    (args) => handleForget(args)
  );

  // ── Tool: scan ────────────────────────────────────────────────────────────

  server.tool(
    'scan',
    'Scan a local directory and automatically convert files into memories. ' +
    'Files already indexed (same content hash) are skipped — scanning is idempotent.',
    {
      path: z.string().min(1)
        .describe('Absolute or relative path to the directory to scan.'),
      recursive: z.boolean().optional()
        .describe('Recurse into subdirectories. Defaults to true.'),
      git: z.boolean().optional()
        .describe('Also import recent git commit history as memories. Defaults to true.'),
      max_kb: z.number().int().min(1).max(10240).optional()
        .describe('Maximum individual file size in KB to process. Defaults to 1024 KB.'),
    },
    (args) => handleScan(args)
  );

  // ── Tool: daemon ──────────────────────────────────────────────────────────

  server.tool(
    'daemon',
    'Control the background scheduler daemon. ' +
    'The scheduler automatically recalculates orbits, runs local scans, ' +
    'and cleans up the Oort cloud on configurable intervals.',
    {
      action: z.enum(['status', 'start', 'stop'])
        .describe('"status" — show state, "start" — start scheduler, "stop" — stop scheduler.'),
    },
    (args) => handleDaemon(args)
  );

  // ── Tool: constellation ───────────────────────────────────────────────────

  server.tool(
    'constellation',
    'Explore the Knowledge Graph (constellation) of relationships between memories. ' +
    'Use action="graph" to see the full graph around a memory, "related" to list connected memories, ' +
    'or "extract" to auto-discover relationships from content similarity.',
    {
      id: z.string().min(1)
        .describe('The memory ID to explore.'),
      action: z.enum(['graph', 'related', 'extract']).optional()
        .describe('"graph" — show constellation graph (default). "related" — list related memories. "extract" — auto-extract relationships.'),
      depth: z.number().int().min(1).max(3).optional()
        .describe('Graph traversal depth for action="graph". Default: 1.'),
      limit: z.number().int().min(1).max(50).optional()
        .describe('Max memories to return for action="related". Default: 10.'),
    },
    (args) => handleConstellation(args)
  );

  // ── Tool: export ──────────────────────────────────────────────────────────

  server.tool(
    'export',
    'Export all memories as JSON or Markdown for backup or migration.',
    {
      type: z.enum(['all', 'decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Filter by memory type. Defaults to all.'),
      zone: z.enum(['all', 'core', 'near', 'active', 'archive', 'fading', 'forgotten'])
        .optional()
        .describe('Filter by orbital zone. Defaults to all.'),
      format: z.enum(['json', 'markdown']).optional()
        .describe('Output format. Defaults to json.'),
    },
    (args) => handleExport(args)
  );

  // ── Tool: galaxy ───────────────────────────────────────────────────────────

  server.tool(
    'galaxy',
    'Manage multiple projects (star systems) in your stellar memory galaxy.\n\n' +
    'Actions:\n' +
    '  switch          — switch the active project at runtime (no restart needed)\n' +
    '  list            — list all projects with memory counts and stats\n' +
    '  create          — create a new project\n' +
    '  stats           — detailed statistics for a project\n' +
    '  mark_universal  — mark a memory as universal (visible in all projects)\n' +
    '  universal_context — retrieve universal memories from other projects\n' +
    '  candidates      — detect memories that are good candidates to become universal',
    {
      action: z.enum(['switch', 'list', 'create', 'stats', 'mark_universal', 'universal_context', 'candidates'])
        .describe('Action to perform.'),
      project: z.string().optional()
        .describe('Project name. Required for switch/create; optional for stats/universal_context/candidates (defaults to current).'),
      memory_id: z.string().optional()
        .describe('Memory ID. Required for mark_universal.'),
      is_universal: z.boolean().optional()
        .describe('Whether to mark as universal (true) or project-specific (false). Default: true.'),
      limit: z.number().int().min(1).max(100).optional()
        .describe('Maximum results to return for universal_context. Default: 10.'),
    },
    (args) => handleGalaxy(args)
  );

  // ── Tool: analytics ───────────────────────────────────────────────────────

  server.tool(
    'analytics',
    'Get insights and analytics about your memory system. Includes survival curves, topic clusters, ' +
    'health metrics, and recommendations.\n\n' +
    'Reports:\n' +
    '  summary   — full analytics summary (zone/type distribution, quality, recall rate)\n' +
    '  health    — health metrics + actionable recommendations\n' +
    '  topics    — topic cluster heatmap (most active topics)\n' +
    '  survival  — memory survival curve by age bucket\n' +
    '  movements — orbit movement timeline (which memories moved most)\n' +
    '  full      — full text report combining all analytics',
    {
      report: z.enum(['summary', 'health', 'topics', 'survival', 'movements', 'full'])
        .describe('Type of analytics report to generate.'),
      project: z.string().optional()
        .describe('Project to analyse. Defaults to the current active project.'),
      days: z.number().int().min(1).max(365).optional()
        .describe('Lookback window in days for report="movements". Default: 30.'),
    },
    (args) => handleAnalytics(args)
  );

  // ── Tool: observe ─────────────────────────────────────────────────────────

  server.tool(
    'observe',
    'Process a conversation chunk to automatically extract and store memories. ' +
    'The Observer phase extracts key facts, decisions, and errors. ' +
    'The Reflector phase compares against existing memories to categorize as novel, reinforcing, or conflicting.',
    {
      conversation: z.string().min(1)
        .describe('The conversation text to observe and extract memories from.'),
      project: z.string().optional()
        .describe('Project context. Defaults to the current active project.'),
    },
    (args) => handleObserve(args)
  );

  // ── Tool: consolidate ─────────────────────────────────────────────────────

  server.tool(
    'consolidate',
    'Find and merge similar memories to reduce redundancy and improve quality. ' +
    'Memories with high similarity are combined into richer single memories. ' +
    'Use dry_run=true (default) to preview candidates before merging.',
    {
      project: z.string().optional()
        .describe('Project context. Defaults to the current active project.'),
      dry_run: z.boolean().optional()
        .describe('If true, only report candidates without merging. Default: true.'),
    },
    (args) => handleConsolidate(args)
  );

  // ── Tool: resolve_conflict ────────────────────────────────────────────────

  server.tool(
    'resolve_conflict',
    'View and resolve memory conflicts. Conflicts are detected when new memories contradict existing ones.\n\n' +
    'Actions:\n' +
    '  list    — list all unresolved conflicts\n' +
    '  resolve — resolve a conflict (supersede, dismiss, or keep_both)\n' +
    '  dismiss — dismiss a conflict without changes',
    {
      action: z.enum(['list', 'resolve', 'dismiss'])
        .describe('Action to perform: list conflicts, resolve one, or dismiss one.'),
      conflict_id: z.string().optional()
        .describe('Conflict ID. Required for resolve/dismiss actions.'),
      resolution: z.string().optional()
        .describe('Human-readable description of how the conflict was resolved.'),
      resolve_action: z.enum(['supersede', 'dismiss', 'keep_both']).optional()
        .describe('How to resolve: supersede the older memory, dismiss without changes, or keep both. Default: supersede.'),
      project: z.string().optional()
        .describe('Project context. Defaults to the current active project.'),
    },
    (args) => handleResolveConflict(args)
  );

  // ── Tool: temporal ────────────────────────────────────────────────────────

  server.tool(
    'temporal',
    'Query memories at a specific point in time or view how knowledge has evolved. ' +
    'Supports temporal browsing and evolution chain tracking.\n\n' +
    'Actions:\n' +
    '  at         — get memories that were active at a specific timestamp\n' +
    '  chain      — view the full evolution chain of a memory\n' +
    '  summary    — temporal summary (active vs superseded counts)\n' +
    '  set_bounds — set valid_from / valid_until bounds on a memory',
    {
      action: z.enum(['at', 'chain', 'summary', 'set_bounds'])
        .describe('Action to perform.'),
      timestamp: z.string().optional()
        .describe('ISO date string. Required for action="at".'),
      memory_id: z.string().optional()
        .describe('Memory ID. Required for action="chain" and "set_bounds".'),
      valid_from: z.string().optional()
        .describe('ISO date. For set_bounds — when the memory became valid.'),
      valid_until: z.string().optional()
        .describe('ISO date. For set_bounds — when the memory stopped being valid.'),
      project: z.string().optional()
        .describe('Project context. Defaults to the current active project.'),
    },
    (args) => handleTemporal(args)
  );

  return server;
}
