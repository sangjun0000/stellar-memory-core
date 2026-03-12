#!/usr/bin/env node
/**
 * hook-stop — Lightweight stop hook (runs after each Claude response).
 *
 * Only appends Claude's response to a buffer file. No database, no embeddings,
 * no processing. The MCP server's periodic timer handles the heavy lifting
 * in-process (model already loaded, DB already open).
 *
 * Usage (in Claude Code hooks):
 *   Stop → "npx stellar-memory hook-stop"
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BUFFER_PATH = join(homedir(), '.stellar-memory', 'hook-buffer.txt');
const MIN_LENGTH = 50;

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf-8').trim();

  if (text.length < MIN_LENGTH) {
    process.exit(0);
  }

  const dir = join(homedir(), '.stellar-memory');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  appendFileSync(BUFFER_PATH, text + '\n---\n');
}

main().catch(() => {}).finally(() => process.exit(0));
