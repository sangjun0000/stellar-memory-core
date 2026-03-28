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

import { handleStatus, handleCommit } from './tools/system-handlers.js';
import { handleRemember, handleRecall, handleForget, handleUpdate } from './tools/memory-handlers.js';
import { handleSunResource } from './tools/sun-handler.js';
import { trackBgError } from './tools/shared.js';
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
    version: '1.1.1',
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
      zone: z.enum(['all', 'core', 'near', 'stored', 'forgotten'])
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
      project: z.string().optional()
        .describe('Target project (default: auto-detected from cwd). Use when committing for a different project.'),
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
      project: z.string().optional()
        .describe('Target project (default: auto-detected from cwd). Use when searching a different project.'),
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
      project: z.string().optional()
        .describe('Target project (default: auto-detected from cwd). Use when storing memories for a different project.'),
    },
    (args) => handleRemember(args)
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

  // ── Tool: update ──────────────────────────────────────────────────────────

  server.tool(
    'update',
    'Edit an existing memory\'s content, summary, type, tags, or impact. ID and history are preserved.',
    {
      id: z.string().min(1)
        .describe('Memory ID to update (first 8 chars OK).'),
      content: z.string().optional()
        .describe('New content.'),
      summary: z.string().optional()
        .describe('New one-line summary.'),
      type: z.enum(['decision', 'observation', 'task', 'context', 'error', 'milestone']).optional()
        .describe('New type.'),
      tags: z.array(z.string()).optional()
        .describe('New tags (replaces existing).'),
      impact: z.number().min(0).max(1).optional()
        .describe('New impact score 0.0–1.0.'),
      project: z.string().optional()
        .describe('Target project (default: auto-detected from cwd).'),
    },
    (args) => handleUpdate(args)
  );

  return server;
}
