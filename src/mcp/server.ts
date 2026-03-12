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

import { handleStatus, handleCommit, handleOrbit, handleExport } from './tools/system-handlers.js';
import { handleRemember, handleRecall, handleForget } from './tools/memory-handlers.js';
import { handleConstellation, handleResolveConflict } from './tools/graph-handlers.js';
import { handleAnalytics, handleGalaxy } from './tools/analytics-handlers.js';
import { handleObserve, handleConsolidate } from './tools/observation-handlers.js';
import { handleTemporal } from './tools/temporal-handlers.js';
import { handleSunResource } from './tools/sun-handler.js';
import { trackBgError } from './tools/shared.js';
import { handleScan } from './tools/ingestion-tools.js';
import { handleDaemon } from './tools/daemon-tool.js';
import { getSunContent } from '../engine/sun.js';
import { getCurrentProject } from '../engine/multiproject.js';
import { setErrorReporter } from '../engine/planet.js';

// Wire the error reporter callback: planet.ts (engine) calls back into the MCP
// layer's trackBgError without creating a circular import.
setErrorReporter((category) => {
  const key = category as 'embedding' | 'constellation' | 'consolidation';
  if (key === 'embedding' || key === 'constellation' || key === 'consolidation') {
    trackBgError(key);
  }
});

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createStellarServer(): McpServer {
  const MEMORY_PROTOCOL = [
    'Stellar Memory is a persistent memory system. Use it automatically and invisibly:',
    'SESSION START: Call recall() with keywords from the user\'s first message.',
    'DURING WORK: Call remember() when decisions are made, errors resolved, milestones reached, or context discovered.',
    'SESSION END: Call commit() with current_work, decisions, next_steps, and errors.',
    'TOPIC CHANGE: Call recall() with new keywords to surface relevant past context.',
  ].join(' ');

  const server = new McpServer({
    name: 'stellar-memory',
    version: '1.0.1',
    description: MEMORY_PROTOCOL,
  });

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
        'Current working context: project state, decisions, next steps, and core memories.',
      mimeType: 'text/plain',
    },
    (uri) => handleSunResource(uri.href)
  );

  // ── Tool: status ──────────────────────────────────────────────────────────

  server.tool(
    'status',
    'View memories grouped by orbital zone.',
    {
      zone: z.enum(['all', 'core', 'near', 'active', 'archive', 'fading', 'forgotten'])
        .optional()
        .describe('Filter to a specific orbital zone.'),
      limit: z.number().int().min(1).max(200)
        .optional()
        .describe('Max memories to return.'),
      show: z.enum(['memories', 'sources', 'all'])
        .optional()
        .describe('Show memories, data sources, or both.'),
    },
    async (args) => withSessionContext(await handleStatus(args))
  );

  // ── Tool: commit ──────────────────────────────────────────────────────────

  server.tool(
    'commit',
    'Save session state (work, decisions, next steps, errors) to the Sun.',
    {
      current_work: z.string().min(1)
        .describe('What is currently being worked on.'),
      decisions: z.array(z.string()).optional()
        .describe('Decisions made this session.'),
      next_steps: z.array(z.string()).optional()
        .describe('Concrete next actions for future sessions.'),
      errors: z.array(z.string()).optional()
        .describe('Active errors or blockers.'),
      context: z.string().optional()
        .describe('Additional project background.'),
    },
    (args) => handleCommit(args)
  );

  // ── Tool: recall ──────────────────────────────────────────────────────────

  server.tool(
    'recall',
    'Search memories. Matching results are pulled closer to the Sun.',
    {
      query: z.string().min(1)
        .describe('Search query.'),
      type: z.enum(['all', 'decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Filter by memory type.'),
      max_au: z.number().min(0.1).max(100).optional()
        .describe('Max distance in AU.'),
      limit: z.number().int().min(1).max(50).optional()
        .describe('Max results to return.'),
      include_universal: z.boolean().optional()
        .describe('Include universal memories from other projects.'),
      at: z.string().optional()
        .describe('ISO date — return memories active at this point in time instead.'),
    },
    async (args) => withSessionContext(await handleRecall(args))
  );

  // ── Tool: remember ────────────────────────────────────────────────────────

  server.tool(
    'remember',
    'Store a new memory. Auto-placed by type and impact.',
    {
      content: z.string().min(1)
        .describe('Full memory content.'),
      summary: z.string().optional()
        .describe('One-line summary (default: first 50 chars of content).'),
      type: z.enum(['decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Memory type.'),
      impact: z.number().min(0).max(1).optional()
        .describe('Impact score 0.0–1.0.'),
      tags: z.array(z.string()).optional()
        .describe('Tags for search and categorization.'),
    },
    (args) => handleRemember(args)
  );

  // ── Tool: orbit ───────────────────────────────────────────────────────────

  server.tool(
    'orbit',
    'Recalculate all memory positions based on current importance.',
    {},
    () => handleOrbit({} as Record<string, never>)
  );

  // ── Tool: forget ──────────────────────────────────────────────────────────

  server.tool(
    'forget',
    'Push a memory further from the Sun or soft-delete it.',
    {
      id: z.string().min(1)
        .describe('Memory ID to forget.'),
      mode: z.enum(['push', 'delete']).optional()
        .describe('"push" moves to Oort Cloud; "delete" permanently removes.'),
    },
    (args) => handleForget(args)
  );

  // ── Tool: scan ────────────────────────────────────────────────────────────

  server.tool(
    'scan',
    'Register and scan local data sources.',
    {
      path: z.string().min(1)
        .describe('Directory path to scan.'),
      recursive: z.boolean().optional()
        .describe('Recurse into subdirectories.'),
      git: z.boolean().optional()
        .describe('Also import git commit history.'),
      max_kb: z.number().int().min(1).max(10240).optional()
        .describe('Max file size in KB to process.'),
    },
    (args) => handleScan(args)
  );

  // ── Tool: daemon ──────────────────────────────────────────────────────────

  server.tool(
    'daemon',
    'Start or stop the background scheduler.',
    {
      action: z.enum(['status', 'start', 'stop'])
        .describe('Action to perform.'),
    },
    (args) => handleDaemon(args)
  );

  // ── Tool: constellation ───────────────────────────────────────────────────

  server.tool(
    'constellation',
    'Explore the knowledge graph between memories.',
    {
      id: z.string().min(1)
        .describe('Memory ID to explore.'),
      action: z.enum(['graph', 'related', 'extract']).optional()
        .describe('"graph" (default), "related", or "extract".'),
      depth: z.number().int().min(1).max(3).optional()
        .describe('Graph traversal depth.'),
      limit: z.number().int().min(1).max(50).optional()
        .describe('Max related memories to return.'),
    },
    (args) => handleConstellation(args)
  );

  // ── Tool: export ──────────────────────────────────────────────────────────

  server.tool(
    'export',
    'Export memories as JSON or Markdown.',
    {
      type: z.enum(['all', 'decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Filter by memory type.'),
      zone: z.enum(['all', 'core', 'near', 'active', 'archive', 'fading', 'forgotten'])
        .optional()
        .describe('Filter by orbital zone.'),
      format: z.enum(['json', 'markdown']).optional()
        .describe('Output format.'),
    },
    (args) => handleExport(args)
  );

  // ── Tool: galaxy ───────────────────────────────────────────────────────────

  server.tool(
    'galaxy',
    'Manage projects: switch, list, create, stats, or universal memories.',
    {
      action: z.enum(['switch', 'list', 'create', 'stats', 'mark_universal', 'universal_context', 'candidates'])
        .describe('Action to perform.'),
      project: z.string().optional()
        .describe('Project name (required for switch/create).'),
      memory_id: z.string().optional()
        .describe('Memory ID (required for mark_universal).'),
      is_universal: z.boolean().optional()
        .describe('Mark as universal (true) or project-specific (false).'),
      limit: z.number().int().min(1).max(100).optional()
        .describe('Max results for universal_context.'),
    },
    (args) => handleGalaxy(args)
  );

  // ── Tool: analytics ───────────────────────────────────────────────────────

  server.tool(
    'analytics',
    'Memory analytics: health, topics, survival, or movements.',
    {
      report: z.enum(['summary', 'health', 'topics', 'survival', 'movements', 'full'])
        .describe('Report type.'),
      project: z.string().optional()
        .describe('Project to analyse.'),
      days: z.number().int().min(1).max(365).optional()
        .describe('Lookback window in days (for movements report).'),
    },
    (args) => handleAnalytics(args)
  );

  // ── Tool: observe ─────────────────────────────────────────────────────────

  server.tool(
    'observe',
    'Extract memories from conversation text automatically.',
    {
      conversation: z.string().min(1)
        .describe('Conversation text to extract memories from.'),
      project: z.string().optional()
        .describe('Target project.'),
    },
    (args) => handleObserve(args)
  );

  // ── Tool: consolidate ─────────────────────────────────────────────────────

  server.tool(
    'consolidate',
    'Merge similar memories to reduce noise.',
    {
      project: z.string().optional()
        .describe('Target project.'),
      dry_run: z.boolean().optional()
        .describe('Preview candidates without merging.'),
    },
    (args) => handleConsolidate(args)
  );

  // ── Tool: resolve_conflict ────────────────────────────────────────────────

  server.tool(
    'resolve_conflict',
    'List, resolve, or dismiss memory conflicts.',
    {
      action: z.enum(['list', 'resolve', 'dismiss'])
        .describe('Action to perform.'),
      conflict_id: z.string().optional()
        .describe('Conflict ID (required for resolve/dismiss).'),
      resolution: z.string().optional()
        .describe('How the conflict was resolved.'),
      resolve_action: z.enum(['supersede', 'dismiss', 'keep_both']).optional()
        .describe('"supersede", "dismiss", or "keep_both".'),
      project: z.string().optional()
        .describe('Target project.'),
    },
    (args) => handleResolveConflict(args)
  );

  // ── Tool: temporal ────────────────────────────────────────────────────────

  server.tool(
    'temporal',
    'Time-based queries: point-in-time recall, evolution chains, or bounds.',
    {
      action: z.enum(['at', 'chain', 'summary', 'set_bounds'])
        .describe('Action to perform.'),
      timestamp: z.string().optional()
        .describe('ISO date (required for action="at").'),
      memory_id: z.string().optional()
        .describe('Memory ID (required for chain/set_bounds).'),
      valid_from: z.string().optional()
        .describe('ISO date — when the memory became valid.'),
      valid_until: z.string().optional()
        .describe('ISO date — when the memory stopped being valid.'),
      project: z.string().optional()
        .describe('Target project.'),
    },
    (args) => handleTemporal(args)
  );

  return server;
}
