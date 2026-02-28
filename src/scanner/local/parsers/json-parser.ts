import { basename, extname } from 'node:path';
import type { FileParser, ParsedContent } from '../../types.js';
import type { MemoryType } from '../../../engine/types.js';

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** Special handling for package.json — extract rich project metadata. */
function parsePackageJson(pkg: PackageJson, filePath: string): ParsedContent {
  const name = pkg.name ?? basename(filePath, '.json');
  const deps    = Object.keys(pkg.dependencies     ?? {});
  const devDeps = Object.keys(pkg.devDependencies  ?? {});
  const scripts = Object.keys(pkg.scripts          ?? {});

  const summary = pkg.description
    ? `${name}: ${pkg.description}`.slice(0, 160)
    : `package.json for ${name}`;

  const content = [
    `Package: ${name} v${pkg.version ?? 'unknown'}`,
    pkg.description ? `Description: ${pkg.description}` : '',
    deps.length > 0   ? `Dependencies: ${deps.slice(0, 10).join(', ')}` : '',
    devDeps.length > 0 ? `DevDependencies: ${devDeps.slice(0, 10).join(', ')}` : '',
    scripts.length > 0 ? `Scripts: ${scripts.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const tags = ['package.json', 'project-meta', ...(pkg.keywords ?? []).slice(0, 5)];

  return {
    title: `${name} package.json`,
    summary,
    content,
    type: 'context',
    tags,
    metadata: { filePath, name, version: pkg.version, depCount: deps.length + devDeps.length },
  };
}

function inferType(filePath: string): MemoryType {
  const lower = filePath.toLowerCase();
  if (lower.includes('package.json')) return 'context';
  if (lower.includes('config'))       return 'context';
  if (lower.includes('schema'))       return 'decision';
  return 'observation';
}

function buildTags(filePath: string, ext: string): string[] {
  const tags = [ext === '.jsonl' ? 'jsonl' : 'json'];
  const parts = filePath.replace(/\\/g, '/').split('/');
  const interesting = parts.slice(-4, -1);
  for (const part of interesting) {
    if (part && part !== '.' && !part.includes(':')) tags.push(part.toLowerCase());
  }
  const name = basename(filePath, ext);
  tags.push(name.toLowerCase());
  return [...new Set(tags)];
}

/** Summarise first line of JSONL (newline-delimited JSON). */
function summariseJsonl(content: string, filePath: string): ParsedContent {
  const title = basename(filePath, '.jsonl');
  const lines  = content.split('\n').filter((l) => l.trim());
  const sample = lines[0] ?? '';
  let parsedSample: unknown;
  try { parsedSample = JSON.parse(sample); } catch { parsedSample = null; }

  const summary = `JSONL file with ${lines.length} record${lines.length === 1 ? '' : 's'}`;

  return {
    title,
    summary,
    content: content.slice(0, 2000),
    type: 'observation',
    tags: buildTags(filePath, '.jsonl'),
    metadata: { filePath, lineCount: lines.length, sampleKeys: parsedSample && typeof parsedSample === 'object' ? Object.keys(parsedSample as object) : [] },
  };
}

export const jsonParser: FileParser = {
  extensions: ['.json', '.jsonl'],

  parse(filePath: string, content: string): ParsedContent {
    const ext = extname(filePath).toLowerCase();

    if (ext === '.jsonl') return summariseJsonl(content, filePath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Malformed JSON — treat as plain text observation
      const title = basename(filePath, ext);
      return {
        title,
        summary: `Malformed JSON file: ${title}`,
        content: content.slice(0, 2000),
        type: 'observation',
        tags: buildTags(filePath, ext),
        metadata: { filePath, parseError: true },
      };
    }

    // Special case: package.json
    if (basename(filePath) === 'package.json' && parsed && typeof parsed === 'object') {
      return parsePackageJson(parsed as PackageJson, filePath);
    }

    const title = basename(filePath, ext);
    const keys  = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed as object)
      : [];
    const summary = keys.length > 0
      ? `JSON object with keys: ${keys.slice(0, 8).join(', ')}`
      : Array.isArray(parsed)
        ? `JSON array with ${(parsed as unknown[]).length} items`
        : `JSON value in ${title}`;

    return {
      title,
      summary,
      content: content.slice(0, 4000),
      type: inferType(filePath),
      tags: buildTags(filePath, ext),
      metadata: { filePath, topLevelKeys: keys },
    };
  },
};
