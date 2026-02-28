import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRelativeTime } from '../src/utils/time.js';

// ---------------------------------------------------------------------------
// Constants used across assertions
// ---------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS   = 60 * MINUTE_MS;
const DAY_MS    = 24 * HOUR_MS;
const WEEK_MS   = 7  * DAY_MS;

/** A fixed "now" so every test runs against a stable clock. */
const FIXED_NOW = new Date('2025-06-15T12:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// parseRelativeTime
// ---------------------------------------------------------------------------

describe('parseRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Relative time strings — core units
  // -------------------------------------------------------------------------

  describe('relative time strings', () => {
    it('parses minutes: "30m" returns 30 minutes in the past', () => {
      const result = parseRelativeTime('30m');
      expect(result.getTime()).toBe(FIXED_NOW - 30 * MINUTE_MS);
    });

    it('parses hours: "24h" returns 24 hours in the past', () => {
      const result = parseRelativeTime('24h');
      expect(result.getTime()).toBe(FIXED_NOW - 24 * HOUR_MS);
    });

    it('parses days: "7d" returns 7 days in the past', () => {
      const result = parseRelativeTime('7d');
      expect(result.getTime()).toBe(FIXED_NOW - 7 * DAY_MS);
    });

    it('parses weeks: "2w" returns 2 weeks in the past', () => {
      const result = parseRelativeTime('2w');
      expect(result.getTime()).toBe(FIXED_NOW - 2 * WEEK_MS);
    });

    it('returns a Date instance for all relative units', () => {
      for (const input of ['1m', '1h', '1d', '1w']) {
        expect(parseRelativeTime(input)).toBeInstanceOf(Date);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Case insensitivity
  // -------------------------------------------------------------------------

  describe('case insensitivity', () => {
    it('accepts uppercase unit "H": "24H" equals "24h"', () => {
      expect(parseRelativeTime('24H').getTime()).toBe(parseRelativeTime('24h').getTime());
    });

    it('accepts uppercase unit "D": "7D" equals "7d"', () => {
      expect(parseRelativeTime('7D').getTime()).toBe(parseRelativeTime('7d').getTime());
    });

    it('accepts uppercase unit "M": "30M" equals "30m"', () => {
      expect(parseRelativeTime('30M').getTime()).toBe(parseRelativeTime('30m').getTime());
    });

    it('accepts uppercase unit "W": "2W" equals "2w"', () => {
      expect(parseRelativeTime('2W').getTime()).toBe(parseRelativeTime('2w').getTime());
    });
  });

  // -------------------------------------------------------------------------
  // ISO 8601 fallback
  // -------------------------------------------------------------------------

  describe('ISO 8601 fallback', () => {
    it('parses a UTC ISO string with millisecond precision', () => {
      const result = parseRelativeTime('2025-01-01T00:00:00.000Z');
      expect(result.getTime()).toBe(new Date('2025-01-01T00:00:00.000Z').getTime());
    });

    it('parses an ISO string without milliseconds', () => {
      const result = parseRelativeTime('2025-01-01T00:00:00Z');
      expect(result.getTime()).toBe(new Date('2025-01-01T00:00:00Z').getTime());
    });

    it('parses a date-only ISO string', () => {
      const result = parseRelativeTime('2025-03-20');
      expect(result.getTime()).toBe(new Date('2025-03-20').getTime());
    });

    it('returns a Date instance for ISO input', () => {
      expect(parseRelativeTime('2025-01-01T00:00:00Z')).toBeInstanceOf(Date);
    });

    it('ISO result is unaffected by fake clock (absolute date)', () => {
      // The parsed date should match the literal timestamp, not "now minus offset".
      // Use UTC accessors so the assertion is timezone-independent.
      const result = parseRelativeTime('2024-12-31T23:59:59Z');
      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(11); // December (0-indexed)
      expect(result.getUTCDate()).toBe(31);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid inputs — error cases
  // -------------------------------------------------------------------------

  describe('invalid inputs', () => {
    it('throws for a bare alphabetic string "abc"', () => {
      expect(() => parseRelativeTime('abc')).toThrow();
    });

    it('throws for reversed format "h24" (unit before number)', () => {
      expect(() => parseRelativeTime('h24')).toThrow();
    });

    it('throws for an empty string ""', () => {
      expect(() => parseRelativeTime('')).toThrow();
    });

    it('throws for a number with no unit "24"', () => {
      expect(() => parseRelativeTime('24')).toThrow();
    });

    it('throws for an unsupported unit "30s" (seconds not supported)', () => {
      expect(() => parseRelativeTime('30s')).toThrow();
    });

    it('throws for a whitespace-only string " "', () => {
      expect(() => parseRelativeTime(' ')).toThrow();
    });

    it('error message mentions the invalid input', () => {
      expect(() => parseRelativeTime('abc')).toThrowError(/"abc"/);
    });

    it('error message hints at valid formats', () => {
      expect(() => parseRelativeTime('xyz')).toThrowError(/24h|7d/i);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('"0m" returns exactly now (zero duration in minutes)', () => {
      const result = parseRelativeTime('0m');
      expect(result.getTime()).toBe(FIXED_NOW);
    });

    it('"0h" returns exactly now (zero duration in hours)', () => {
      const result = parseRelativeTime('0h');
      expect(result.getTime()).toBe(FIXED_NOW);
    });

    it('"1m" returns 1 minute in the past (smallest supported unit)', () => {
      const result = parseRelativeTime('1m');
      expect(result.getTime()).toBe(FIXED_NOW - MINUTE_MS);
    });

    it('"1w" returns exactly 7 days in the past', () => {
      const result = parseRelativeTime('1w');
      expect(result.getTime()).toBe(FIXED_NOW - WEEK_MS);
    });

    it('large numeric values are handled without overflow: "9999d"', () => {
      // Should not throw — just produce a valid (possibly distant-past) Date
      const result = parseRelativeTime('9999d');
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it('result is strictly before now for any positive relative input', () => {
      for (const input of ['1m', '1h', '1d', '1w', '100d']) {
        const result = parseRelativeTime(input);
        expect(result.getTime()).toBeLessThan(FIXED_NOW);
      }
    });

    it('larger unit values produce dates further in the past', () => {
      const oneHour = parseRelativeTime('1h').getTime();
      const twoHours = parseRelativeTime('2h').getTime();
      expect(twoHours).toBeLessThan(oneHour);
    });
  });
});
