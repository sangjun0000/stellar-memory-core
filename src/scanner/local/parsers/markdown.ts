import { basename, extname } from 'node:path';
import type { FileParser, ParsedContent } from '../../types.js';
import type { MemoryType } from '../../../engine/types.js';

/**
 * Minimal YAML frontmatter parser.
 * Handles the common subset: key: value pairs (strings, numbers, booleans, arrays).
 * Does not depend on any external yaml library.
 */
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = FM_RE.exec(raw.trimStart());
  if (!match) return { meta: {}, body: raw };

  const yamlBlock = match[1];
  const body = match[2] ?? '';
  const meta: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, val] = kv;
    const trimmed = val.trim();

    if (trimmed === 'true') {
      meta[key] = true;
    } else if (trimmed === 'false') {
      meta[key] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      meta[key] = Number(trimmed);
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      // Simple inline array: [a, b, c]
      meta[key] = trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      meta[key] = trimmed.replace(/^["']|["']$/g, '');
    }
  }

  return { meta, body };
}

/** Extract the first ATX heading (# Title) or use filename. */
function extractTitle(body: string, filePath: string): string {
  const headingMatch = /^#{1,3}\s+(.+)$/m.exec(body);
  if (headingMatch) return headingMatch[1].trim();
  return basename(filePath, extname(filePath));
}

/** Build a short summary from the first non-heading paragraph (max 160 chars). */
function extractSummary(body: string, title: string): string {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('---'));

  const first = lines.find((l) => l.length > 10) ?? title;
  return first.length > 160 ? first.slice(0, 157) + '...' : first;
}

/** Infer MemoryType from frontmatter or file name. */
function inferType(meta: Record<string, unknown>, filePath: string): MemoryType {
  const typeVal = (meta['type'] as string | undefined)?.toLowerCase();
  const validTypes: MemoryType[] = ['decision', 'observation', 'task', 'context', 'error', 'milestone'];
  if (typeVal && (validTypes as string[]).includes(typeVal)) return typeVal as MemoryType;

  const lower = filePath.toLowerCase();
  if (lower.includes('adr') || lower.includes('decision')) return 'decision';
  if (lower.includes('todo') || lower.includes('task'))     return 'task';
  if (lower.includes('error') || lower.includes('bug'))     return 'error';
  if (lower.includes('changelog') || lower.includes('release')) return 'milestone';
  return 'context';
}

/** Derive tags from frontmatter, file extension, and path segments. */
function buildTags(meta: Record<string, unknown>, filePath: string): string[] {
  const tags: string[] = ['markdown'];

  const fmTags = meta['tags'] ?? meta['keywords'];
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === 'string' && t.trim()) tags.push(t.trim().toLowerCase());
    }
  }

  // Add directory-level context as tags (skip generic names)
  const parts = filePath.replace(/\\/g, '/').split('/');
  const interesting = parts.slice(-4, -1);
  for (const part of interesting) {
    if (part && part !== '.' && !part.includes(':')) {
      tags.push(part.toLowerCase());
    }
  }

  return [...new Set(tags)];
}

// ---------------------------------------------------------------------------

export const markdownParser: FileParser = {
  extensions: ['.md', '.mdx'],

  parse(filePath: string, rawContent: string): ParsedContent {
    const { meta, body } = parseFrontmatter(rawContent);
    const title   = (meta['title'] as string | undefined) ?? extractTitle(body, filePath);
    const summary = (meta['summary'] as string | undefined) ?? (meta['description'] as string | undefined) ?? extractSummary(body, title);
    const type    = inferType(meta, filePath);
    const tags    = buildTags(meta, filePath);

    return {
      title,
      summary,
      content: rawContent,
      type,
      tags,
      metadata: {
        ...meta,
        filePath,
        wordCount: body.split(/\s+/).filter(Boolean).length,
      },
    };
  },
};
