import { Hono } from 'hono';
import { getMemoryById } from '../../storage/queries.js';
import { getDatabase } from '../../storage/database.js';
import {
  getConstellationGraph,
  findRelatedMemories,
  extractRelationships,
  suggestRelationships,
  cleanupEdges,
} from '../../engine/constellation.js';
import type { ConstellationEdge } from '../../engine/types.js';
import { deserializeConstellationEdge, type RawConstellationEdgeRow } from '../../storage/queries/shared.js';

const app = new Hono();

// GET /api/constellation — fetch ALL edges for a project (for graph view)
//
// Query params:
//   project  (default: "default")
//   limit    (integer, default 500)
app.get('/', (c) => {
  const project  = c.req.query('project') ?? 'default';
  const limitRaw = c.req.query('limit');
  const limit    = limitRaw ? Math.min(2000, Math.max(1, parseInt(limitRaw, 10))) : 500;

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM constellation_edges
    WHERE project = ?
    ORDER BY weight DESC
    LIMIT ?
  `).all(project, limit) as unknown[];

  const edges = rows.map((r) => deserializeConstellationEdge(r as RawConstellationEdgeRow));
  return c.json({ ok: true, data: edges as ConstellationEdge[], total: edges.length });
});

// GET /api/constellation/:id — fetch constellation graph for a memory
//
// Query params:
//   depth    (integer, 1–3, default 1)
//   project  (default: "default")
app.get('/:id', (c) => {
  const id      = c.req.param('id');
  const project = c.req.query('project') ?? 'default';
  const depthRaw = c.req.query('depth');
  const depth   = depthRaw ? Math.min(3, Math.max(1, parseInt(depthRaw, 10))) : 1;

  const memory = getMemoryById(id);
  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  const graph = getConstellationGraph(id, project, depth);
  return c.json({ ok: true, data: graph });
});

// GET /api/constellation/:id/related — get related memories sorted by edge weight
//
// Query params:
//   limit   (integer, default 10)
//   project (default: "default")
app.get('/:id/related', (c) => {
  const id      = c.req.param('id');
  const project = c.req.query('project') ?? 'default';
  const limitRaw = c.req.query('limit');
  const limit   = limitRaw ? parseInt(limitRaw, 10) : 10;

  const memory = getMemoryById(id);
  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  const related = findRelatedMemories(id, project, limit);
  return c.json({ ok: true, data: related, total: related.length });
});

// GET /api/constellation/:id/suggest — suggest potential new relationships
//
// Query params:
//   project (default: "default")
app.get('/:id/suggest', (c) => {
  const id      = c.req.param('id');
  const project = c.req.query('project') ?? 'default';

  const memory = getMemoryById(id);
  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  const suggestions = suggestRelationships(id, project);
  return c.json({ ok: true, data: suggestions, total: suggestions.length });
});

// POST /api/constellation/:id/extract — trigger relationship extraction for a memory
//
// Useful for reprocessing existing memories that were created before the
// constellation system was active.
app.post('/:id/extract', async (c) => {
  const id      = c.req.param('id');
  const project = c.req.query('project') ?? 'default';

  const memory = getMemoryById(id);
  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  try {
    const edges = await extractRelationships(memory, project);
    return c.json({ ok: true, data: edges, total: edges.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// DELETE /api/constellation/:id — remove all edges for a memory
app.delete('/:id', (c) => {
  const id = c.req.param('id');

  const memory = getMemoryById(id);
  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  cleanupEdges(id);
  return c.json({ ok: true, id });
});

export default app;
