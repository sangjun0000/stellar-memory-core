import { Hono } from 'hono';
import {
  getMemoriesByProject,
  getMemoryById,
  softDeleteMemory,
} from '../../storage/queries.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import type { OrbitZone, MemoryType } from '../../engine/types.js';
import { distanceToImportance } from '../../engine/orbit.js';
import { updateMemoryOrbit, insertOrbitLog } from '../../storage/queries.js';
import type { OrbitChange } from '../../engine/types.js';
import { recallMemoriesAsync, forgetMemory } from '../../engine/planet.js';
import { createMemoryFull } from '../../engine/services/memory-service.js';
import { emitMemoryCreated, emitMemoryDeleted, emitMemoryUpdated } from '../websocket.js';

const app = new Hono();

// GET /api/memories — list memories with optional filters
//
// Query params:
//   project (default: "default")
//   zone    (core | near | active | archive | fading | forgotten)
//   limit   (integer)
app.get('/', (c) => {
  const project     = c.req.query('project') ?? 'default';
  const zone        = c.req.query('zone') as OrbitZone | undefined;
  const limitParam  = c.req.query('limit');
  const limit       = limitParam ? parseInt(limitParam, 10) : undefined;
  const summaryOnly = c.req.query('summary_only') === 'true';

  let memories = getMemoriesByProject(project);

  if (zone && zone in ORBIT_ZONES) {
    const { min, max } = ORBIT_ZONES[zone];
    memories = memories.filter((m) => m.distance >= min && m.distance < max);
  }

  if (limit && limit > 0) {
    memories = memories.slice(0, limit);
  }

  if (summaryOnly) {
    const slim = memories.map((m) => ({
      id:           m.id,
      project:      m.project,
      content:      m.content?.slice(0, 120) ?? '',
      summary:      m.summary,
      type:         m.type,
      tags:         m.tags,
      distance:     m.distance,
      importance:   m.importance,
      velocity:     m.velocity,
      impact:       m.impact,
      access_count: m.access_count,
      quality_score: m.quality_score,
      is_universal: m.is_universal,
      created_at:   m.created_at,
      updated_at:   m.updated_at,
    }));
    return c.json({ ok: true, data: slim, total: slim.length });
  }

  return c.json({ ok: true, data: memories, total: memories.length });
});

