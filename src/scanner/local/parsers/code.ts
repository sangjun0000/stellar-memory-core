import { basename, extname } from 'node:path';
import type { FileParser, ParsedContent } from '../../types.js';
import type { MemoryType } from '../../../engine/types.js';

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
};

/** Extract top-level function / class / def names (best-effort regex, not a full AST parse). */
function extractSymbols(content: string, ext: string): string[] {
  const patterns: RegExp[] = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    patterns.push(
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?class\s+(\w+)/g,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
    );
  } else if (ext === '.py') {
    patterns.push(/^(?:async\s+)?def\s+(\w+)/gm, /^class\s+(\w+)/gm);
  } else if (ext === '.java') {
    patterns.push(/(?:public|private|protected)?\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/g, /class\s+(\w+)/g);
  } else if (ext === '.go') {
    patterns.push(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/gm);
  } else if (ext === '.rs') {
    patterns.push(/^(?:pub\s+)?fn\s+(\w+)/gm, /^(?:pub\s+)?struct\s+(\w+)/gm);
  }

  const symbols: string[] = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && !symbols.includes(m[1])) symbols.push(m[1]);
      if (symbols.length >= 20) break;
    }
  }
  return symbols;
}

/** Extract block comments and JSDoc / docstrings. */
function extractComments(content: string, ext: string): string[] {
  const comments: string[] = [];
  const BLOCK = /\/\*\*([\s\S]*?)\*\//g;
  const LINE  = /^\/\/\s*(.+)$/gm;
  const HASH  = /^#\s*(.+)$/gm;
  const DOCSTR = /"""([\s\S]*?)"""/g;

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.c', '.cpp', '.h', '.go', '.rs'].includes(ext)) {
    let m: RegExpExecArray | null;
    while ((m = BLOCK.exec(content)) !== null) {
      const text = m[1].replace(/\*\s?/g, '').trim();
      if (text && text.length > 5) comments.push(text.slice(0, 200));
      if (comments.length >= 5) break;
    }
    while ((m = LINE.exec(content)) !== null && comments.length < 5) {
      if (m[1].trim().length > 5) comments.push(m[1].trim());
    }
  } else if (['.py', '.sh', '.bash', '.zsh'].includes(ext)) {
    let m: RegExpExecArray | null;
    while ((m = DOCSTR.exec(content)) !== null) {
      const text = m[1].trim();
      if (text) comments.push(text.slice(0, 200));
      if (comments.length >= 5) break;
    }
    while ((m = HASH.exec(content)) !== null && comments.length < 5) {
      if (m[1].trim().length > 5) comments.push(m[1].trim());
    }
  }

  return comments;
}

function inferType(filePath: string): MemoryType {
  const lower = filePath.toLowerCase();
  if (lower.includes('test') || lower.includes('spec')) return 'observation';
  if (lower.includes('migration') || lower.includes('schema')) return 'decision';
  return 'context';
}

function buildTags(filePath: string, ext: string, language: string, symbols: string[]): string[] {
  const tags = ['code', language];
  const parts = filePath.replace(/\\/g, '/').split('/');
  const interesting = parts.slice(-4, -1);
  for (const part of interesting) {
    if (part && part !== '.' && !part.includes(':')) tags.push(part.toLowerCase());
  }
  // Add first few symbols as tags for searchability
  for (const sym of symbols.slice(0, 3)) tags.push(sym);
  return [...new Set(tags)];
}

export const codeParser: FileParser = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.sh', '.bash', '.zsh'],

  parse(filePath: string, content: string): ParsedContent {
    const ext      = extname(filePath).toLowerCase();
    const language = LANGUAGE_BY_EXT[ext] ?? 'code';
    const title    = basename(filePath, ext);
    const symbols  = extractSymbols(content, ext);
    const comments = extractComments(content, ext);

    const symbolSummary = symbols.length > 0 ? `Defines: ${symbols.slice(0, 5).join(', ')}` : '';
    const commentSummary = comments.length > 0 ? comments[0].slice(0, 120) : '';
    const summary = (commentSummary || symbolSummary || `${language} file: ${title}`).slice(0, 160);

    return {
      title,
      summary,
      content,
      type: inferType(filePath),
      tags: buildTags(filePath, ext, language, symbols),
      metadata: {
        filePath,
        language,
        symbols,
        lineCount: content.split('\n').length,
      },
    };
  },
};
