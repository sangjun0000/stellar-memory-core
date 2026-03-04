import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStellarServer } from './mcp/server.js';
import { initDatabase } from './storage/database.js';
import { getConfig } from './utils/config.js';
import { autoCommitOnClose } from './engine/sun.js';

async function main(): Promise<void> {
  const config = getConfig();

  // Initialize SQLite database (creates schema on first run)
  initDatabase(config.dbPath);

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
