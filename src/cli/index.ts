#!/usr/bin/env node
/**
 * Stellar Memory CLI entry point.
 *
 * Routes between:
 *   - `stellar-memory`              → MCP server (stdio transport, default)
 *   - `stellar-memory init`         → Setup wizard
 *   - `stellar-memory setup`        → Download embedding model only
 *   - `stellar-memory api`          → Start REST API server
 *   - `stellar-memory hook-restore` → SessionStart hook (auto context restore)
 *   - `stellar-memory hook-stop`    → Stop hook (auto observe + commit)
 *   - `stellar-memory hook-install` → Install Claude Code hooks
 */

const command = process.argv[2];

switch (command) {
  case 'init':
    await import('./init.js');
    break;

  case 'setup': {
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { spawnSync } = await import('node:child_process');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const setupPath = resolve(__dirname, '..', 'scripts', 'setup.mjs');
    const result = spawnSync('node', [setupPath], { stdio: 'inherit', shell: true });
    process.exit(result.status ?? 1);
  }

  case 'api':
    await import('../api/server.js');
    break;

  case 'hook-restore':
    await import('./hooks/restore.js');
    break;

  case 'hook-stop':
    await import('./hooks/stop.js');
    break;

  case 'hook-install':
    await import('./hooks/install.js');
    break;

  default:
    // No subcommand or unknown → start MCP server (stdio)
    await import('../index.js');
    break;
}
