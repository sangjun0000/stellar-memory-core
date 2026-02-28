import { describe, it, expect } from 'vitest';
import { markdownParser } from '../src/scanner/local/parsers/markdown.js';
import { textParser }     from '../src/scanner/local/parsers/text.js';
import { codeParser }     from '../src/scanner/local/parsers/code.js';
import { jsonParser }     from '../src/scanner/local/parsers/json-parser.js';
import { getParser, supportedExtensions } from '../src/scanner/local/parsers/index.js';

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

describe('markdownParser', () => {
  it('extracts title from ATX heading', () => {
    const result = markdownParser.parse('/docs/guide.md', '# My Guide\n\nSome body text here.');
    expect(result.title).toBe('My Guide');
  });

  it('falls back to filename when no heading', () => {
    const result = markdownParser.parse('/docs/setup.md', 'Just plain text with no heading.');
    expect(result.title).toBe('setup');
  });

  it('parses frontmatter title and tags', () => {
    const content = `---
title: Architecture Decision
tags: [backend, database, postgres]
type: decision
---

We chose PostgreSQL for the production database.`;
    const result = markdownParser.parse('/adr/001.md', content);
    expect(result.title).toBe('Architecture Decision');
    expect(result.tags).toContain('backend');
    expect(result.tags).toContain('database');
    expect(result.type).toBe('decision');
  });

  it('infers decision type from ADR path', () => {
    const result = markdownParser.parse('/docs/adr/002-caching.md', '# Caching Strategy\n\nWe use Redis.');
    expect(result.type).toBe('decision');
  });

  it('infers task type from todo filename', () => {
    const result = markdownParser.parse('/notes/todo.md', '# Tasks\n\n- Fix login bug');
    expect(result.type).toBe('task');
  });

  it('builds summary from first paragraph when no frontmatter summary', () => {
    const content = '# Title\n\nThis is the first paragraph of the document.';
    const result = markdownParser.parse('/notes/doc.md', content);
    expect(result.summary).toBe('This is the first paragraph of the document.');
  });

  it('includes markdown tag', () => {
    const result = markdownParser.parse('/notes/readme.md', '# Readme\n\nContent.');
    expect(result.tags).toContain('markdown');
  });

  it('includes word count in metadata', () => {
    const result = markdownParser.parse('/notes/doc.md', '# Title\n\nOne two three four five.');
    expect(typeof result.metadata['wordCount']).toBe('number');
    expect((result.metadata['wordCount'] as number)).toBeGreaterThan(0);
  });

  it('handles empty frontmatter gracefully', () => {
    const content = `---
---
# Plain Title
Body text.`;
    const result = markdownParser.parse('/doc.md', content);
    expect(result.title).toBe('Plain Title');
  });
});

// ---------------------------------------------------------------------------
// Text parser
// ---------------------------------------------------------------------------

describe('textParser', () => {
  it('uses filename as title', () => {
    const result = textParser.parse('/logs/app.log', 'ERROR: connection refused\nline 2');
    expect(result.title).toBe('app');
  });

  it('uses first line as summary', () => {
    const result = textParser.parse('/notes/readme.txt', 'First line content.\nSecond line.');
    expect(result.summary).toBe('First line content.');
  });

  it('truncates long first line in summary', () => {
    const long = 'a'.repeat(200);
    const result = textParser.parse('/notes/long.txt', long);
    expect(result.summary.length).toBeLessThanOrEqual(163); // 157 + '...'
  });

  it('infers error type for .log files', () => {
    const result = textParser.parse('/var/app.log', 'some log content');
    expect(result.type).toBe('error');
  });

  it('includes lineCount in metadata', () => {
    const result = textParser.parse('/notes/file.txt', 'line1\nline2\nline3');
    expect(result.metadata['lineCount']).toBe(3);
  });

  it('registers .txt and .log extensions', () => {
    expect(textParser.extensions).toContain('.txt');
    expect(textParser.extensions).toContain('.log');
  });
});

// ---------------------------------------------------------------------------
// Code parser
// ---------------------------------------------------------------------------

