import { Hono } from 'hono';
import {
  getMemoriesByProject,
  getMemoryById,
  searchMemories,
  softDeleteMemory,
  insertMemory,
} from '../../storage/queries.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import type { OrbitZone, MemoryType } from '../../engine/types.js';
import { IMPACT_DEFAULTS } from '../../engine/types.js';
import { importanceToDistance } from '../../engine/orbit.js';

const app = new Hono();

// GET /api/memories — list memories with optional filters
app.get('/', (c) => {
  const project = c.req.query('project') ?? 'default';
  const zone = c.req.query('zone') as OrbitZone | undefined;
  const limitParam = c.req.query('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  let memories = getMemoriesByProject(project);

  if (zone && zone in ORBIT_ZONES) {
    const { min, max } = ORBIT_ZONES[zone];
    memories = memories.filter((m) => m.distance >= min && m.distance < max);
  }

  if (limit && limit > 0) {
    memories = memories.slice(0, limit);
  }

  return c.json({ data: memories, total: memories.length });
});

// GET /api/memories/search — FTS search
app.get('/search', (c) => {
  const project = c.req.query('project') ?? 'default';
  const query = c.req.query('query') ?? '';
  const type = c.req.query('type') as MemoryType | undefined;
  const limitParam = c.req.query('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 20;

  if (!query.trim()) {
    return c.json({ error: 'query parameter is required' }, 400);
  }

  let memories = searchMemories(project, query, limit);

  if (type) {
    memories = memories.filter((m) => m.type === type);
  }

  return c.json({ data: memories, total: memories.length, query });
});

// GET /api/memories/:id — single memory
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const memory = getMemoryById(id);

  if (!memory) {
    return c.json({ error: 'Memory not found' }, 404);
  }

  return c.json({ data: memory });
});

// POST /api/memories — create memory
app.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const content = body.content as string | undefined;
  const summary = body.summary as string | undefined;
  const type = (body.type as MemoryType | undefined) ?? 'observation';
  const project = (body.project as string | undefined) ?? 'default';
  const tags = (body.tags as string[] | undefined) ?? [];
  const impact = (body.impact as number | undefined) ?? IMPACT_DEFAULTS[type] ?? 0.5;
  const importance = impact;
  const distance = importanceToDistance(importance);

  if (!content || !content.trim()) {
    return c.json({ error: 'content is required' }, 400);
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

  return c.json({ data: memory }, 201);
});

// DELETE /api/memories/:id — soft delete
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const memory = getMemoryById(id);

  if (!memory) {
    return c.json({ error: 'Memory not found' }, 404);
  }

  softDeleteMemory(id);
  return c.json({ success: true, id });
});

export default app;
