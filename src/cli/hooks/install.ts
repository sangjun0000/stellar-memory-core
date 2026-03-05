#!/usr/bin/env node
/**
 * hook-install — Installs Claude Code hooks for automatic memory.
 *
 * Adds SessionStart and Stop hooks to ~/.claude/settings.json.
 * Preserves any existing non-stellar hooks.
 *
 * Called automatically by `npx stellar-memory init`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface Settings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

const STELLAR_HOOKS: Record<string, HookEntry> = {
  SessionStart: {
    type: 'command',
    command: 'npx -y stellar-memory hook-restore',
  },
  Stop: {
    type: 'command',
    command: 'npx -y stellar-memory hook-stop',
  },
};

function isStellarHook(hook: HookEntry): boolean {
  return hook.command?.includes('stellar-memory') ?? false;
}

export function installHooks(): boolean {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Load existing settings
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      // Corrupt settings — start fresh but warn
      console.log(`${YELLOW}!${RESET} Existing settings.json was unreadable, creating new one`);
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let changed = false;

  for (const [event, hookEntry] of Object.entries(STELLAR_HOOKS)) {
    const existing = settings.hooks[event] ?? [];

    // Check if stellar hook already exists
    const hasStellar = existing.some(matcher =>
      matcher.hooks?.some(h => isStellarHook(h))
    );

    if (hasStellar) {
      continue;  // Already installed
    }

    // Add stellar hook
    existing.push({
      matcher: '',
      hooks: [hookEntry],
    });

    settings.hooks[event] = existing;
    changed = true;
  }

  if (changed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`${GREEN}\u2713${RESET} Claude Code hooks installed`);
    console.log(`  ${CYAN}SessionStart${RESET} \u2192 auto-restore context from memory`);
    console.log(`  ${CYAN}Stop${RESET} \u2192 auto-extract & commit memories`);
    return true;
  } else {
    console.log(`${GREEN}\u2713${RESET} Claude Code hooks already installed`);
    return false;
  }
}

// Run directly
if (process.argv[1]?.includes('install')) {
  installHooks();
}
