/**
 * mcp/tools/ingestion-tools.ts — Handler functions for scan and sync MCP tools.
 *
 * Exported functions:
 *   handleScan — scan tool (local directory ingestion)
 *   handleSync — sync tool (cloud service ingestion)
 *
 * The sync handler receives a ConnectorRegistry so it can mutate the shared
 * registry state without knowing how the registry was created (testable).
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { createMemory } from '../../engine/planet.js';
import { StellarScanner } from '../../scanner/index.js';
import { GoogleDriveConnector } from '../../scanner/cloud/google-drive.js';
import { NotionConnector }      from '../../scanner/cloud/notion.js';
import { GitHubConnector }      from '../../scanner/cloud/github.js';
import { SlackConnector }       from '../../scanner/cloud/slack.js';
import type { CloudConnector }  from '../../scanner/cloud/types.js';
import { getConfig }            from '../../utils/config.js';
import { parseRelativeTime }    from '../../utils/time.js';
import { createLogger }         from '../../utils/logger.js';
import type { ConnectorRegistry } from '../connector-registry.js';

const log = createLogger('ingestion-tools');

type McpResponse = { content: [{ type: 'text'; text: string }] };

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

export async function handleScan(args: {
  path: string;
  recursive?: boolean;
  git?: boolean;
  max_kb?: number;
}): Promise<McpResponse> {
  try {
    const scanner = new StellarScanner({
      paths:       [args.path],
      maxFileSize: (args.max_kb ?? 1024) * 1024,
    });

    const result = await scanner.scanPath(args.path, {
      recursive:  args.recursive ?? true,
      includeGit: args.git ?? true,
    });

    const lines: string[] = [
      `Scan: ${args.path} | ${(result.durationMs / 1000).toFixed(2)}s`,
      `  files: ${result.scannedFiles}  new: ${result.createdMemories}  skipped: ${result.skippedFiles}  errors: ${result.errorFiles}`,
    ];

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `scan failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

export async function handleSync(
  args: {
    service?: 'google-drive' | 'notion' | 'github' | 'slack';
    since?: string;
    credentials?: Record<string, string>;
  },
  registry: ConnectorRegistry,
): Promise<McpResponse> {
  try {
    const proj = getConfig().defaultProject;

    // ── Connect phase (if credentials supplied) ─────────────────────────────
    if (args.credentials !== undefined) {
      if (!args.service) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'sync: "service" is required when "credentials" are provided.'
        );
      }

      let connector: CloudConnector;
      switch (args.service) {
        case 'google-drive': connector = new GoogleDriveConnector(); break;
        case 'notion':       connector = new NotionConnector();      break;
        case 'github':       connector = new GitHubConnector();      break;
        case 'slack':        connector = new SlackConnector();       break;
      }

      await connector.authenticate(args.credentials);
      registry.set(args.service, connector);
      log.info('Cloud connector registered via sync', { service: args.service });
    }

    // ── Sync phase ──────────────────────────────────────────────────────────
    if (registry.size === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No cloud services connected. Provide credentials to connect a service.',
        }],
      };
    }

    const sinceDate = args.since
      ? parseRelativeTime(args.since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const targets: CloudConnector[] = args.service
      ? (registry.get(args.service) ? [registry.get(args.service)!] : [])
      : registry.values();

    if (targets.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `Service "${args.service}" is not connected. Provide credentials to connect it.`,
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

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `sync failed: ${String(err)}`);
  }
}
