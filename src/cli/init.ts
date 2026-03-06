#!/usr/bin/env node
/**
 * stellar-memory init — One-command setup for Stellar Memory MCP server.
 *
 * Usage:
 *   npx stellar-memory init          # Configure Claude Code + download model
 *   npx stellar-memory init --skip-model  # Skip embedding model download
 *   npx stellar-memory init --global  # Register MCP globally (default)
 *   npx stellar-memory init --project # Register MCP in .mcp.json (project-level)
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

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

/** Prompt user for a yes/no or choice question. Returns trimmed input. */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['-y', 'stellar-memory'],
};

/** Write MCP config to project-level .mcp.json in cwd. */
function configureMCPProject(): boolean {
  const mcpPath = join(process.cwd(), '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};

  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      warn('.mcp.json exists but is unreadable — overwriting');
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  if (config.mcpServers['stellar-memory']) {
    success('MCP already registered in .mcp.json');
    return true;
  }

  config.mcpServers['stellar-memory'] = MCP_SERVER_CONFIG;
  writeFileSync(mcpPath, JSON.stringify(config, null, 2));
  success(`MCP registered in ${mcpPath}`);
  log(`  ${CYAN}Scope:${RESET} project-level (only this directory)`);
  return true;
}

/** Write MCP config to global ~/.claude/mcp_settings.json. */
function configureMCPGlobal(): boolean {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'mcp_settings.json');

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  let config: { mcpServers?: Record<string, unknown> } = {};

  if (existsSync(settingsPath)) {
    try {
      config = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      warn('mcp_settings.json exists but is unreadable — overwriting');
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  if (config.mcpServers['stellar-memory']) {
    success('MCP already registered globally (~/.claude/mcp_settings.json)');
    return true;
  }

  config.mcpServers['stellar-memory'] = MCP_SERVER_CONFIG;
  writeFileSync(settingsPath, JSON.stringify(config, null, 2));
  success('MCP registered globally (~/.claude/mcp_settings.json)');
  log(`  ${CYAN}Scope:${RESET} all Claude Code projects`);
  return true;
}

/** Try claude CLI first, then fall back to direct file editing. */
function configureMCPViaCLI(scope: 'global' | 'project'): boolean {
  const scopeFlag = scope === 'global' ? '--global' : '--project';
  const result = spawnSync('claude', [
    'mcp', 'add', scopeFlag, 'stellar-memory', '--', 'npx', '-y', 'stellar-memory'
  ], {
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

async function configureMCP(args: string[]): Promise<boolean> {
  log('');
  log('Configuring Claude MCP server...');

  // Determine scope from flags, or ask interactively
  let scope: 'global' | 'project';

  if (args.includes('--project')) {
    scope = 'project';
  } else if (args.includes('--global')) {
    scope = 'global';
  } else if (!process.stdin.isTTY) {
    // Non-interactive (e.g. piped) — default to global
    scope = 'global';
    log(`  ${CYAN}Defaulting to global MCP registration (non-interactive mode)${RESET}`);
  } else {
    log('');
    log('  Where should Stellar Memory be registered?');
    log(`  ${CYAN}[1]${RESET} Global — available in all Claude Code projects ${BOLD}(recommended)${RESET}`);
    log(`  ${CYAN}[2]${RESET} Project — only this directory (.mcp.json)`);
    log('');
    const answer = await prompt('  Enter 1 or 2 [1]: ');
    scope = answer === '2' ? 'project' : 'global';
  }

  // Try claude CLI if available (it handles edge cases better)
  if (checkClaudeCLI()) {
    if (configureMCPViaCLI(scope)) {
      success(`MCP server registered with Claude (${scope})`);
      return true;
    }
    warn('claude CLI registration failed — falling back to direct config edit');
  }

  // Direct file edit fallback
  if (scope === 'project') {
    return configureMCPProject();
  } else {
    return configureMCPGlobal();
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
  await configureMCP(args);

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
