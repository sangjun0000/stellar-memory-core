/**
 * mcp/server.ts — Thin factory that wires tool handlers to the MCP server.
 *
 * Responsibilities:
 *   1. Instantiate McpServer, ConnectorRegistry.
 *   2. Register the stellar://sun resource.
 *   3. Register each tool, forwarding parsed args to the appropriate handler.
 *   4. Pass the shared ConnectorRegistry to handlers that need it (sync, daemon).
 *
 * Business logic lives in mcp/tools/. This file contains no logic beyond wiring.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ConnectorRegistry } from './connector-registry.js';
import {
  handleStatus,
  handleCommit,
  handleRecall,
  handleRemember,
  handleOrbit,
  handleForget,
  handleExport,
  handleSunResource,
} from './tools/memory-tools.js';
import { handleScan, handleSync } from './tools/ingestion-tools.js';
import { handleDaemon, resetScheduler } from './tools/daemon-tool.js';

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createStellarServer(): McpServer {
  const server   = new McpServer({ name: 'stellar-memory', version: '0.3.0' });
  const registry = new ConnectorRegistry();

  // ── Resource: stellar://sun ───────────────────────────────────────────────

  server.resource(
    'sun',
    'stellar://sun',
    {
      description:
        'Current working context (the Sun). Contains active project state, recent decisions, and next steps. ' +
        'Read this at the start of every session to restore context.\n\n' +
        '[AUTO-TRIGGER] Read this resource at the very beginning of every conversation before any other action.',
      mimeType: 'text/plain',
    },
    (uri) => handleSunResource(uri.href)
  );

  // ── Tool: status ──────────────────────────────────────────────────────────

  server.tool(
    'status',
    'View the current state of your stellar memory system. Shows memories grouped by orbital zone ' +
    '(corona = actively working, oort = nearly forgotten), and optionally lists registered data sources. ' +
    'Use this to get a snapshot of what the system knows.\n\n' +
    '[AUTO-TRIGGER] Call at the start of every session alongside recall to restore full context.',
    {
      zone: z.enum(['all', 'corona', 'inner', 'habitable', 'outer', 'kuiper', 'oort'])
        .optional()
        .describe('Filter memories to a specific orbital zone. Defaults to "all".'),
      limit: z.number().int().min(1).max(200)
        .optional()
        .describe('Maximum number of memories to return. Defaults to 50.'),
      show: z.enum(['memories', 'sources', 'all'])
        .optional()
        .describe('What to display: memories, data sources, or both. Default: "memories".'),
    },
    (args) => handleStatus(args)
  );

  // ── Tool: commit ──────────────────────────────────────────────────────────

  server.tool(
    'commit',
    'Save the current session state into the Sun (working context). Call this at the end of each session ' +
    'or when switching tasks to preserve your progress.\n\n' +
    '[AUTO-TRIGGER] Call automatically before a conversation ends. This is the most critical auto-trigger.',
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
    'Uses hybrid FTS5 + vector search for best results.\n\n' +
    '[AUTO-TRIGGER] Call at session start with keywords from the user\'s first message.',
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
    },
    (args) => handleRecall(args)
  );

  // ── Tool: remember ────────────────────────────────────────────────────────

  server.tool(
    'remember',
    'Store a new memory in the stellar system. Memories are automatically placed in an orbital zone ' +
    'based on their type and impact.\n\n' +
    '[AUTO-TRIGGER] Call immediately when: (1) a design decision is made, (2) a bug is resolved, ' +
    '(3) a feature milestone is reached, (4) important technical context is discovered.',
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
    'Force a recalculation of all orbital positions for the project.\n\n' +
    '[AUTO-TRIGGER] Call after storing 5+ memories in a single session.',
    {},
    () => handleOrbit({} as Record<string, never>)
  );

  // ── Tool: forget ──────────────────────────────────────────────────────────

  server.tool(
    'forget',
    'Push a memory into a distant orbit (soft forget) or permanently delete it.',
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

  // ── Tool: sync ────────────────────────────────────────────────────────────

  server.tool(
    'sync',
    'Pull documents from cloud services into stellar memory. ' +
    'If credentials are provided, the service is connected first before syncing.',
    {
      service: z.enum(['google-drive', 'notion', 'github', 'slack']).optional()
        .describe('Specific service to connect and/or sync.'),
      since: z.string().optional()
        .describe('Relative time ("24h", "7d") or ISO date. Default: "24h".'),
      credentials: z.record(z.string()).optional()
        .describe('Service credentials. If provided, connects to the service before syncing.'),
    },
    (args) => {
      const result = handleSync(args, registry);
      // Rebuild scheduler with updated registry whenever credentials change
      if (args.credentials !== undefined) resetScheduler();
      return result;
    }
  );

  // ── Tool: daemon ──────────────────────────────────────────────────────────

  server.tool(
    'daemon',
    'Control the background scheduler daemon. ' +
    'The scheduler automatically recalculates orbits, runs local scans, syncs cloud sources, ' +
    'and cleans up the Oort cloud on configurable intervals.',
    {
      action: z.enum(['status', 'start', 'stop'])
        .describe('"status" — show state, "start" — start scheduler, "stop" — stop scheduler.'),
    },
    (args) => handleDaemon(args, registry)
  );

  // ── Tool: export ──────────────────────────────────────────────────────────

  server.tool(
    'export',
    'Export all memories as JSON or Markdown for backup or migration.',
    {
      type: z.enum(['all', 'decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe('Filter by memory type. Defaults to all.'),
      zone: z.enum(['all', 'corona', 'inner', 'habitable', 'outer', 'kuiper', 'oort'])
        .optional()
        .describe('Filter by orbital zone. Defaults to all.'),
      format: z.enum(['json', 'markdown']).optional()
        .describe('Output format. Defaults to json.'),
    },
    (args) => handleExport(args)
  );

  return server;
}
