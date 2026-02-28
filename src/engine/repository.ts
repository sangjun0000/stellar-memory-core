/**
 * engine/repository.ts — MemoryRepository abstraction
 *
 * Defines the storage contract for memories and sun state.
 * The engine and use-case layers depend only on this interface,
 * making the concrete storage backend swappable (SQLite today,
 * Python v1 or a remote API tomorrow).
 *
 * Dependency rule: this file lives in the engine layer and MUST NOT
 * import from storage/, infrastructure, or framework packages.
 */

import type { Memory, MemoryType, SunState, OrbitChange } from './types.js';

// ---------------------------------------------------------------------------
// InsertMemoryData — the set of fields required to create a new memory.
// The repository assigns id / timestamps if missing.
// ---------------------------------------------------------------------------

export interface InsertMemoryData {
  id?: string;
  project: string;
  content: string;
  summary?: string;
  type?: MemoryType;
  tags?: string[];
  distance?: number;
  importance?: number;
  velocity?: number;
  impact?: number;
  access_count?: number;
  last_accessed_at?: string | null;
  metadata?: Record<string, unknown>;
  source?: string | null;
  source_path?: string | null;
  source_hash?: string | null;
  content_hash?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ---------------------------------------------------------------------------
// MemoryRepository — storage port (interface / output-port in clean arch terms)
// ---------------------------------------------------------------------------

export interface MemoryRepository {
  // ── Memory CRUD ────────────────────────────────────────────────────────────

  /** Persist a new memory and return the fully-resolved record. */
  insert(data: InsertMemoryData): Memory;

  /** Fetch a single memory by its UUID. Returns undefined if not found. */
  getById(id: string): Memory | undefined;

  /**
   * Fetch multiple memories by a list of IDs in a single round-trip.
   * Soft-deleted memories are excluded.
   */
  getByIds(ids: string[]): Memory[];

  /**
   * Fetch all non-deleted memories for a project, ordered by distance ASC.
   */
  getByProject(project: string): Memory[];

  /**
   * Find a non-deleted memory with the given content hash (SHA-256).
   * Used for content-level deduplication in createMemory().
   */
  getByContentHash(project: string, hash: string): Memory | undefined;

  // ── Search ─────────────────────────────────────────────────────────────────

  /**
   * Full-text search over memories in a project.
   * Implementations may use FTS5, Postgres full-text, or any other backend.
   */
  search(project: string, query: string, limit: number): Memory[];

  // ── Orbit / access updates ─────────────────────────────────────────────────

  /** Increment access_count and refresh last_accessed_at. */
  updateAccess(id: string): void;

  /** Persist new orbital position after a physics recalculation. */
  updateOrbit(id: string, distance: number, importance: number, velocity: number): void;

  /** Soft-delete a memory (sets deleted_at; keeps the row for audit trails). */
  softDelete(id: string): void;

  // ── Nearest memories ───────────────────────────────────────────────────────

  /**
   * Return up to `limit` non-deleted memories for the project ordered by
   * distance ASC (closest to the sun first).
   */
  getNearestMemories(project: string, limit: number): Memory[];

  // ── Sun state ──────────────────────────────────────────────────────────────

  /** Retrieve the sun (working context) for a project. */
  getSunState(project: string): SunState | undefined;

  /** Insert or update the sun state for a project. */
  upsertSunState(state: SunState): void;

  // ── Orbit log ──────────────────────────────────────────────────────────────

  /** Append an orbit-change event for audit / analytics. */
  insertOrbitLog(change: OrbitChange): void;

  /** Remove orbit log entries older than `daysOld` days. */
  cleanupOrbitLog(daysOld: number): void;
}
