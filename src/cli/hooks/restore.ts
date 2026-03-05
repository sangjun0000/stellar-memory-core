#!/usr/bin/env node
/**
 * hook-restore — SessionStart hook handler.
 *
 * Reads sun state and core/near memories directly from the DB,
 * outputs formatted context to stdout so it gets injected into
 * Claude's context automatically. No tool call needed.
 *
 * Usage (in Claude Code hooks):
 *   SessionStart → "npx stellar-memory hook-restore"
 */

import { initDatabase } from '../../storage/database.js';
import { getSunState, getMemoriesInZone } from '../../storage/queries.js';
import { formatSunContent } from '../../engine/sun.js';
import { getConfig } from '../../utils/config.js';

try {
  const config = getConfig();
  initDatabase(config.dbPath);

  const project = config.defaultProject;
  const sun = getSunState(project);

  if (!sun) {
    process.stdout.write(
      '[STELLAR MEMORY] No previous session context. Use remember() to start building memory.\n'
    );
    process.exit(0);
  }

  // Get core (< 1.0 AU) and near (1.0-5.0 AU) memories directly from DB.
  // We can't use corona cache here — this is a separate process from the MCP server.
  const coreMemories = getMemoriesInZone(project, 'core');
  const nearMemories = getMemoriesInZone(project, 'near');

  const content = formatSunContent(sun, coreMemories, nearMemories);

  process.stdout.write('[STELLAR MEMORY \u2014 AUTO-RECALL]\n');
  process.stdout.write(content);
  process.stdout.write('\n\nContext auto-restored. Call recall() for specific topics.\n');
} catch (err) {
  // Hook must never block session start
  process.stderr.write(
    `[stellar-memory] hook-restore failed: ${err instanceof Error ? err.message : String(err)}\n`
  );
}
