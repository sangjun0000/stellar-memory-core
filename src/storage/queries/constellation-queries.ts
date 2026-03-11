/**
 * storage/queries/constellation-queries.ts — Knowledge graph (constellation edges)
 */

import { getDatabase } from '../database.js';
import type { Memory, ConstellationEdge } from '../../engine/types.js';
import {
  RawConstellationEdgeRow,
  deserializeConstellationEdge,
} from './shared.js';
import { getMemoryByIds } from './memory-queries.js';

export function createEdge(edge: ConstellationEdge): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO constellation_edges (id, source_id, target_id, relation, weight, project, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
      weight = excluded.weight,
      metadata = excluded.metadata
  `).run(
    edge.id,
    edge.source_id,
    edge.target_id,
    edge.relation,
    edge.weight,
    edge.project,
    JSON.stringify(edge.metadata ?? {}),
    edge.created_at,
  );
}

export function getEdges(memoryId: string, project: string): ConstellationEdge[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM constellation_edges
    WHERE (source_id = ? OR target_id = ?) AND project = ?
    ORDER BY weight DESC
  `).all(memoryId, memoryId, project) as unknown[];
  return rows.map((r) => deserializeConstellationEdge(r as RawConstellationEdgeRow));
}

export function getConstellation(
  memoryId: string,
  project: string,
  depth = 1
): { nodes: Memory[]; edges: ConstellationEdge[] } {
  const db = getDatabase();

  const visitedNodeIds = new Set<string>([memoryId]);
  const allEdges: ConstellationEdge[] = [];
  let frontier = [memoryId];

  for (let d = 0; d < depth; d++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => '?').join(', ');
    const edgeRows = db.prepare(`
      SELECT * FROM constellation_edges
      WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
        AND project = ?
    `).all(...frontier, ...frontier, project) as unknown[];

    for (const r of edgeRows) {
      const edge = deserializeConstellationEdge(r as RawConstellationEdgeRow);
      allEdges.push(edge);
      visitedNodeIds.add(edge.source_id);
      visitedNodeIds.add(edge.target_id);
    }

    frontier = [...visitedNodeIds].filter((id) => !frontier.includes(id) && id !== memoryId);
  }

  const nodes = getMemoryByIds([...visitedNodeIds]);
  return { nodes, edges: allEdges };
}

export function getEdgesForBatch(
  memoryIds: string[],
  project: string,
): Map<string, Set<string>> {
  if (memoryIds.length === 0) return new Map();
  const db = getDatabase();
  const placeholders = memoryIds.map(() => '?').join(', ');

  const rows = db.prepare(`
    SELECT source_id, target_id FROM constellation_edges
    WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      AND project = ?
  `).all(...memoryIds, ...memoryIds, project) as unknown[];

  const idSet = new Set(memoryIds);
  const result = new Map<string, Set<string>>();

  for (const r of rows) {
    const row = r as { source_id: string; target_id: string };
    if (idSet.has(row.source_id)) {
      const neighbors = result.get(row.source_id) ?? new Set();
      neighbors.add(row.target_id);
      result.set(row.source_id, neighbors);
    }
    if (idSet.has(row.target_id)) {
      const neighbors = result.get(row.target_id) ?? new Set();
      neighbors.add(row.source_id);
      result.set(row.target_id, neighbors);
    }
  }

  return result;
}

export function deleteEdge(id: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM constellation_edges WHERE id = ?`).run(id);
}

export function getEdgeCountForMemory(memoryId: string): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM constellation_edges
    WHERE source_id = ? OR target_id = ?
  `).get(memoryId, memoryId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Get all edge IDs for a memory (no project filter needed — used for cleanup).
 */
export function getEdgeIdsForMemory(memoryId: string): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id FROM constellation_edges
    WHERE source_id = ? OR target_id = ?
  `).all(memoryId, memoryId) as Array<{ id: string }>;
  return rows.map(r => r.id);
}
