import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { MemoryType, OrbitZone, Memory, OrbitChange } from '../engine/types.js';
import { ORBIT_ZONES } from '../engine/types.js';
import { getSunContent, commitToSun } from '../engine/sun.js';
import { createMemory, recallMemories, forgetMemory } from '../engine/planet.js';
import { recalculateOrbits, getOrbitZone } from '../engine/orbit.js';
import { getMemoriesByProject } from '../storage/queries.js';
import { getConfig } from '../utils/config.js';
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

/** Resolve project: use provided value or fall back to default from config. */
function resolveProject(project: string | undefined): string {
  return project ?? getConfig().defaultProject;
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
 * Build a readable one-memory summary for list output.
 */
function formatMemoryLine(m: Memory, index: number): string {
  const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
  return (
    `${index + 1}. [${m.type.toUpperCase()}] ${m.summary}${tags}\n` +
    `   ID: ${m.id} | Distance: ${formatDistance(m.distance)} | Importance: ${(m.importance * 100).toFixed(0)}%`
  );
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createStellarServer(): McpServer {
  const server = new McpServer({
    name: 'stellar-memory',
    version: '0.1.0',
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
  // Tool 1: stellar_status
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_status',
    'View the current state of your stellar memory system. Shows all memories grouped by orbital zone ' +
    '(corona = actively working, oort = nearly forgotten). Use this to get a snapshot of what the system knows.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name to inspect. Defaults to the configured default project.'),
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
    },
    async ({ project, zone, limit }) => {
      try {
        const proj = resolveProject(project);
        const effectiveLimit = limit ?? 50;
        const effectiveZone = zone ?? 'all';

        // getMemoriesByProject returns all non-deleted memories sorted by distance ASC
        const all: Memory[] = getMemoriesByProject(proj);
        const memories = all.slice(0, effectiveLimit);

        // Filter by zone if requested
        const filtered =
          effectiveZone === 'all'
            ? memories
            : memories.filter((m) => {
                const zoneKey = labelToZoneKey(getOrbitZone(m.distance));
                return zoneKey === effectiveZone;
              });

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No memories found for project "${proj}"${effectiveZone !== 'all' ? ` in zone "${effectiveZone}"` : ''}.`,
              },
            ],
          };
        }

        // Group by zone key
        const byZone: Partial<Record<OrbitZone, Memory[]>> = {};
        for (const m of filtered) {
          const zoneKey = labelToZoneKey(getOrbitZone(m.distance));
          const bucket = byZone[zoneKey] ?? [];
          bucket.push(m);
          byZone[zoneKey] = bucket;
        }

        const zoneOrder: OrbitZone[] = ['corona', 'inner', 'habitable', 'outer', 'kuiper', 'oort'];
        const lines: string[] = [
          `Stellar Memory — Project: ${proj}`,
          `Total memories: ${filtered.length}`,
          '',
        ];

        for (const zoneName of zoneOrder) {
          const zoneMemories = byZone[zoneName];
          if (!zoneMemories || zoneMemories.length === 0) continue;

          const zoneInfo = ORBIT_ZONES[zoneName];
          lines.push(`== ${zoneInfo.label} (${zoneMemories.length} memor${zoneMemories.length === 1 ? 'y' : 'ies'}) ==`);
          zoneMemories.forEach((m, i) => {
            lines.push(formatMemoryLine(m, i));
          });
          lines.push('');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_status failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 2: stellar_commit
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_commit',
    'Save the current session state into the Sun (working context). Call this at the end of each session ' +
    'or when switching tasks to preserve your progress. The Sun is automatically available as a resource next session.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name. Defaults to the configured default project.'),
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
    async ({ project, current_work, decisions, next_steps, errors, context }) => {
      try {
        const proj = resolveProject(project);
        const config = getConfig();

        commitToSun(proj, {
          current_work,
          decisions: decisions ?? [],
          next_steps: next_steps ?? [],
          errors: errors ?? [],
          context: context ?? '',
        });

        // After committing, recalculate orbits so related memories gravitate closer
        const changes: OrbitChange[] = recalculateOrbits(proj, config);

        const orbitSummary =
          changes.length > 0
            ? `Recalculated orbits for ${changes.length} memor${changes.length === 1 ? 'y' : 'ies'}.`
            : 'No orbital changes triggered.';

        const lines: string[] = [
          `Sun committed for project "${proj}".`,
          `Current work: ${current_work}`,
        ];
        if (decisions && decisions.length > 0) {
          lines.push(`Decisions recorded: ${decisions.length} (each stored as a memory planet)`);
        }
        if (next_steps && next_steps.length > 0) {
          lines.push(`Next steps saved: ${next_steps.length}`);
        }
        if (errors && errors.length > 0) {
          lines.push(`Active errors tracked: ${errors.length}`);
        }
        lines.push(orbitSummary);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_commit failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 3: stellar_recall
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_recall',
    'Search memories by content and pull relevant ones closer to the Sun (increasing their importance). ' +
    'Use this to surface forgotten context that is relevant to your current work.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name. Defaults to the configured default project.'),
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
      max_distance: z
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
    async ({ project, query, type, max_distance, limit }) => {
      try {
        const proj = resolveProject(project);

        const memoryType: MemoryType | 'all' | undefined =
          type === 'all' ? undefined : (type as MemoryType | undefined);

        const results: Memory[] = recallMemories(proj, query, {
          type: memoryType,
          maxDistance: max_distance,
          limit: limit ?? 10,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No memories found matching "${query}" in project "${proj}".`,
              },
            ],
          };
        }

        const lines: string[] = [
          `Recall results for "${query}" in project "${proj}" (${results.length} found):`,
          '(Recalled memories have been pulled closer to the Sun)',
          '',
        ];

        results.forEach((m, i) => {
          lines.push(`${i + 1}. [${m.type.toUpperCase()}] ${m.summary}`);
          lines.push(`   Distance: ${formatDistance(m.distance)}`);
          lines.push(
            `   Content: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`
          );
          if (m.tags.length > 0) {
            lines.push(`   Tags: ${m.tags.join(', ')}`);
          }
          lines.push(`   ID: ${m.id} | Importance: ${(m.importance * 100).toFixed(0)}%`);
          lines.push('');
        });

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_recall failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 4: stellar_remember
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_remember',
    'Store a new memory in the stellar system. Memories are automatically placed in an orbital zone ' +
    'based on their type and impact. High-impact decisions orbit closer; low-impact observations orbit further.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name. Defaults to the configured default project.'),
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
    async ({ project, content, summary, type, impact, tags }) => {
      try {
        const proj = resolveProject(project);

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
              text: [
                `Memory stored in project "${proj}".`,
                `ID: ${memory.id}`,
                `Type: ${memory.type}`,
                `Summary: ${memory.summary}`,
                `Orbital placement: ${formatDistance(memory.distance)}`,
                `Zone: ${zoneLabel}`,
                `Importance: ${(memory.importance * 100).toFixed(0)}%`,
                tags && tags.length > 0 ? `Tags: ${tags.join(', ')}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_remember failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 5: stellar_orbit
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_orbit',
    'Force a recalculation of all orbital positions for a project. Memories decay over time ' +
    '(drifting outward) and are pulled inward by access and relevance. ' +
    'Run this to apply pending orbital physics without committing a new session.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name. Defaults to the configured default project.'),
    },
    async ({ project }) => {
      try {
        const proj = resolveProject(project);
        const config = getConfig();
        const changes: OrbitChange[] = recalculateOrbits(proj, config);

        if (changes.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No orbital changes for project "${proj}". All memories are stable.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `Orbital recalculation for project "${proj}": ${changes.length} change${changes.length === 1 ? '' : 's'}`,
          '',
        ];

        let closerCount = 0;
        let furtherCount = 0;

        for (const change of changes) {
          const delta = change.new_distance - change.old_distance;
          const direction = delta < 0 ? 'pulled closer' : 'drifted further';
          const absAU = Math.abs(delta).toFixed(2);

          if (delta < 0) closerCount++;
          else furtherCount++;

          const oldZone = getOrbitZone(change.old_distance);
          const newZone = getOrbitZone(change.new_distance);
          const zoneChange = oldZone !== newZone ? ` | Zone: ${oldZone} -> ${newZone}` : '';

          lines.push(
            `  ${direction} by ${absAU} AU ` +
            `(${change.old_distance.toFixed(2)} -> ${change.new_distance.toFixed(2)} AU)` +
            `${zoneChange}`
          );
          lines.push(`  Trigger: ${change.trigger} | Memory: ${change.memory_id}`);
          lines.push('');
        }

        lines.push(`Summary: ${closerCount} pulled closer, ${furtherCount} drifted further.`);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_orbit failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 6: stellar_forget
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_forget',
    'Push a memory into a distant orbit (soft forget) or permanently delete it. ' +
    'Use "push" to deprioritize without losing data; use "delete" only when the memory is truly irrelevant.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name. Used to verify the memory belongs to this project.'),
      memory_id: z
        .string()
        .min(1)
        .describe(
          'The ID of the memory to forget. Get IDs from stellar_status or stellar_recall output.'
        ),
      mode: z
        .enum(['push', 'delete'])
        .optional()
        .describe(
          '"push" moves the memory to the Oort Cloud (distant but recoverable via stellar_recall). ' +
          '"delete" permanently removes it. Defaults to "push".'
        ),
    },
    async ({ project: _project, memory_id, mode }) => {
      try {
        const effectiveMode = mode ?? 'push';

        forgetMemory(memory_id, effectiveMode);

        if (effectiveMode === 'delete') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Memory "${memory_id}" permanently deleted.`,
              },
            ],
          };
        }

        // Push mode — memory is at Oort cloud distance (95 AU per planet.ts)
        const oortDistance = 95.0;
        const zoneLabel = getOrbitZone(oortDistance);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Memory "${memory_id}" pushed to outer orbit.`,
                `New position: ${oortDistance.toFixed(2)} AU`,
                `Zone: ${zoneLabel}`,
                'The memory is still recoverable via stellar_recall if needed.',
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_forget failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 7: stellar_scan
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_scan',
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
      include_git: z
        .boolean()
        .optional()
        .describe('Also import recent git commit history as memories. Defaults to true.'),
      max_file_size_kb: z
        .number()
        .int()
        .min(1)
        .max(10240)
        .optional()
        .describe('Maximum individual file size in KB to process. Defaults to 1024 KB (1 MB).'),
    },
    async ({ path, recursive, include_git, max_file_size_kb }) => {
      try {
        const scanner = new StellarScanner({
          paths: [path],
          maxFileSize: (max_file_size_kb ?? 1024) * 1024,
        });

        const result = await scanner.scanPath(path, {
          recursive:   recursive ?? true,
          includeGit:  include_git ?? true,
        });

        const lines: string[] = [
          `Scan complete for: ${path}`,
          `Duration: ${(result.durationMs / 1000).toFixed(2)}s`,
          '',
          `Files scanned:       ${result.scannedFiles}`,
          `Memories created:    ${result.createdMemories}`,
          `Files skipped:       ${result.skippedFiles}  (already indexed or excluded)`,
          `Files with errors:   ${result.errorFiles}`,
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_scan failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 8: stellar_sources
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_sources',
    'List all data sources (directories) that have been registered for scanning. ' +
    'Shows scan status, file counts, and last scan time for each source.',
    {},
    async () => {
      try {
        const sources = listDataSources();

        if (sources.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No data sources registered yet. Use stellar_scan to scan a directory.',
            }],
          };
        }

        const lines: string[] = [
          `Registered data sources (${sources.length}):`,
          '',
        ];

        for (const ds of sources) {
          const lastScan = ds.last_scanned_at
            ? new Date(ds.last_scanned_at).toLocaleString()
            : 'Never';
          const sizeMB = (ds.total_size / 1_048_576).toFixed(2);

          lines.push(`Path: ${ds.path}`);
          lines.push(`  Status:       ${ds.status}`);
          lines.push(`  Type:         ${ds.type}`);
          lines.push(`  Files:        ${ds.file_count} (${sizeMB} MB total)`);
          lines.push(`  Last scanned: ${lastScan}`);
          lines.push(`  ID:           ${ds.id}`);
          lines.push('');
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_sources failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 9: stellar_connect
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_connect',
    'Connect a cloud service (Google Drive, Notion, GitHub, or Slack) so that stellar_sync can pull ' +
    'documents into memory. Credentials are passed as key-value pairs and are stored only in process ' +
    'memory — they are never written to disk.',
    {
      service: z
        .enum(['google-drive', 'notion', 'github', 'slack'])
        .describe('Cloud service to connect.'),
      credentials: z
        .record(z.string())
        .describe(
          'Service-specific credentials. ' +
          'Google Drive (Service Account): client_email, private_key. ' +
          'Google Drive (OAuth2): client_id, client_secret, refresh_token. ' +
          'Notion: api_key. ' +
          'GitHub: personal_access_token, repositories (optional CSV). ' +
          'Slack: bot_token, include_dms (optional "true"/"false").'
        ),
    },
    async ({ service, credentials }) => {
      try {
        let connector: CloudConnector;
        switch (service) {
          case 'google-drive': connector = new GoogleDriveConnector(); break;
          case 'notion':       connector = new NotionConnector();      break;
          case 'github':       connector = new GitHubConnector();      break;
          case 'slack':        connector = new SlackConnector();       break;
        }

        await connector.authenticate(credentials);
        connectorRegistry.set(service, connector);

        // Rebuild scheduler with updated registry when next task fires
        if (_scheduler) {
          _scheduler.stop();
          _scheduler = null;
        }

        log.info('Cloud connector registered', { service });

        return {
          content: [{
            type: 'text' as const,
            text: `Connected to ${connector.name}. Use stellar_sync to pull documents into memory.`,
          }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new McpError(ErrorCode.InternalError, `stellar_connect failed: ${msg}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 10: stellar_sync
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_sync',
    'Pull documents from connected cloud services into stellar memory. ' +
    'Only fetches content modified since the last sync by default (incremental). ' +
    'Each document becomes a memory planet in the appropriate orbital zone.',
    {
      service: z
        .enum(['google-drive', 'notion', 'github', 'slack'])
        .optional()
        .describe(
          'Specific service to sync. If omitted, all connected services are synced.'
        ),
      since: z
        .string()
        .optional()
        .describe(
          'ISO 8601 date string. Only fetch documents modified after this date. ' +
          'Defaults to 24 hours ago for incremental sync.'
        ),
      project: z
        .string()
        .optional()
        .describe('Project to store memories in. Defaults to the configured default project.'),
    },
    async ({ service, since, project }) => {
      try {
        if (connectorRegistry.size === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No cloud services connected. Use stellar_connect first.',
            }],
          };
        }

        const proj      = project ?? getConfig().defaultProject;
        const sinceDate = since
          ? new Date(since)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);

        const targets: CloudConnector[] = service
          ? (connectorRegistry.get(service) ? [connectorRegistry.get(service)!] : [])
          : Array.from(connectorRegistry.values());

        if (targets.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: service
                ? `Service "${service}" is not connected. Use stellar_connect first.`
                : 'No connected services found.',
            }],
          };
        }

        const lines: string[] = [`Cloud sync started (project: "${proj}"):`, ''];
        let totalDocs = 0;

        for (const connector of targets) {
          try {
            log.info('Syncing', { connector: connector.type, since: sinceDate.toISOString() });
            const docs = await connector.fetchDocuments(sinceDate);
            let created = 0;

            for (const doc of docs) {
              try {
                const input = connector.toMemory(doc);
                createMemory({
                  project:  proj,
                  content:  input.content,
                  summary:  input.summary,
                  type:     input.type,
                  tags:     input.tags,
                });
                created++;
              } catch (memErr) {
                log.warn('Failed to create memory from doc', { docId: doc.id });
              }
            }

            lines.push(`${connector.name}: ${docs.length} documents fetched, ${created} memories created`);
            totalDocs += created;
          } catch (syncErr) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            lines.push(`${connector.name}: FAILED — ${msg}`);
            log.error(`Sync failed for ${connector.type}`,
              syncErr instanceof Error ? syncErr : new Error(msg));
          }
        }

        lines.push('', `Total memories created: ${totalDocs}`);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `stellar_sync failed: ${String(err)}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 11: stellar_daemon
  // -------------------------------------------------------------------------

  server.tool(
    'stellar_daemon',
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
              content: [{ type: 'text' as const, text: 'Background scheduler started.' }],
            };
          }

          case 'stop': {
            scheduler.stop();
            _schedulerStartedAt = null;
            return {
              content: [{ type: 'text' as const, text: 'Background scheduler stopped.' }],
            };
          }

          case 'status': {
            const taskStatus = scheduler.getStatus();
            const isRunning  = _schedulerStartedAt !== null;
            const lines: string[] = [
              `Scheduler: ${isRunning ? 'RUNNING' : 'STOPPED'}`,
              _schedulerStartedAt
                ? `Started:   ${_schedulerStartedAt.toISOString()}`
                : 'Started:   —',
              `Connected: ${connectorRegistry.size} cloud service(s) (${[...connectorRegistry.keys()].join(', ') || 'none'})`,
              '',
              'Tasks:',
            ];

            for (const [name, status] of Object.entries(taskStatus)) {
              const last = status.lastRunAt ? status.lastRunAt.toISOString() : 'never';
              const dur  = status.lastDuration !== null ? `${status.lastDuration}ms` : '—';
              const err  = status.lastError ? ` | ERROR: ${status.lastError}` : '';
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
        throw new McpError(ErrorCode.InternalError, `stellar_daemon failed: ${String(err)}`);
      }
    }
  );

  return server;
}
