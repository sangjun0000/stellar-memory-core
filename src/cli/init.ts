#!/usr/bin/env node
/**
 * stellar-memory init — One-command setup for Stellar Memory MCP server.
 *
 * Usage:
 *   npx stellar-memory init          # Configure Claude Code + download model
 *   npx stellar-memory init --skip-model  # Skip embedding model download
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(msg: string): void {
  console.log(msg);
}

function success(msg: string): void {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${YELLOW}!${RESET} ${msg}`);
}

function fail(msg: string): void {
  console.error(`${RED}✗${RESET} ${msg}`);
}

function checkNodeVersion(): boolean {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    fail(`Node.js 22.5+ required (detected: ${process.versions.node})`);
    log('  Upgrade: nvm install 22 && nvm use 22');
    return false;
  }
  success(`Node.js ${process.versions.node}`);
  return true;
}

function checkClaudeCLI(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function configureMCP(): boolean {
  if (!checkClaudeCLI()) {
    warn('Claude CLI not found — skipping MCP auto-configuration');
    log('');
    log('  To manually configure, add to your MCP settings:');
    log(`  ${CYAN}claude mcp add stellar-memory -- npx -y stellar-memory${RESET}`);
    log('');
    return false;
  }

  log('');
  log('Configuring Claude MCP server...');

  const result = spawnSync('claude', [
    'mcp', 'add', 'stellar-memory', '--', 'npx', '-y', 'stellar-memory'
  ], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) {
    success('MCP server registered with Claude');
    return true;
  } else {
    warn('MCP auto-configuration failed');
    log('  You can manually run:');
    log(`  ${CYAN}claude mcp add stellar-memory -- npx -y stellar-memory${RESET}`);
    return false;
  }
}

async function downloadModel(): Promise<boolean> {
  log('');
  log('Downloading embedding model (~90 MB, one-time)...');

  const setupScript = resolve(ROOT, '..', 'scripts', 'setup.mjs');

  // When installed via npm, scripts/ is at the package root
  // When running from source, it's at ../scripts/
  const candidates = [
    resolve(ROOT, 'scripts', 'setup.mjs'),        // npm installed (dist/scripts/)
    resolve(ROOT, '..', 'scripts', 'setup.mjs'),   // from source (src/../scripts/)
  ];

  const scriptPath = candidates.find(p => existsSync(p));

  if (!scriptPath) {
    // Fallback: run inline model download
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = process.env['TRANSFORMERS_CACHE'] ?? undefined;
      await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
        progress_callback: (info: { status: string; progress?: number }) => {
          if (info.status === 'progress' && info.progress != null) {
            const pct = Math.round(info.progress);
            process.stdout.write(`\r  Downloading... ${pct}%   `);
          }
        },
      });
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      success('Embedding model downloaded');
      return true;
    } catch (err) {
      warn(`Model download failed: ${(err as Error).message}`);
      log('  You can retry later: npx stellar-memory setup');
      return false;
    }
  }

  const result = spawnSync('node', [scriptPath], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) {
    success('Embedding model ready');
    return true;
  } else {
    warn('Model download failed — you can retry: npm run setup');
    return false;
  }
}

async function main(): Promise<void> {
  log('');
  log(`${BOLD}${CYAN}  Stellar Memory — Setup${RESET}`);
  log(`  ${'─'.repeat(40)}`);
  log('');

  // 1. Check Node.js
  if (!checkNodeVersion()) {
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const skipModel = args.includes('--skip-model');

  // 2. Download embedding model
  if (!skipModel) {
    await downloadModel();
  } else {
    warn('Skipping model download (--skip-model)');
  }

  // 3. Configure MCP
  configureMCP();

  // 4. Install Claude Code hooks (auto-restore + auto-observe + auto-commit)
  const { installHooks } = await import('./hooks/install.js');
  installHooks();

  // 5. Done
  log('');
  log(`${BOLD}${GREEN}  Setup complete!${RESET}`);
  log('');
  log('  Stellar Memory will activate automatically in Claude Code.');
  log('  Start a conversation and your memories will persist across sessions.');
  log('');
  log(`  ${CYAN}Dashboard:${RESET}  npx stellar-memory api   → http://localhost:21547`);
  log(`  ${CYAN}Docs:${RESET}       https://stellar-memory.com`);
  log('');
}

main().catch((err) => {
  fail(`Setup failed: ${err.message}`);
  process.exit(1);
});
