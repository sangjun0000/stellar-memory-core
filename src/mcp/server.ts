import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { MemoryType, OrbitZone, Memory, OrbitChange } from '../engine/types.js';
import { ORBIT_ZONES } from '../engine/types.js';
import { getSunContent, commitToSun } from '../engine/sun.js';
import { createMemory, recallMemoriesAsync, forgetMemory } from '../engine/planet.js';
import { recalculateOrbits, getOrbitZone } from '../engine/orbit.js';
import { getMemoriesByProject } from '../storage/queries.js';
import { getConfig } from '../utils/config.js';
import { parseRelativeTime } from '../utils/time.js';
import { StellarScanner, listDataSources } from '../scanner/index.js';
import { createLogger } from '../utils/logger.js';
import { GoogleDriveConnector } from '../scanner/cloud/google-drive.js';
import { NotionConnector }      from '../scanner/cloud/notion.js';
import { GitHubConnector }      from '../scanner/cloud/github.js';
import { SlackConnector }       from '../scanner/cloud/slack.js';
import type { CloudConnector }  from '../scanner/cloud/types.js';
import { StellarScheduler, DEFAULT_SCHEDULE_CONFIG } from '../service/scheduler.js';

const log = createLogger('mcp-server');

// ---------------------------------------------------------------------------
// Module-level connector registry — persists across tool calls within a process
// ---------------------------------------------------------------------------

const connectorRegistry = new Map<string, CloudConnector>();
let _scheduler: StellarScheduler | null = null;
let _schedulerStartedAt: Date | null    = null;

