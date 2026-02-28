/**
 * tests/logger.test.ts — Verify structured JSON logging to stderr.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StellarLogger, createLogger, LogLevel } from '../src/utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);

  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') lines.push(chunk.trimEnd());
    return true;
  });

  return {
    lines,
    restore: () => {
      spy.mockRestore();
      void original; // keep reference
    },
  };
}

function parseLastLine(lines: string[]): Record<string, unknown> {
  const last = lines.at(-1);
  if (!last) throw new Error('No log lines captured');
  return JSON.parse(last) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StellarLogger', () => {
  let capture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    capture = captureStderr();
  });

  afterEach(() => {
    capture.restore();
  });

  it('writes a JSON line to stderr', () => {
    const log = new StellarLogger('test');
    log.info('hello world');
    expect(capture.lines.length).toBeGreaterThan(0);
    const entry = parseLastLine(capture.lines);
    expect(entry['msg']).toBe('hello world');
  });

  it('sets level field correctly', () => {
    const log = new StellarLogger('test');
    log.warn('something fishy');
    const entry = parseLastLine(capture.lines);
    expect(entry['level']).toBe('warn');
  });

  it('sets component field', () => {
    const log = new StellarLogger('my-component');
    log.info('test');
    const entry = parseLastLine(capture.lines);
    expect(entry['component']).toBe('my-component');
  });

  it('includes ts field as ISO string', () => {
    const log = new StellarLogger('test');
    log.info('timing test');
    const entry = parseLastLine(capture.lines);
    expect(typeof entry['ts']).toBe('string');
    expect(() => new Date(entry['ts'] as string)).not.toThrow();
  });

  it('merges context object into log entry', () => {
    const log = new StellarLogger('test');
    log.info('with context', { userId: 'u-123', count: 42 });
    const entry = parseLastLine(capture.lines);
    expect(entry['userId']).toBe('u-123');
    expect(entry['count']).toBe(42);
  });

  it('includes err field when error is passed', () => {
    const log = new StellarLogger('test', LogLevel.DEBUG);
    log.error('something broke', new Error('boom'));
    const entry = parseLastLine(capture.lines);
    expect(entry['err']).toBeDefined();
    const err = entry['err'] as Record<string, string>;
    expect(err['message']).toBe('boom');
  });

  it('suppresses messages below minLevel', () => {
    const log = new StellarLogger('test', LogLevel.ERROR);
    log.debug('shh');
    log.info('also shh');
    log.warn('still shh');
    expect(capture.lines.length).toBe(0);
    log.error('this should appear');
    expect(capture.lines.length).toBe(1);
  });

  it('debug level emits all messages', () => {
    const log = new StellarLogger('test', LogLevel.DEBUG);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(capture.lines.length).toBe(4);
  });
});

describe('createLogger()', () => {
  it('returns a Logger instance with correct component', () => {
    const capture = captureStderr();
    try {
      const log = createLogger('scheduler');
      log.info('scheduler started');
      const entry = parseLastLine(capture.lines);
      expect(entry['component']).toBe('scheduler');
    } finally {
      capture.restore();
    }
  });
});
