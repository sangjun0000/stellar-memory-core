import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStellarServer } from './mcp/server.js';
import { initDatabase } from './storage/database.js';
import { getConfig } from './utils/config.js';
import { autoCommitOnClose } from './engine/sun.js';
import { switchProject } from './engine/multiproject.js';

/**
 * Validate that the runtime environment meets Stellar Memory's requirements.
 * Exits with a human-readable error message if anything is missing.
 */
function validateEnvironment(): void {
  // Check Node.js version (requires 22+ for node:sqlite)
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) {
    console.error(
      `[stellar-memory] ERROR: Node.js 22 or higher is required.\n` +
      `  Detected: Node.js ${process.versions.node}\n` +
      `  Upgrade:  nvm install 22 && nvm use 22\n` +
      `            or visit https://nodejs.org/en/download`
    );
    process.exit(1);
  }

  // node:sqlite is available since Node 22.5.0 — check the minor version.
  const nodeVersion = process.versions.node.split('.').map(Number);
  const [, minor] = nodeVersion;
  if (major === 22 && minor < 5) {
    console.error(
      `[stellar-memory] ERROR: Node.js 22.5.0 or higher is required for node:sqlite.\n` +
      `  Detected: Node.js ${process.versions.node}\n` +
      `  Upgrade:  nvm install 22 && nvm use 22`
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  validateEnvironment();
  const config = getConfig();

  // Initialize SQLite database (creates schema on first run)
  initDatabase(config.dbPath);

  // Auto-detect and switch to the project based on cwd/git repo
  if (config.defaultProject !== 'default') {
    switchProject(config.defaultProject);
    console.error(`[stellar-memory] Auto-detected project: ${config.defaultProject}`);
  }

  // Create MCP server with all tools and resources registered
  const server = createStellarServer();

  // ── Shutdown handlers ────────────────────────────────────────────────────
  // Auto-commit sun state so the next session resumes with full context.
  let shutdownDone = false;
  const onShutdown = (): void => {
    if (shutdownDone) return;
    shutdownDone = true;
    autoCommitOnClose(config.defaultProject);
  };

  process.on('exit', onShutdown);
  process.on('SIGTERM', () => { onShutdown(); process.exit(0); });
  process.on('SIGINT', () => { onShutdown(); process.exit(0); });

  // Connect via stdio transport (used by Claude Code / Claude Desktop)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[stellar-memory] Server started');
  console.error(`[stellar-memory] Project: ${config.defaultProject}`);
  console.error(`[stellar-memory] DB: ${config.dbPath}`);
}

main().catch((err) => {
  console.error('[stellar-memory] Fatal error:', err);
  process.exit(1);
});
