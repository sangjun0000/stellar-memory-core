#!/usr/bin/env node
/**
 * cleanup-garbage-memories.mjs
 *
 * One-time script to remove stop-hook-contaminated memories from the DB.
 *
 * Garbage patterns (from stop hook JSON keys leaking into memories):
 *   - tags containing: session_id, transcript_path, permission_mode, hook_event_name
 *   - content starting with '{' (raw JSON stored as memory)
 *   - tags containing 'nn' prefix artifacts (\n tokens)
 *
 * Usage:
 *   node scripts/cleanup-garbage-memories.mjs --dry-run   (preview)
 *   node scripts/cleanup-garbage-memories.mjs             (execute)
 */

import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = process.env.STELLAR_DB_PATH
  ?? join(homedir(), '.stellar-memory', 'stellar.db');

const DRY_RUN = process.argv.includes('--dry-run');

const db = new DatabaseSync(DB_PATH, { allowExtension: false });

// ── Garbage detection ────────────────────────────────────────────────────
// Strategy: be conservative — only delete things that are unambiguously garbage.
//
// Type A (json-content): content is raw Claude Code hook JSON
//   → content starts with '{' AND contains "session_id"
//
// Type B (hook-tags): tags contain BOTH "session_id" AND "transcript_path"
//   → strong signal of hook JSON tokenized into tags

function isJsonGarbage(content) {
  const trimmed = String(content ?? '').trim();
  return trimmed.startsWith('{') && trimmed.includes('"session_id"');
}

function hasHookTags(tags) {
  const tagStr = tags.join(' ').toLowerCase();
  return tagStr.includes('session_id') && tagStr.includes('transcript_path');
}

// ── Load all non-deleted memories ────────────────────────────────────────
const memories = db.prepare(`
  SELECT id, project, summary, tags, content, type, distance
  FROM memories
  WHERE deleted_at IS NULL
  ORDER BY created_at ASC
`).all();

console.log(`Total memories to scan: ${memories.length}`);

const toDelete = [];

for (const mem of memories) {
  let tags = [];
  try {
    tags = JSON.parse(mem.tags ?? '[]');
  } catch { tags = []; }

  const jsonGarbage = isJsonGarbage(mem.content);
  const hookTagGarbage = hasHookTags(tags);

  if (jsonGarbage || hookTagGarbage) {
    toDelete.push({
      id: mem.id,
      project: mem.project,
      reason: jsonGarbage ? 'json-content' : 'hook-tags',
      summary: String(mem.summary).slice(0, 60),
      distance: mem.distance,
    });
  }
}

console.log(`\nGarbage memories found: ${toDelete.length} / ${memories.length}`);
console.log(`Clean memories: ${memories.length - toDelete.length}`);

// Show sample
const sample = toDelete.slice(0, 10);
console.log(`\nSample (first 10):`)
for (const m of sample) {
  console.log(`  [${m.reason}] ${m.distance?.toFixed(1)} AU | ${m.summary}`);
}
if (toDelete.length > 10) {
  console.log(`  ... and ${toDelete.length - 10} more`);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] No changes made. Run without --dry-run to delete.');
  process.exit(0);
}

// ── Execute deletion ──────────────────────────────────────────────────────
const now = new Date().toISOString();
const stmt = db.prepare(`UPDATE memories SET deleted_at = ? WHERE id = ?`);

let deleted = 0;
for (const m of toDelete) {
  stmt.run(now, m.id);
  deleted++;
}

console.log(`\n✓ Soft-deleted ${deleted} garbage memories.`);

// Also clean up orphaned conflict records
const cleanedConflicts = db.prepare(`
  DELETE FROM memory_conflicts
  WHERE memory_id NOT IN (SELECT id FROM memories WHERE deleted_at IS NULL)
     OR conflicting_memory_id NOT IN (SELECT id FROM memories WHERE deleted_at IS NULL)
`).run();
console.log(`✓ Cleaned ${cleanedConflicts.changes} orphaned conflict records.`);

// Stats after cleanup
const remaining = db.prepare(`SELECT COUNT(*) as n FROM memories WHERE deleted_at IS NULL`).get();
const zones = db.prepare(`
  SELECT
    SUM(CASE WHEN distance < 3 THEN 1 ELSE 0 END) core,
    SUM(CASE WHEN distance >= 3 AND distance < 15 THEN 1 ELSE 0 END) near,
    SUM(CASE WHEN distance >= 15 AND distance < 60 THEN 1 ELSE 0 END) stored,
    SUM(CASE WHEN distance >= 60 THEN 1 ELSE 0 END) forgotten
  FROM memories WHERE deleted_at IS NULL
`).get();

console.log(`\nAfter cleanup:`);
console.log(`  Total: ${remaining.n}`);
console.log(`  Core: ${zones.core} | Near: ${zones.near} | Stored: ${zones.stored} | Forgotten: ${zones.forgotten}`);