function getOrCreateScheduler(): StellarScheduler {
  if (!_scheduler) {
    _scheduler = new StellarScheduler(
      DEFAULT_SCHEDULE_CONFIG,
      Array.from(connectorRegistry.values()),
    );
  }
  return _scheduler;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve project from config — always uses the configured default. */
function resolveProject(): string {
  return getConfig().defaultProject;
}

/**
 * getOrbitZone returns the zone label string (e.g. "Corona (Working Memory)").
 * This helper maps that label back to the zone key for ORBIT_ZONES lookup.
 */
function labelToZoneKey(label: string): OrbitZone {
  for (const [key, info] of Object.entries(ORBIT_ZONES) as [OrbitZone, { min: number; max: number; label: string }][]) {
    if (info.label === label) return key;
  }
  return 'oort';
}

/**
 * Format a distance value as a human-readable AU string with the zone label.
 */
function formatDistance(distance: number): string {
  const label = getOrbitZone(distance);
  return `${distance.toFixed(2)} AU (${label})`;
}

/**
 * Build a compact one-line memory summary for list output.
 */
function formatMemoryLine(m: Memory): string {
  const pct = (m.importance * 100).toFixed(0);
  return `  [${m.type.toUpperCase()}] ${m.summary} | ${m.distance.toFixed(2)} AU | ${pct}% | ${m.id}`;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createStellarServer(): McpServer {
  const server = new McpServer({
    name: 'stellar-memory',
    version: '0.2.0',
  });

  // -------------------------------------------------------------------------
  // Resource: stellar://sun
  // -------------------------------------------------------------------------

  server.resource(
    'sun',
    'stellar://sun',
    {
      description:
        'Current working context (the Sun). Contains active project state, recent decisions, and next steps. ' +
        'Read this at the start of every session to restore context.',
      mimeType: 'text/plain',
    },
    (uri) => {
      const config = getConfig();
      const content = getSunContent(config.defaultProject);
      return {
        contents: [
          {
            uri: uri.href,
            text: content,
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool 1: status
  // -------------------------------------------------------------------------

  server.tool(
    'status',
    'View the current state of your stellar memory system. Shows memories grouped by orbital zone ' +
    '(corona = actively working, oort = nearly forgotten), and optionally lists registered data sources. ' +
    'Use this to get a snapshot of what the system knows.',
    {
      zone: z
        .enum(['all', 'corona', 'inner', 'habitable', 'outer', 'kuiper', 'oort'])
        .optional()
        .describe(
          'Filter memories to a specific orbital zone. "corona" is closest (working memory), ' +
          '"oort" is furthest (nearly forgotten). Defaults to "all".'
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of memories to return. Defaults to 50.'),
      show: z
        .enum(['memories', 'sources', 'all'])
        .optional()
        .describe('What to display: memories, data sources, or both. Default: "memories".'),
    },
    async ({ zone, limit, show }) => {
      try {
        const proj = resolveProject();
        const effectiveLimit = limit ?? 50;
        const effectiveZone  = zone ?? 'all';
        const effectiveShow  = show ?? 'memories';

        const lines: string[] = [];

        // ── Memories section ────────────────────────────────────────────────
        if (effectiveShow === 'memories' || effectiveShow === 'all') {
          const all: Memory[] = getMemoriesByProject(proj);
          const memories = all.slice(0, effectiveLimit);

          const filtered =
            effectiveZone === 'all'
              ? memories
              : memories.filter((m) => {
                  const zoneKey = labelToZoneKey(getOrbitZone(m.distance));
                  return zoneKey === effectiveZone;
                });

          lines.push(`☀ Project: ${proj} | ${filtered.length} memories`);

          if (filtered.length === 0) {
            lines.push(
              effectiveZone !== 'all'
                ? `No memories in zone "${effectiveZone}".`
                : 'No memories yet. Use remember or scan to add some.'
            );
          } else {
            lines.push('');

            // Group by zone
            const byZone: Partial<Record<OrbitZone, Memory[]>> = {};
            for (const m of filtered) {
              const zoneKey = labelToZoneKey(getOrbitZone(m.distance));
              const bucket = byZone[zoneKey] ?? [];
              bucket.push(m);
              byZone[zoneKey] = bucket;
            }

            const zoneOrder: OrbitZone[] = ['corona', 'inner', 'habitable', 'outer', 'kuiper', 'oort'];

            for (const zoneName of zoneOrder) {
              const zoneMemories = byZone[zoneName];
              if (!zoneMemories || zoneMemories.length === 0) continue;

              lines.push(`▸ ${ORBIT_ZONES[zoneName].label} (${zoneMemories.length})`);
              for (const m of zoneMemories) {
                lines.push(formatMemoryLine(m));
              }
              lines.push('');
            }
          }
        }

        // ── Sources section ─────────────────────────────────────────────────
        if (effectiveShow === 'sources' || effectiveShow === 'all') {
          if (effectiveShow === 'all') {
            lines.push('─────────────────────────────────');
          }

          const sources = listDataSources();

          if (sources.length === 0) {
            lines.push('No data sources registered yet. Use scan to index a directory.');
          } else {
            lines.push(`Data sources (${sources.length}):`);
            lines.push('');
            for (const ds of sources) {
              const lastScan = ds.last_scanned_at
                ? new Date(ds.last_scanned_at).toLocaleString()
                : 'never';
              const sizeMB = (ds.total_size / 1_048_576).toFixed(2);
              lines.push(
                `  ${ds.path} | ${ds.status} | ${ds.file_count} files (${sizeMB} MB) | last: ${lastScan} | id: ${ds.id}`
              );
            }
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `status failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 2: commit
  // -------------------------------------------------------------------------

  server.tool(
    'commit',
    'Save the current session state into the Sun (working context). Call this at the end of each session ' +
    'or when switching tasks to preserve your progress. The Sun is automatically available as a resource next session.',
    {
      current_work: z
        .string()
        .min(1)
        .describe(
          'A clear description of what you are currently working on. ' +
          'This is the primary context restored next session.'
        ),
      decisions: z
        .array(z.string())
        .optional()
        .describe(
          'Key decisions made during this session ' +
          '(e.g., "Chose PostgreSQL over SQLite for production scale"). ' +
          'Each decision is automatically stored as a memory planet.'
        ),
      next_steps: z
        .array(z.string())
        .optional()
        .describe(
          'Concrete next actions to take in future sessions ' +
          '(e.g., "Write migration for users table").'
        ),
      errors: z
        .array(z.string())
        .optional()
        .describe(
          'Active errors or blockers that need attention ' +
          '(e.g., "Auth middleware returns 401 on valid tokens").'
        ),
      context: z
        .string()
        .optional()
        .describe(
          'Additional background context for the project that should persist ' +
          '(e.g., tech stack, constraints, team conventions).'
        ),
    },
    async ({ current_work, decisions, next_steps, errors, context }) => {
      try {
        const proj = resolveProject();
        const config = getConfig();

        commitToSun(proj, {
          current_work,
          decisions: decisions ?? [],
          next_steps: next_steps ?? [],
          errors: errors ?? [],
          context: context ?? '',
        });

        const changes: OrbitChange[] = recalculateOrbits(proj, config);

        const parts: string[] = [
          `✓ Committed | decisions: ${(decisions ?? []).length} | steps: ${(next_steps ?? []).length} | errors: ${(errors ?? []).length} | orbit changes: ${changes.length}`,
        ];

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `commit failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 3: recall
  // -------------------------------------------------------------------------

  server.tool(
    'recall',
    'Search memories by content and pull relevant ones closer to the Sun (increasing their importance). ' +
    'Uses hybrid FTS5 + vector search for best results. ' +
    'Use this to surface forgotten context that is relevant to your current work.',
    {
      query: z
        .string()
        .min(1)
        .describe('Search query to find relevant memories. Matched against content, summary, and tags.'),
      type: z
        .enum(['all', 'decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe(
          'Filter by memory type. "decision" for architectural choices, "error" for bugs, ' +
          '"task" for work items, etc. Defaults to "all".'
        ),
      max_au: z
        .number()
        .min(0.1)
        .max(100)
        .optional()
        .describe(
          'Only return memories within this distance in AU. ' +
          'Use 15.0 to limit to habitable zone and closer. Omit to search all zones.'
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Maximum number of memories to return. Defaults to 10.'),
    },
    async ({ query, type, max_au, limit }) => {
      try {
        const proj = resolveProject();

        const memoryType: MemoryType | undefined =
          type === 'all' || type === undefined ? undefined : (type as MemoryType);

        const results: Memory[] = await recallMemoriesAsync(proj, query, {
          type: memoryType,
          maxDistance: max_au,
          limit: limit ?? 10,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No memories found matching "${query}".`,
              },
            ],
          };
        }

        const lines: string[] = [
          `Recall: "${query}" — ${results.length} result${results.length === 1 ? '' : 's'} (pulled closer to Sun)`,
          '',
        ];

        for (const m of results) {
          const preview = m.content.slice(0, 150) + (m.content.length > 150 ? '…' : '');
          const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
          lines.push(`[${m.type.toUpperCase()}] ${m.summary}${tags} | ${formatDistance(m.distance)} | ${m.id}`);
          lines.push(`  ${preview}`);
          lines.push('');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `recall failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 4: remember
  // -------------------------------------------------------------------------

  server.tool(
    'remember',
    'Store a new memory in the stellar system. Memories are automatically placed in an orbital zone ' +
    'based on their type and impact. High-impact decisions orbit closer; low-impact observations orbit further.',
    {
      content: z
        .string()
        .min(1)
        .describe('The full content of the memory to store. Be specific and detailed.'),
      summary: z
        .string()
        .optional()
        .describe(
          'A short one-line summary of the memory for quick display. ' +
          'If omitted, the first 50 characters of content are used.'
        ),
      type: z
        .enum(['decision', 'observation', 'task', 'context', 'error', 'milestone'])
        .optional()
        .describe(
          'Memory type. Use "decision" for architectural/design choices, "error" for bugs/failures, ' +
          '"milestone" for achievements, "task" for work items, "context" for background info, ' +
          '"observation" for general notes. Defaults to "observation".'
        ),
      impact: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          'Impact score from 0.0 to 1.0 affecting how close to the Sun this memory orbits. ' +
          '1.0 = maximum importance (corona zone). ' +
          'Defaults vary by type: decision=0.8, milestone=0.7, error=0.6, task=0.5, context=0.4, observation=0.3.'
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          'Tags for categorizing and searching this memory ' +
          '(e.g., ["auth", "bug", "performance"]).'
        ),
    },
    async ({ content, summary, type, impact, tags }) => {
      try {
        const proj = resolveProject();

        const memory: Memory = createMemory({
          project: proj,
          content,
          summary,
          type: (type ?? 'observation') as MemoryType,
          impact,
          tags,
        });

        const zoneLabel = getOrbitZone(memory.distance);

        return {
          content: [
            {
              type: 'text' as const,
              text: `✦ Stored [${memory.type.toUpperCase()}] at ${memory.distance.toFixed(2)} AU (${zoneLabel}) | ID: ${memory.id}`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `remember failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 5: orbit
  // -------------------------------------------------------------------------

  server.tool(
    'orbit',
    'Force a recalculation of all orbital positions for the project. Memories decay over time ' +
    '(drifting outward) and are pulled inward by access and relevance. ' +
    'Run this to apply pending orbital physics without committing a new session.',
    {},
    async () => {
      try {
        const proj = resolveProject();
        const config = getConfig();
        const changes: OrbitChange[] = recalculateOrbits(proj, config);

        if (changes.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Orbit: ${proj} — no changes. All memories are stable.`,
              },
            ],
          };
        }

        let closerCount = 0;
        let furtherCount = 0;
        const lines: string[] = [];

        for (const change of changes) {
          const delta = change.new_distance - change.old_distance;
          const direction = delta < 0 ? '↓' : '↑';
          const absAU = Math.abs(delta).toFixed(2);

          if (delta < 0) closerCount++;
          else furtherCount++;

          const oldZone = getOrbitZone(change.old_distance);
          const newZone = getOrbitZone(change.new_distance);
          const zoneChange = oldZone !== newZone ? ` ${oldZone}→${newZone}` : '';

          lines.push(
            `  ${direction}${absAU} AU (${change.old_distance.toFixed(2)}→${change.new_distance.toFixed(2)})${zoneChange} | ${change.trigger} | ${change.memory_id}`
          );
        }

        const header = `Orbit: ${proj} — ${changes.length} change${changes.length === 1 ? '' : 's'} | ↓${closerCount} closer  ↑${furtherCount} further`;

        return {
          content: [{ type: 'text' as const, text: [header, '', ...lines].join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `orbit failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 6: forget
  // -------------------------------------------------------------------------

  server.tool(
    'forget',
    'Push a memory into a distant orbit (soft forget) or permanently delete it. ' +
    'Use "push" to deprioritize without losing data; use "delete" only when the memory is truly irrelevant.',
    {
      id: z
        .string()
        .min(1)
        .describe(
          'The ID of the memory to forget. Get IDs from status or recall output.'
        ),
      mode: z
        .enum(['push', 'delete'])
        .optional()
        .describe(
          '"push" moves the memory to the Oort Cloud (distant but recoverable via recall). ' +
          '"delete" permanently removes it. Defaults to "push".'
        ),
    },
    async ({ id, mode }) => {
      try {
        const effectiveMode = mode ?? 'push';

        forgetMemory(id, effectiveMode);

        if (effectiveMode === 'delete') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `✗ Deleted memory ${id}.`,
              },
            ],
          };
        }

        const oortDistance = 95.0;
        const zoneLabel = getOrbitZone(oortDistance);

        return {
          content: [
            {
              type: 'text' as const,
              text: `↑ Pushed ${id} to ${oortDistance.toFixed(2)} AU (${zoneLabel}) — still recoverable via recall.`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `forget failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 7: scan
  // -------------------------------------------------------------------------

  server.tool(
    'scan',
    'Scan a local directory and automatically convert files into memories. ' +
    'Supports .md, .ts, .js, .py, .json, .txt, and many more file types. ' +
    'Files already indexed (same content hash) are skipped — scanning is idempotent.',
    {
      path: z
        .string()
        .min(1)
        .describe('Absolute or relative path to the directory to scan.'),
      recursive: z
        .boolean()
        .optional()
        .describe('Recurse into subdirectories. Defaults to true.'),
      git: z
        .boolean()
        .optional()
        .describe('Also import recent git commit history as memories. Defaults to true.'),
      max_kb: z
        .number()
        .int()
        .min(1)
        .max(10240)
        .optional()
        .describe('Maximum individual file size in KB to process. Defaults to 1024 KB (1 MB).'),
    },
    async ({ path, recursive, git, max_kb }) => {
      try {
        const scanner = new StellarScanner({
          paths: [path],
          maxFileSize: (max_kb ?? 1024) * 1024,
        });

        const result = await scanner.scanPath(path, {
          recursive:  recursive ?? true,
          includeGit: git ?? true,
        });

        const lines: string[] = [
          `Scan: ${path} | ${(result.durationMs / 1000).toFixed(2)}s`,
          `  files: ${result.scannedFiles}  new: ${result.createdMemories}  skipped: ${result.skippedFiles}  errors: ${result.errorFiles}`,
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `scan failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 8: sync
  // -------------------------------------------------------------------------

  server.tool(
    'sync',
    'Pull documents from cloud services into stellar memory. ' +
    'If credentials are provided, the service is connected first before syncing. ' +
    'Only fetches content modified since the given time (incremental by default). ' +
    'Each document becomes a memory planet in the appropriate orbital zone.',
    {
      service: z
        .enum(['google-drive', 'notion', 'github', 'slack'])
        .optional()
        .describe(
          'Specific service to connect and/or sync. If omitted (and no credentials), all connected services are synced.'
        ),
      since: z
        .string()
        .optional()
        .describe('Relative time ("24h", "7d") or ISO date. Default: "24h".'),
      credentials: z
        .record(z.string())
        .optional()
        .describe(
          'Service credentials. If provided, connects to the service before syncing. ' +
          'Google Drive (Service Account): client_email, private_key. ' +
          'Google Drive (OAuth2): client_id, client_secret, refresh_token. ' +
          'Notion: api_key. ' +
          'GitHub: personal_access_token, repositories (optional CSV). ' +
          'Slack: bot_token, include_dms (optional "true"/"false").'
        ),
    },
    async ({ service, since, credentials }) => {
      try {
        const proj = resolveProject();

        // ── Connect phase (if credentials supplied) ──────────────────────────
        if (credentials !== undefined) {
          if (!service) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'sync: "service" is required when "credentials" are provided.'
            );
          }

          let connector: CloudConnector;
          switch (service) {
            case 'google-drive': connector = new GoogleDriveConnector(); break;
            case 'notion':       connector = new NotionConnector();      break;
            case 'github':       connector = new GitHubConnector();      break;
            case 'slack':        connector = new SlackConnector();       break;
          }

          await connector.authenticate(credentials);
          connectorRegistry.set(service, connector);

          // Rebuild scheduler with updated registry
          if (_scheduler) {
            _scheduler.stop();
            _scheduler = null;
          }

          log.info('Cloud connector registered via sync', { service });
        }

        // ── Sync phase ───────────────────────────────────────────────────────
        if (connectorRegistry.size === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No cloud services connected. Provide credentials to connect a service.',
            }],
          };
        }

        const sinceDate = since
          ? parseRelativeTime(since)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);

        const targets: CloudConnector[] = service
          ? (connectorRegistry.get(service) ? [connectorRegistry.get(service)!] : [])
          : Array.from(connectorRegistry.values());

        if (targets.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `Service "${service}" is not connected. Provide credentials to connect it.`,
            }],
          };
        }

        const lines: string[] = [`Sync (project: ${proj} | since: ${sinceDate.toISOString()}):`];
        let totalCreated = 0;

        for (const connector of targets) {
          try {
            log.info('Syncing', { connector: connector.type, since: sinceDate.toISOString() });
            const docs = await connector.fetchDocuments(sinceDate);
            let created = 0;

            for (const doc of docs) {
              try {
                const input = connector.toMemory(doc);
                createMemory({
                  project: proj,
                  content: input.content,
                  summary: input.summary,
                  type:    input.type,
                  tags:    input.tags,
                });
                created++;
              } catch (memErr) {
                log.warn('Failed to create memory from doc', { docId: doc.id });
              }
            }

            lines.push(`  ${connector.name}: ${docs.length} fetched, ${created} stored`);
            totalCreated += created;
          } catch (syncErr) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            lines.push(`  ${connector.name}: FAILED — ${msg}`);
            log.error(`Sync failed for ${connector.type}`,
              syncErr instanceof Error ? syncErr : new Error(msg));
          }
        }

        lines.push(`  Total: ${totalCreated} memories created`);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `sync failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 9: daemon
  // -------------------------------------------------------------------------

  server.tool(
    'daemon',
    'Control the background scheduler daemon. ' +
    'The scheduler automatically recalculates orbits, runs local scans, syncs cloud sources, ' +
    'and cleans up the Oort cloud on configurable intervals.',
    {
      action: z
        .enum(['status', 'start', 'stop'])
        .describe(
          '"status" — show current scheduler state and last run times. ' +
          '"start"  — start the background scheduler. ' +
          '"stop"   — stop the background scheduler.'
        ),
    },
    async ({ action }) => {
      try {
        const scheduler = getOrCreateScheduler();

        switch (action) {
          case 'start': {
            scheduler.start();
            _schedulerStartedAt = new Date();
            return {
              content: [{ type: 'text' as const, text: 'Daemon: started.' }],
            };
          }

          case 'stop': {
            scheduler.stop();
            _schedulerStartedAt = null;
            return {
              content: [{ type: 'text' as const, text: 'Daemon: stopped.' }],
            };
          }

          case 'status': {
            const taskStatus = scheduler.getStatus();
            const isRunning  = _schedulerStartedAt !== null;
            const startedStr = _schedulerStartedAt
              ? _schedulerStartedAt.toISOString()
              : '—';
            const services = [...connectorRegistry.keys()].join(', ') || 'none';

            const lines: string[] = [
              `Daemon: ${isRunning ? 'RUNNING' : 'STOPPED'} | started: ${startedStr} | services: ${services}`,
              '',
            ];

            for (const [name, status] of Object.entries(taskStatus)) {
              const last = status.lastRunAt ? status.lastRunAt.toISOString() : 'never';
              const dur  = status.lastDuration !== null ? `${status.lastDuration}ms` : '—';
              const err  = status.lastError ? ` ERR: ${status.lastError}` : '';
              lines.push(
                `  ${name.padEnd(22)} runs=${status.runCount}  last=${last}  dur=${dur}${err}`
              );
            }

            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
            };
          }
        }
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `daemon failed: ${String(err)}`);
      }
    }
  );

  return server;
}
