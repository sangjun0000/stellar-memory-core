import type { FileParser } from '../../types.js';
import { markdownParser } from './markdown.js';
import { textParser }     from './text.js';
import { codeParser }     from './code.js';
import { jsonParser }     from './json-parser.js';

// ---------------------------------------------------------------------------
// Parser registry — maps lowercase file extension to the responsible parser
// ---------------------------------------------------------------------------

const _parsers: FileParser[] = [markdownParser, textParser, codeParser, jsonParser];

const _registry = new Map<string, FileParser>();
for (const parser of _parsers) {
  for (const ext of parser.extensions) {
    _registry.set(ext.toLowerCase(), parser);
  }
}

/** Return the parser registered for `ext` (e.g. ".md"), or null if unsupported. */
export function getParser(ext: string): FileParser | null {
  return _registry.get(ext.toLowerCase()) ?? null;
}

/** All supported extensions (with leading dot). */
export function supportedExtensions(): string[] {
  return [..._registry.keys()];
}

export { markdownParser, textParser, codeParser, jsonParser };
