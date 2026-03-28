#!/usr/bin/env node
/**
 * init.mjs — First-install setup wizard for Stellar Memory.
 *
 * Run with:  npm run init
 *
 * What this does (in order):
 *   1. Checks Node.js version (requires 22+)
 *   2. Checks if the database already exists
 *   3. Downloads the BGE-M3 embedding model if needed (~540 MB)
 *   4. Prints MCP config and OpenWebUI instructions
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Welcome banner ──────────────────────────────────────────────────────────

console.log('Stellar Memory — Setup');
console.log('======================');
console.log('');

// ─── 1. Node.js version check ────────────────────────────────────────────────

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`ERROR: Node.js 22+ is required. You are running v${process.versions.node}.`);
  console.error('');
  console.error('Please upgrade Node.js:  https://nodejs.org');
  process.exit(1);
}

// ─── 2. Check if DB already exists ───────────────────────────────────────────

const dbPath = process.env['STELLAR_DB_PATH']
  ?? join(homedir(), '.stellar-memory', 'stellar.db');

const dbExists = existsSync(dbPath);

if (dbExists) {
  console.log('Database already exists — skipping model download');
  console.log('');
} else {
  // ─── 3. Download embedding model ───────────────────────────────────────────
  console.log('Downloading BGE-M3 embedding model (~540 MB)...');
  console.log('');

  // Delegate entirely to setup.mjs which has full progress reporting
  const setupPath = new URL('./setup.mjs', import.meta.url).pathname;
  const { default: childProcess } = await import('node:child_process');

  await new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [setupPath], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`setup.mjs exited with code ${code}`));
    });
    child.on('error', reject);
  });

  console.log('');
}

// ─── 4. MCP config instructions ──────────────────────────────────────────────

console.log('Add to your MCP config (claude_desktop_config.json or .mcp.json):');
console.log('');
console.log(JSON.stringify({
  mcpServers: {
    'stellar-memory': {
      command: 'npx',
      args: ['-y', 'stellar-memory'],
    },
  },
}, null, 2));
console.log('');

// ─── 5. OpenWebUI instructions ────────────────────────────────────────────────

console.log('OpenWebUI users:');
console.log('  1. Start the API:  npx stellar-memory api');
console.log('  2. In OpenWebUI -> Admin -> Pipelines -> upload stellar_memory_pipeline.py');
console.log('     (download from: https://github.com/sangjun0000/stellar-memory-core/blob/main/plugins/openwebui/stellar_memory_pipeline.py)');
console.log('  3. Set STM_URL to: http://localhost:21547');
console.log('');

// ─── Done ─────────────────────────────────────────────────────────────────────

console.log('Setup complete! Stellar Memory is ready.');
