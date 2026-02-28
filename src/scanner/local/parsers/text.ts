import { basename, extname } from 'node:path';
import type { FileParser, ParsedContent } from '../../types.js';
import type { MemoryType } from '../../../engine/types.js';

function inferType(filePath: string): MemoryType {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.log') || lower.includes('error') || lower.includes('crash')) return 'error';
  return 'observation';
}

function buildTags(filePath: string, ext: string): string[] {
  const tags = [ext.replace('.', '') || 'text'];
  const parts = filePath.replace(/\\/g, '/').split('/');
  const interesting = parts.slice(-4, -1);
  for (const part of interesting) {
    if (part && part !== '.' && !part.includes(':')) {
      tags.push(part.toLowerCase());
    }
  }
  return [...new Set(tags)];
}

export const textParser: FileParser = {
  extensions: ['.txt', '.log'],

  parse(filePath: string, content: string): ParsedContent {
    const ext   = extname(filePath).toLowerCase();
    const title = basename(filePath, ext);

    // Use first non-empty line as summary (max 160 chars)
    const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? title;
    const summary   = firstLine.length > 160 ? firstLine.slice(0, 157) + '...' : firstLine;

    return {
      title,
      summary,
      content,
      type: inferType(filePath),
      tags: buildTags(filePath, ext),
      metadata: {
        filePath,
        lineCount: content.split('\n').length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      },
    };
  },
};