describe('codeParser', () => {
  const tsContent = `
/**
 * Computes the orbital distance from importance score.
 */
export function importanceToDistance(importance: number): number {
  return 100 * (1 - importance);
}

export class OrbitEngine {
  compute(): void {}
}
`.trim();

  it('extracts function and class names as symbols', () => {
    const result = codeParser.parse('/src/engine/orbit.ts', tsContent);
    expect(result.metadata['symbols']).toContain('importanceToDistance');
    expect(result.metadata['symbols']).toContain('OrbitEngine');
  });

  it('tags language correctly', () => {
    const result = codeParser.parse('/src/engine/orbit.ts', tsContent);
    expect(result.tags).toContain('typescript');
    expect(result.tags).toContain('code');
  });

  it('extracts JSDoc comment as summary', () => {
    const result = codeParser.parse('/src/engine/orbit.ts', tsContent);
    expect(result.summary).toContain('orbital distance');
  });

  it('infers observation type for test files', () => {
    const result = codeParser.parse('/tests/orbit.test.ts', 'describe("orbit", () => {});');
    expect(result.type).toBe('observation');
  });

  it('infers decision type for migration files', () => {
    const result = codeParser.parse('/db/migrations/001.ts', 'export const migration = {};');
    expect(result.type).toBe('decision');
  });

  it('handles Python files', () => {
    const py = `
def compute_orbit(importance: float) -> float:
    """Compute orbital distance."""
    return 100.0 * (1 - importance)

class PlanetEngine:
    pass
`.trim();
    const result = codeParser.parse('/engine/orbit.py', py);
    expect(result.tags).toContain('python');
    expect(result.metadata['symbols']).toContain('compute_orbit');
  });

  it('includes lineCount in metadata', () => {
    const result = codeParser.parse('/src/index.ts', 'const x = 1;\nconst y = 2;');
    expect(result.metadata['lineCount']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// JSON parser
// ---------------------------------------------------------------------------

describe('jsonParser', () => {
  it('parses package.json with rich metadata', () => {
    const pkg = JSON.stringify({
      name: 'stellar-memory',
      version: '1.0.0',
      description: 'AI memory system',
      keywords: ['mcp', 'ai'],
      dependencies: { zod: '^3.0.0' },
    });
    const result = jsonParser.parse('/project/package.json', pkg);
    expect(result.title).toContain('stellar-memory');
    expect(result.tags).toContain('package.json');
    expect(result.type).toBe('context');
    expect(result.summary).toContain('AI memory system');
  });

  it('summarises a generic JSON object', () => {
    const obj = JSON.stringify({ name: 'Alice', age: 30, role: 'admin' });
    const result = jsonParser.parse('/data/user.json', obj);
    expect(result.summary).toContain('name');
    expect(result.summary).toContain('age');
  });

  it('summarises a JSON array', () => {
    const arr = JSON.stringify([1, 2, 3]);
    const result = jsonParser.parse('/data/nums.json', arr);
    expect(result.summary).toContain('3 items');
  });

  it('handles malformed JSON gracefully', () => {
    const result = jsonParser.parse('/data/bad.json', '{not: valid json}');
    expect(result.metadata['parseError']).toBe(true);
    expect(result.type).toBe('observation');
  });

  it('handles JSONL files', () => {
    const jsonl = '{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n{"id":3,"name":"c"}';
    const result = jsonParser.parse('/data/records.jsonl', jsonl);
    expect(result.summary).toContain('3 record');
    expect(result.tags).toContain('jsonl');
  });

  it('registers .json and .jsonl extensions', () => {
    expect(jsonParser.extensions).toContain('.json');
    expect(jsonParser.extensions).toContain('.jsonl');
  });
});

// ---------------------------------------------------------------------------
// Parser registry
// ---------------------------------------------------------------------------

describe('parser registry', () => {
  it('returns markdown parser for .md', () => {
    const p = getParser('.md');
    expect(p).not.toBeNull();
    expect(p?.extensions).toContain('.md');
  });

  it('returns code parser for .ts', () => {
    const p = getParser('.ts');
    expect(p).not.toBeNull();
    expect(p?.extensions).toContain('.ts');
  });

  it('returns null for unsupported extension', () => {
    expect(getParser('.docx')).toBeNull();
    expect(getParser('.pdf')).toBeNull();
  });

  it('lists all supported extensions', () => {
    const exts = supportedExtensions();
    expect(exts).toContain('.md');
    expect(exts).toContain('.ts');
    expect(exts).toContain('.json');
    expect(exts).toContain('.txt');
    expect(exts.length).toBeGreaterThan(10);
  });

  it('is case-insensitive for extension lookup', () => {
    expect(getParser('.MD')).not.toBeNull();
    expect(getParser('.TS')).not.toBeNull();
  });
});
