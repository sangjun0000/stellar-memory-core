import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStellarServer } from './mcp/server.js';
import { initDatabase, isReembedNeeded } from './storage/database.js';
import { getConfig } from './utils/config.js';
import { autoCommitOnClose } from './engine/sun.js';
import { processConversation } from './engine/observation.js';
import { switchProject, getCurrentProject } from './engine/multiproject.js';
import { startReembedding } from './engine/reembed.js';
import {
  startSession,
  endSession,
  startCheckpointTimer,
  stopCheckpointTimer,
} from './engine/ledger.js';
import { runSleepConsolidation } from './engine/sleep-consolidation.js';

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

  // If the vec tables were dropped due to a dimension upgrade, start the
  // background queue that re-embeds all memories with the new model.
  if (isReembedNeeded()) {
    startReembedding();
  }

  // Auto-detect and switch to the project based on cwd/git repo
  if (config.defaultProject !== 'default') {
    switchProject(config.defaultProject);
    console.error(`[stellar-memory] Auto-detected project: ${config.defaultProject}`);
  }

  // ── Session lifecycle ───────────────────────────────────────────────────
  startSession(config.defaultProject);
  startCheckpointTimer(config.defaultProject);

  // Create MCP server with all tools and resources registered
  const server = createStellarServer();

  // ── Shutdown handlers ────────────────────────────────────────────────────
  // Auto-commit sun state so the next session resumes with full context.
  let shutdownDone = false;
  const onShutdown = (): void => {
    if (shutdownDone) return;
    shutdownDone = true;

    // Stop the checkpoint timer first (synchronous)
    stopCheckpointTimer();

    // End session and run sleep consolidation before auto-commit
    const project = getCurrentProject();
    const completedSession = endSession(project);
    if (completedSession) {
      try {
        runSleepConsolidation(completedSession, project);
      } catch {
        // Non-fatal: sleep consolidation must never prevent shutdown
      }
    }

    autoCommitOnClose(project);
  };

  process.on('exit', onShutdown);
  process.on('SIGTERM', () => { onShutdown(); process.exit(0); });
  process.on('SIGINT', () => { onShutdown(); process.exit(0); });

  // ── Periodic auto-commit timer ──────────────────────────────────────────
  // Every 5 minutes: auto-commit sun state + process hook buffer file.
  // Runs in-process (no spawn), non-blocking to Claude's responses.
  const AUTO_COMMIT_INTERVAL = 5 * 60 * 1000;
  const BUFFER_PATH = join(homedir(), '.stellar-memory', 'hook-buffer.txt');

  const periodicTimer = setInterval(async () => {
    try {
      autoCommitOnClose(getCurrentProject(), 'periodic');
    } catch (err) {
      console.error(`[stellar-memory] Periodic auto-commit failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Process hook buffer file if it has enough content
    try {
      if (existsSync(BUFFER_PATH)) {
        const stat = statSync(BUFFER_PATH);
        if (stat.size > 500) {
          const buffer = readFileSync(BUFFER_PATH, 'utf-8');
          await processConversation(buffer, getCurrentProject());
          // Keep tail for continuity
          writeFileSync(BUFFER_PATH, buffer.slice(-500));
        }
      }
    } catch (err) {
      console.error(`[stellar-memory] Buffer processing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, AUTO_COMMIT_INTERVAL);

  process.on('exit', () => clearInterval(periodicTimer));

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
