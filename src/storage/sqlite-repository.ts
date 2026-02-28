/**
 * storage/sqlite-repository.ts — SQLite implementation of MemoryRepository.
 *
 * This adapter wraps the existing queries.ts functions and satisfies the
 * MemoryRepository interface defined in engine/repository.ts.
 *
 * Design notes:
 *   - No business logic lives here; all logic stays in the engine layer.
 *   - queries.ts functions return `null` for "not found"; we translate to
 *     `undefined` to match the interface contract (null is an implementation detail).
 *   - This file is the ONLY place in the storage layer that knows about the
 *     MemoryRepository interface — other storage files remain unchanged.
 */

import type { Memory, SunState, OrbitChange } from '../engine/types.js';
import type { MemoryRepository, InsertMemoryData } from '../engine/repository.js';
import {
  insertMemory,
  getMemoryById,
  getMemoryByIds,
  getMemoriesByProject,
  getMemoryByContentHash,
  searchMemories,
  updateMemoryAccess,
  updateMemoryOrbit,
  softDeleteMemory,
  getNearestMemories as queryGetNearestMemories,
  getSunState as queryGetSunState,
  upsertSunState as queryUpsertSunState,
  insertOrbitLog as queryInsertOrbitLog,
  cleanupOrbitLog as queryCleanupOrbitLog,
} from './queries.js';

// ---------------------------------------------------------------------------
// SqliteMemoryRepository
// ---------------------------------------------------------------------------

export class SqliteMemoryRepository implements MemoryRepository {
  // ── Memory CRUD ────────────────────────────────────────────────────────────

  insert(data: InsertMemoryData): Memory {
    return insertMemory(data);
  }

  getById(id: string): Memory | undefined {
    return getMemoryById(id) ?? undefined;
  }

  getByIds(ids: string[]): Memory[] {
    return getMemoryByIds(ids);
  }

  getByProject(project: string): Memory[] {
    return getMemoriesByProject(project);
  }

  getByContentHash(project: string, hash: string): Memory | undefined {
    return getMemoryByContentHash(project, hash) ?? undefined;
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  search(project: string, query: string, limit: number): Memory[] {
    return searchMemories(project, query, limit);
  }

  // ── Orbit / access updates ─────────────────────────────────────────────────

  updateAccess(id: string): void {
    updateMemoryAccess(id);
  }

  updateOrbit(id: string, distance: number, importance: number, velocity: number): void {
    updateMemoryOrbit(id, distance, importance, velocity);
  }

  softDelete(id: string): void {
    softDeleteMemory(id);
  }

  // ── Nearest memories ───────────────────────────────────────────────────────

  getNearestMemories(project: string, limit: number): Memory[] {
    return queryGetNearestMemories(project, limit);
  }

  // ── Sun state ──────────────────────────────────────────────────────────────

  getSunState(project: string): SunState | undefined {
    return queryGetSunState(project) ?? undefined;
  }

  upsertSunState(state: SunState): void {
    queryUpsertSunState(state);
  }

  // ── Orbit log ──────────────────────────────────────────────────────────────

  insertOrbitLog(change: OrbitChange): void {
    queryInsertOrbitLog(change);
  }

  cleanupOrbitLog(daysOld: number): void {
    queryCleanupOrbitLog(daysOld);
  }
}
