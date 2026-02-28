/**
 * utils/time.ts — Relative time string parser.
 *
 * Converts shorthand like "24h", "7d", "30m" into a Date object
 * representing that duration in the past from now.
 * Falls back to ISO 8601 parsing for absolute timestamps.
 */

const RELATIVE_RE = /^(\d+)(m|h|d|w)$/i;

const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Parse a time string into a Date.
 *
 * Supported formats:
 *   - "30m"  → 30 minutes ago
 *   - "24h"  → 24 hours ago
 *   - "7d"   → 7 days ago
 *   - "2w"   → 2 weeks ago
 *   - ISO 8601 string → parsed directly
 *
 * @throws {Error} if the string is neither a valid relative time nor a valid ISO date.
 */
export function parseRelativeTime(input: string): Date {
  const match = input.match(RELATIVE_RE);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms = amount * UNIT_MS[unit];
    return new Date(Date.now() - ms);
  }

  // Fallback: try ISO 8601 parsing
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid time format: "${input}". Use relative (e.g. "24h", "7d") or ISO 8601.`
    );
  }
  return date;
}
