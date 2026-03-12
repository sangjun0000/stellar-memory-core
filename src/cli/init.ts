#!/usr/bin/env node
/**
 * stellar-memory init -- One-command setup for Stellar Memory MCP server.
 *
 * Usage:
 *   npx stellar-memory init                # Configure Claude Code + download model
 *   npx stellar-memory init --desktop      # Configure Claude Desktop
 *   npx stellar-memory init --codex        # Configure Codex
 *   npx stellar-memory init --client=all   # Configure Claude Code + Desktop + Codex
 *   npx stellar-memory init --skip-model   # Skip embedding model download
 *   npx stellar-memory init --global       # Claude Code: register MCP globally (default)
 *   npx stellar-memory init --project      # Claude Code: register MCP in .mcp.json (project-level)
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

const CODEX_AGENTS_MARKER = '## Stellar Memory Workflow (Codex)';

type ClientTarget = 'claude' | 'codex' | 'desktop' | 'both' | 'all';

function log(msg: string): void {
  console.log(msg);
}

function success(msg: string): void {
  console.log(`${GREEN}OK${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${YELLOW}!${RESET} ${msg}`);
}

function fail(msg: string): void {
  console.error(`${RED}X${RESET} ${msg}`);
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

function parseClientTarget(args: string[]): ClientTarget {
  const explicit = args.find((arg) => arg.startsWith('--client='));
  if (explicit) {
    const value = explicit.slice('--client='.length).toLowerCase();
    if (value === 'claude' || value === 'codex' || value === 'desktop' || value === 'both' || value === 'all') {
      return value;
    }
    warn(`Unknown client target "${value}" -- defaulting to Claude`);
    return 'claude';
  }

  const wantsClaude = args.includes('--claude');
  const wantsCodex = args.includes('--codex');
  const wantsDesktop = args.includes('--desktop');

  if (wantsClaude && wantsCodex && wantsDesktop) return 'all';
  if (wantsClaude && wantsCodex) return 'both';
  if (wantsDesktop) return 'desktop';
  if (wantsCodex) return 'codex';
  return 'claude';
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer.trim());
    });
  });
}

const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['-y', 'stellar-memory'],
};

function configureMCPProject(): boolean {
  const mcpPath = join(process.cwd(), '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};

  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      warn('.mcp.json exists but is unreadable -- overwriting');
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
      warn('mcp_settings.json exists but is unreadable -- overwriting');
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

function getClaudeDesktopConfigPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  // Linux
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'Claude', 'claude_desktop_config.json');
}

function configureClaudeDesktop(): boolean {
  const configPath = getClaudeDesktopConfigPath();
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      warn('claude_desktop_config.json exists but is unreadable -- preserving and adding mcpServers');
    }
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  if (servers['stellar-memory']) {
    success('MCP already registered in Claude Desktop');
    return true;
  }

  // On Windows, Claude Desktop needs npx.cmd (no shell by default)
  const desktopConfig = process.platform === 'win32'
    ? { command: 'npx.cmd', args: ['-y', 'stellar-memory'] }
    : MCP_SERVER_CONFIG;

  servers['stellar-memory'] = desktopConfig;
  config.mcpServers = servers;

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  success(`MCP registered in Claude Desktop`);
  log(`  ${CYAN}Config:${RESET} ${configPath}`);
  log(`  ${CYAN}Action:${RESET} Restart Claude Desktop to activate`);
  return true;
}

function configureMCPViaCLI(scope: 'global' | 'project'): boolean {
  const scopeFlag = scope === 'global' ? '--global' : '--project';
  const result = spawnSync(
    'claude',
    ['mcp', 'add', scopeFlag, 'stellar-memory', '--', 'npx', '-y', 'stellar-memory'],
    {
      stdio: 'inherit',
      shell: true,
    }
  );
  return result.status === 0;
}

async function configureClaude(args: string[]): Promise<boolean> {
  log('');
  log('Configuring Claude MCP server...');

  let scope: 'global' | 'project';

  if (args.includes('--project')) {
    scope = 'project';
  } else if (args.includes('--global')) {
    scope = 'global';
  } else if (!process.stdin.isTTY) {
    scope = 'global';
    log(`  ${CYAN}Defaulting to global MCP registration (non-interactive mode)${RESET}`);
  } else {
    log('');
    log('  Where should Stellar Memory be registered?');
    log(`  ${CYAN}[1]${RESET} Global -- available in all Claude Code projects ${BOLD}(recommended)${RESET}`);
    log(`  ${CYAN}[2]${RESET} Project -- only this directory (.mcp.json)`);
    log('');
    const answer = await prompt('  Enter 1 or 2 [1]: ');
    scope = answer === '2' ? 'project' : 'global';
  }

  if (checkClaudeCLI()) {
    if (configureMCPViaCLI(scope)) {
      success(`MCP server registered with Claude (${scope})`);
      return true;
    }
    warn('claude CLI registration failed -- falling back to direct config edit');
  }

  return scope === 'project' ? configureMCPProject() : configureMCPGlobal();
}

function configureCodex(): boolean {
  const codexDir = join(homedir(), '.codex');
  const configPath = join(codexDir, 'config.toml');
  const blockHeader = '[mcp_servers."stellar-memory"]';

  if (!existsSync(codexDir)) {
    mkdirSync(codexDir, { recursive: true });
  }

  let existing = '';
  if (existsSync(configPath)) {
    try {
      existing = readFileSync(configPath, 'utf-8');
    } catch {
      warn('config.toml exists but is unreadable -- overwriting stellar-memory section only');
    }
  }

  const alreadyConfigured = /^\[mcp_servers\.(?:"stellar-memory"|'stellar-memory'|stellar-memory)\]\s*$/m.test(existing);
  if (alreadyConfigured) {
    success('MCP already registered in ~/.codex/config.toml');
    return true;
  }

  const block = [
    blockHeader,
    'command = "npx"',
    'args = ["-y", "stellar-memory"]',
  ].join('\n');

  const prefix = existing.trim().length === 0 ? '' : `${existing.replace(/\s*$/, '')}\n\n`;
  writeFileSync(configPath, `${prefix}${block}\n`);
  success('MCP registered globally (~/.codex/config.toml)');
  log(`  ${CYAN}Scope:${RESET} all Codex sessions`);
  return true;
}

function buildCodexAgentsSection(): string {
  return [
    CODEX_AGENTS_MARKER,
    '',
    'For Codex sessions in this workspace, use Stellar Memory as the default memory system.',
    '',
    '- At the start of each session, read `stellar://sun`. If that is unavailable, call `status`.',
    '- Before making assumptions on a topic, call `recall` with the feature, bug, file, or subsystem name.',
    '- When a durable decision, fix, error, milestone, or workflow insight appears, store it with `remember`.',
    '- Before ending a task or conversation, call `commit` with `current_work`, `decisions`, `next_steps`, and `errors`.',
    '- After a long exchange with many new details, consider `observe` to extract additional memories.',
  ].join('\n');
}

function installCodexAgentsGuidance(): boolean {
  const agentsPath = join(process.cwd(), 'AGENTS.md');
  const section = buildCodexAgentsSection();

  if (existsSync(agentsPath)) {
    const existing = readFileSync(agentsPath, 'utf-8');
    if (existing.includes(CODEX_AGENTS_MARKER)) {
      success('Codex workspace guidance already present in AGENTS.md');
      return true;
    }

    const trimmed = existing.replace(/\s*$/, '');
    writeFileSync(agentsPath, `${trimmed}\n\n${section}\n`);
    success('Codex workspace guidance appended to AGENTS.md');
    return true;
  }

  writeFileSync(agentsPath, `# AGENTS.md\n\n${section}\n`);
  success('AGENTS.md created with Codex workspace guidance');
  return true;
}

async function downloadModel(): Promise<boolean> {
  log('');
  log('Downloading embedding model (~90 MB, one-time)...');

  const candidates = [
    resolve(ROOT, 'scripts', 'setup.mjs'),
    resolve(ROOT, '..', 'scripts', 'setup.mjs'),
  ];

  const scriptPath = candidates.find((candidate) => existsSync(candidate));

  if (!scriptPath) {
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
      process.stdout.write(`\r${' '.repeat(40)}\r`);
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
  }

  warn('Model download failed -- you can retry: npm run setup');
  return false;
}

async function main(): Promise<void> {
  log('');
  log(`${BOLD}${CYAN}  Stellar Memory -- Setup${RESET}`);
  log(`  ${'-'.repeat(40)}`);
  log('');

  if (!checkNodeVersion()) {
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const skipModel = args.includes('--skip-model');
  const hasExplicitTarget = args.some((a) =>
    a.startsWith('--client=') || a === '--claude' || a === '--desktop' || a === '--codex'
  );
  let clientTarget = parseClientTarget(args);

  // Interactive client selection when no explicit target given
  if (!hasExplicitTarget && process.stdin.isTTY) {
    log('  Which client do you use?');
    log(`  ${CYAN}[1]${RESET} Claude Code ${BOLD}(recommended for developers)${RESET}`);
    log(`  ${CYAN}[2]${RESET} Claude Desktop ${BOLD}(recommended for everyone)${RESET}`);
    log(`  ${CYAN}[3]${RESET} Codex`);
    log(`  ${CYAN}[4]${RESET} All of the above`);
    log('');
    const answer = await prompt('  Enter 1-4 [2]: ');
    if (answer === '1') clientTarget = 'claude';
    else if (answer === '3') clientTarget = 'codex';
    else if (answer === '4') clientTarget = 'all';
    else clientTarget = 'desktop';
    log('');
  }

  if (!skipModel) {
    await downloadModel();
  } else {
    warn('Skipping model download (--skip-model)');
  }

  const wantsClaude = clientTarget === 'claude' || clientTarget === 'both' || clientTarget === 'all';
  const wantsDesktop = clientTarget === 'desktop' || clientTarget === 'all';
  const wantsCodex = clientTarget === 'codex' || clientTarget === 'both' || clientTarget === 'all';

  if (wantsClaude) {
    await configureClaude(args);

    const { installHooks } = await import('./hooks/install.js');
    installHooks();
  }

  if (wantsDesktop) {
    log('');
    log('Configuring Claude Desktop...');
    configureClaudeDesktop();
  }

  if (wantsCodex) {
    log('');
    log('Configuring Codex MCP server...');
    configureCodex();
    installCodexAgentsGuidance();
  }

  log('');
  log(`${BOLD}${GREEN}  Setup complete!${RESET}`);
  log('');

  if (clientTarget === 'claude') {
    log('  Stellar Memory will activate automatically in Claude Code.');
    log('  Start a conversation and your memories will persist across sessions.');
  } else if (clientTarget === 'desktop') {
    log('  Stellar Memory is registered in Claude Desktop.');
    log('  Restart Claude Desktop and your memories will persist across conversations.');
  } else if (clientTarget === 'codex') {
    log('  Stellar Memory is registered in Codex as an MCP server.');
    log('  Codex workspace guidance was installed in AGENTS.md for automatic recall and commit behavior.');
  } else {
    const targets = [wantsClaude && 'Claude Code', wantsDesktop && 'Claude Desktop', wantsCodex && 'Codex'].filter(Boolean).join(', ');
    log(`  Stellar Memory is registered for ${targets}.`);
    if (wantsDesktop) log('  Restart Claude Desktop to activate.');
  }

  log('');
  log(`  ${CYAN}Dashboard:${RESET}  npx stellar-memory api   -- http://localhost:21547`);
  log(`  ${CYAN}Docs:${RESET}       https://stellar-memory.com`);
  log('');
}

main().catch((err) => {
  fail(`Setup failed: ${err.message}`);
  process.exit(1);
});
