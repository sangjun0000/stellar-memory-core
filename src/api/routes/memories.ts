import { Hono } from 'hono';
import {
  getMemoriesByProject,
  getMemoryById,
  softDeleteMemory,
  insertMemory,
} from '../../storage/queries.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import type { OrbitZone, MemoryType } from '../../engine/types.js';
import { IMPACT_DEFAULTS } from '../../engine/types.js';
import { importanceToDistance } from '../../engine/orbit.js';
import { recallMemoriesAsync } from '../../engine/planet.js';
import { forgetMemory } from '../../engine/planet.js';

const app = new Hono();

// GET /api/memories — list memories with optional filters
//
// Query params:
//   project (default: "default")
//   zone    (corona | inner | habitable | outer | kuiper | oort)
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
      id:         m.id,
      summary:    m.summary,
      type:       m.type,
      distance:   m.distance,
      importance: m.importance,
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
  const maxAuRaw = c.req.query('max_au');
  const limitRaw = c.req.query('limit');

  const maxDistance = maxAuRaw ? parseFloat(maxAuRaw) : undefined;
  const limit       = limitRaw ? parseInt(limitRaw, 10) : 10;

  if (!q.trim()) {
    return c.json({ ok: false, error: 'q parameter is required' }, 400);
  }

  try {
    const memories = await recallMemoriesAsync(project, q.trim(), {
      type:        type ?? 'all',
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

  const content  = body.content as string | undefined;
  const summary  = body.summary as string | undefined;
  const type     = (body.type as MemoryType | undefined) ?? 'observation';
  const project  = (body.project as string | undefined) ?? 'default';
  const tags     = (body.tags as string[] | undefined) ?? [];
  const impact   = (body.impact as number | undefined) ?? IMPACT_DEFAULTS[type] ?? 0.5;
  const importance = impact;
  const distance = importanceToDistance(importance);

  if (!content || !content.trim()) {
    return c.json({ ok: false, error: 'content is required' }, 400);
  }

  const memory = insertMemory({
    project,
    content,
    summary: summary ?? content.slice(0, 100),
    type,
    tags,
    impact,
    importance,
    distance,
  });

  return c.json({ ok: true, data: memory }, 201);
});

// POST /api/memories/:id/forget — forget a memory (push to Oort or soft-delete)
//
// Body:
//   { mode: 'push' | 'delete' }
//   'push'  — moves memory to the Oort cloud (distance ≈ 95 AU), stays searchable
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
    return c.json({ ok: true, id, mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forget failed';
    return c.json({ ok: false, error: message }, 500);
  }
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
