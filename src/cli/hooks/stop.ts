#!/usr/bin/env node
/**
 * hook-stop — Stop hook handler (runs after each Claude response).
 *
 * 1. Reads Claude's last response from stdin
 * 2. Appends it to a buffer file
 * 3. When buffer is large enough or enough time has passed:
 *    a. Runs processConversation() to auto-extract memories
 *    b. Runs autoCommitOnClose('periodic') to auto-update sun state
 * 4. Outputs nothing to stdout (zero token cost)
 *
 * Usage (in Claude Code hooks):
 *   Stop → "npx stellar-memory hook-stop"
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { initDatabase } from '../../storage/database.js';
import { getConfig } from '../../utils/config.js';
import { autoCommitOnClose } from '../../engine/sun.js';
import { processConversation } from '../../engine/observation.js';

const STM_DIR = join(homedir(), '.stellar-memory');
const BUFFER_PATH = join(STM_DIR, 'hook-buffer.txt');
const LAST_OBSERVE_PATH = join(STM_DIR, 'last-observe');
const LAST_COMMIT_PATH = join(STM_DIR, 'last-commit');

const OBSERVE_BUFFER_THRESHOLD = 2000;  // bytes
const OBSERVE_TIME_THRESHOLD = 5 * 60 * 1000;  // 5 minutes
const COMMIT_TIME_THRESHOLD = 5 * 60 * 1000;  // 5 minutes (aligned with observe)
const MIN_INPUT_LENGTH = 50;  // ignore trivial responses

function readTimestamp(path: string): number {
  try {
    return parseInt(readFileSync(path, 'utf-8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function writeTimestamp(path: string): void {
  writeFileSync(path, String(Date.now()));
}

async function main(): Promise<void> {
  // Read stdin (Claude's last response)
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const stdinText = Buffer.concat(chunks).toString('utf-8').trim();

  // Skip trivial responses
  if (stdinText.length < MIN_INPUT_LENGTH) {
    process.exit(0);
  }

  // Ensure directory exists
  if (!existsSync(STM_DIR)) {
    mkdirSync(STM_DIR, { recursive: true });
  }

  // Append to buffer
  appendFileSync(BUFFER_PATH, stdinText + '\n---\n');

  // Check thresholds
  const now = Date.now();
  const bufferSize = existsSync(BUFFER_PATH) ? statSync(BUFFER_PATH).size : 0;
  const lastObserve = readTimestamp(LAST_OBSERVE_PATH);
  const lastCommit = readTimestamp(LAST_COMMIT_PATH);

  const shouldObserve = bufferSize > OBSERVE_BUFFER_THRESHOLD || (now - lastObserve > OBSERVE_TIME_THRESHOLD);
  const shouldCommit = (now - lastCommit > COMMIT_TIME_THRESHOLD) && bufferSize > 500;

  if (!shouldObserve && !shouldCommit) {
    process.exit(0);
  }

  // Initialize DB only when we actually need to do work
  const config = getConfig();
  initDatabase(config.dbPath);
  const project = config.defaultProject;

  if (shouldObserve) {
    try {
      const buffer = readFileSync(BUFFER_PATH, 'utf-8');
      await processConversation(buffer, project);
      writeTimestamp(LAST_OBSERVE_PATH);
      // Trim buffer to last 500 chars (keep some context for commit)
      const trimmed = buffer.slice(-500);
      writeFileSync(BUFFER_PATH, trimmed);
    } catch (err) {
      process.stderr.write(
        `[stellar-memory] hook-stop observe failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  if (shouldCommit) {
    try {
      autoCommitOnClose(project, 'periodic');
      writeTimestamp(LAST_COMMIT_PATH);
    } catch (err) {
      process.stderr.write(
        `[stellar-memory] hook-stop commit failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(
    `[stellar-memory] hook-stop failed: ${err instanceof Error ? err.message : String(err)}\n`
  );
}).finally(() => {
  // stdout stays empty — zero token cost
  process.exit(0);
});