// GET /api/memories/search — hybrid search (FTS5 + vector KNN via RRF)
//
// Query params:
//   q       (required) search query string
//   project (default: "default")
//   type    (decision | observation | task | context | error | milestone)
//   max_au  (float) exclude memories beyond this orbital distance
//   limit   (default: 10)
app.get('/search', async (c) => {
  const project  = c.req.query('project') ?? 'default';
  const q        = c.req.query('q') ?? '';
  const type     = c.req.query('type') as MemoryType | 'all' | undefined;
  const zone     = c.req.query('zone') as import('../../engine/types.js').OrbitZone | undefined;
  const maxAuRaw = c.req.query('max_au');
  const limitRaw = c.req.query('limit');

  // Zone → distance range mapping
  const ZONE_RANGE: Record<string, { min: number; max: number }> = {
    core: { min: 0.1, max: 1.0 }, near: { min: 1.0, max: 5.0 },
    active: { min: 5.0, max: 15.0 }, archive: { min: 15.0, max: 40.0 },
    fading: { min: 40.0, max: 70.0 }, forgotten: { min: 70.0, max: 100.0 },
  };
  const zoneRange = zone && ZONE_RANGE[zone] ? ZONE_RANGE[zone] : undefined;
  const minDistance = zoneRange ? zoneRange.min : undefined;
  const maxDistance = maxAuRaw ? parseFloat(maxAuRaw)
    : zoneRange ? zoneRange.max : undefined;
  const limit       = limitRaw ? parseInt(limitRaw, 10) : 10;

  // When q is empty but type/zone filters are set, filter without full-text search
  if (!q.trim()) {
    let memories = getMemoriesByProject(project);

    if (type && type !== 'all') {
      memories = memories.filter((m) => m.type === type);
    }
    if (minDistance !== undefined) {
      memories = memories.filter((m) => m.distance >= minDistance);
    }
    if (maxDistance !== undefined) {
      memories = memories.filter((m) => m.distance < maxDistance);
    }
    if (limit > 0) {
      memories = memories.slice(0, limit);
    }

    return c.json({ ok: true, data: memories, total: memories.length, query: q });
  }

  try {
    const memories = await recallMemoriesAsync(project, q.trim(), {
      type:        type ?? 'all',
      minDistance: minDistance,
      maxDistance: maxDistance,
      limit:       limit > 0 ? limit : 10,
    });

    return c.json({ ok: true, data: memories, total: memories.length, query: q });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/memories/:id — single memory by ID
app.get('/:id', (c) => {
  const id     = c.req.param('id');
  const memory = getMemoryById(id);

  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  return c.json({ ok: true, data: memory });
});

// POST /api/memories — create a new memory
app.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const content = body.content as string | undefined;
  const summary = body.summary as string | undefined;
  const type    = body.type as MemoryType | undefined;
  const project = (body.project as string | undefined) ?? 'default';
  const tags    = body.tags as string[] | undefined;
  const impact  = body.impact as number | undefined;

  if (!content || !content.trim()) {
    return c.json({ ok: false, error: 'content is required' }, 400);
  }

  const result = await createMemoryFull(
    { content, summary, type, impact, tags },
    project,
  );
  emitMemoryCreated(project, result.memory);

  return c.json({ ok: true, data: result.memory }, 201);
});

// POST /api/memories/:id/forget — forget a memory (push to Forgotten or soft-delete)
//
// Body:
//   { mode: 'push' | 'delete' }
//   'push'  — moves memory to the Forgotten zone (distance ≈ 95 AU), stays searchable
//   'delete' — soft-deletes the memory (excluded from all queries)
app.post('/:id/forget', async (c) => {
  const id = c.req.param('id');

  const existing = getMemoryById(id);
  if (!existing) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // Body is optional — default to 'push' mode
  }

  const mode = (body.mode as 'push' | 'delete' | undefined) ?? 'push';
  if (mode !== 'push' && mode !== 'delete') {
    return c.json({ ok: false, error: 'mode must be "push" or "delete"' }, 400);
  }

  try {
    forgetMemory(id, mode);
    emitMemoryDeleted(existing.project, { id, mode });
    return c.json({ ok: true, id, mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forget failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// PATCH /api/memories/:id/orbit — manually set orbit distance (drag & drop)
//
// Body:
//   { distance: number }  — new orbital distance in AU (0.1–100)
app.patch('/:id/orbit', async (c) => {
  const id = c.req.param('id');
  const memory = getMemoryById(id);

  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const newDistance = body.distance as number | undefined;
  if (typeof newDistance !== 'number' || newDistance < 0.1 || newDistance > 100) {
    return c.json({ ok: false, error: 'distance must be a number between 0.1 and 100' }, 400);
  }

  const newImportance = distanceToImportance(newDistance);
  const velocity = newDistance - memory.distance;

  updateMemoryOrbit(id, newDistance, newImportance, velocity);

  const change: OrbitChange = {
    memory_id: id,
    project: memory.project,
    old_distance: memory.distance,
    new_distance: newDistance,
    old_importance: memory.importance,
    new_importance: newImportance,
    trigger: 'manual',
  };
  insertOrbitLog(change);

  emitMemoryUpdated(memory.project, { id, new_distance: newDistance, new_importance: newImportance });

  return c.json({
    ok: true,
    data: {
      id,
      old_distance: memory.distance,
      new_distance: newDistance,
      old_importance: memory.importance,
      new_importance: newImportance,
    },
  });
});

// DELETE /api/memories/:id — soft delete (legacy endpoint, kept for compatibility)
app.delete('/:id', (c) => {
  const id     = c.req.param('id');
  const memory = getMemoryById(id);

  if (!memory) {
    return c.json({ ok: false, error: 'Memory not found' }, 404);
  }

  softDeleteMemory(id);
  return c.json({ ok: true, id });
});

export default app;
