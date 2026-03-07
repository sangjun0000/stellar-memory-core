import type { Memory, MemoryValidityState } from './types.js';

function toTimestamp(value: string | undefined | null): number | null {
  if (!value) return null;
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getMemoryValidityState(
  memory: Pick<Memory, 'valid_from' | 'valid_until' | 'superseded_by'>,
  now: string | number | Date = new Date(),
): MemoryValidityState {
  const nowMs = typeof now === 'string'
    ? (toTimestamp(now) ?? Date.now())
    : now instanceof Date
      ? now.getTime()
      : now;

  if (memory.superseded_by) return 'superseded';

  const validFromMs = toTimestamp(memory.valid_from);
  if (validFromMs !== null && validFromMs > nowMs) {
    return 'future';
  }

  const validUntilMs = toTimestamp(memory.valid_until);
  if (validUntilMs !== null && validUntilMs <= nowMs) {
    return 'expired';
  }

  return 'active';
}

export function isMemoryCurrentlyActive(
  memory: Pick<Memory, 'valid_from' | 'valid_until' | 'superseded_by'>,
  now: string | number | Date = new Date(),
): boolean {
  return getMemoryValidityState(memory, now) === 'active';
}

export function filterActiveMemories<T extends Pick<Memory, 'valid_from' | 'valid_until' | 'superseded_by'>>(
  memories: T[],
  now: string | number | Date = new Date(),
): T[] {
  return memories.filter((memory) => isMemoryCurrentlyActive(memory, now));
}
