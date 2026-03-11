import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedContent } from '../types.js';
import type { MemoryType } from '../../engine/types.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;         // ISO 8601
  message: string;      // subject only
  body: string;         // full message (subject + body)
  changedFiles: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGitRepo(dirPath: string): boolean {
  return existsSync(join(dirPath, '.git'));
}

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Git log parsing
// ---------------------------------------------------------------------------

const GIT_SEP = '|GIT_SEP|';

/**
 * Parse `git log` output using a custom separator format.
 * Format per commit: hash|shortHash|author|date|subject
 */
function parseGitLog(raw: string): Pick<GitCommit, 'hash' | 'shortHash' | 'author' | 'date' | 'message'>[] {
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(GIT_SEP);
      if (parts.length < 5) return null;
      const [hash, shortHash, author, date, ...msgParts] = parts;
      return {
        hash:      (hash ?? '').trim(),
        shortHash: (shortHash ?? '').trim(),
        author:    (author ?? '').trim(),
        date:      (date ?? '').trim(),
        message:   msgParts.join(GIT_SEP).trim(),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.hash.length > 0);
}

/**
 * Fetch the list of files changed in a specific commit.
 */
function getChangedFiles(cwd: string, hash: string): string[] {
  const raw = safeExec(`git diff-tree --no-commit-id -r --name-only ${hash}`, cwd);
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract recent git commits from a repository at `repoPath`.
 * `limit` caps the number of commits to avoid huge imports.
 */
function getRecentCommits(repoPath: string, limit = 50): GitCommit[] {
  if (!isGitRepo(repoPath)) return [];

  const format = `--pretty=format:%H${GIT_SEP}%h${GIT_SEP}%an${GIT_SEP}%aI${GIT_SEP}%s`;
  const raw    = safeExec(`git log ${format} -n ${limit}`, repoPath);
  if (!raw.trim()) return [];

  const parsed = parseGitLog(raw);

  return parsed.map((c) => {
    const changedFiles = getChangedFiles(repoPath, c.hash);
    const bodyRaw      = safeExec(`git show -s --format=%b ${c.hash}`, repoPath).trim();
    return {
      ...c,
      body: bodyRaw ? `${c.message}\n\n${bodyRaw}` : c.message,
      changedFiles,
    };
  });
}

// ---------------------------------------------------------------------------
// Convert commits → ParsedContent
// ---------------------------------------------------------------------------

/**
 * Infer memory type from commit message keywords.
 * Conventional Commits conventions: feat, fix, chore, refactor, docs, test, etc.
 */
function inferCommitType(message: string): MemoryType {
  const lower = message.toLowerCase();
  // BREAKING CHANGE takes priority (feat!: is a breaking change → decision)
  if (lower.includes('breaking') || /\w+!:/.test(lower))                                return 'decision';
  if (/^feat[(!:]/.test(lower) || lower.includes('add') || lower.includes('implement')) return 'milestone';
  if (/^fix[(!:]/.test(lower)  || lower.includes('bug') || lower.includes('error'))     return 'error';
  if (/^(refactor|chore|build|ci)[(!:]/.test(lower))                                    return 'decision';
  if (/^(docs|test)[(!:]/.test(lower))                                                  return 'observation';
  return 'milestone';
}

/**
 * Build tags from commit author, date (year-month), and changed paths.
 */
function buildCommitTags(commit: GitCommit): string[] {
  const tags = ['git', 'commit'];

  // Author name → sanitised tag
  const authorTag = commit.author.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (authorTag) tags.push(authorTag);

  // Top-level directories from changed files
  const dirs = new Set<string>();
  for (const f of commit.changedFiles.slice(0, 20)) {
    const seg = f.split('/')[0];
    if (seg && !seg.includes('.')) dirs.add(seg.toLowerCase());
  }
  for (const d of dirs) tags.push(d);

  return [...new Set(tags)];
}

/**
 * Convert a single GitCommit into ParsedContent suitable for memory insertion.
 */
export function commitToMemory(commit: GitCommit, repoPath: string): ParsedContent {
  const type = inferCommitType(commit.message);
  const tags  = buildCommitTags(commit);

  const filesLine = commit.changedFiles.length > 0
    ? `\nChanged files (${commit.changedFiles.length}): ${commit.changedFiles.slice(0, 10).join(', ')}${commit.changedFiles.length > 10 ? ', ...' : ''}`
    : '';

  const content = [
    `Commit: ${commit.shortHash} — ${commit.message}`,
    `Author: ${commit.author} | Date: ${commit.date}`,
    filesLine,
    commit.body !== commit.message ? `\n${commit.body}` : '',
    `\nRepository: ${repoPath}`,
  ].filter(Boolean).join('\n');

  return {
    title:   `[git] ${commit.message.slice(0, 80)}`,
    summary: commit.message.slice(0, 160),
    content,
    type,
    tags,
    metadata: {
      gitHash:      commit.hash,
      shortHash:    commit.shortHash,
      author:       commit.author,
      date:         commit.date,
      changedFiles: commit.changedFiles,
      repoPath,
    },
  };
}

/**
 * Convenience: pull recent commits from `repoPath` and convert them all.
 */
export function scanGitHistory(repoPath: string, limit = 50): ParsedContent[] {
  const commits = getRecentCommits(repoPath, limit);
  return commits.map((c) => commitToMemory(c, repoPath));
}
