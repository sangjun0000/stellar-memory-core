/**
 * routes/projects.ts — Multi-Project Galaxy API routes
 *
 * GET  /api/projects             — list all projects
 * POST /api/projects             — create a project
 * GET  /api/projects/:name/stats — detailed stats for a project
 * POST /api/projects/switch      — switch active project
 * GET  /api/projects/universal   — list universal memories
 * POST /api/projects/universal/:id — mark/unmark a memory as universal
 * GET  /api/projects/:name/candidates — detect universal candidates
 */

import { Hono } from 'hono';
import {
  listAllProjects,
  createProject,
  getProjectStats,
  switchProject,
  getCurrentProject,
  markUniversal,
  getUniversalContext,
  detectUniversalCandidates,
} from '../../engine/multiproject.js';
import { getUniversalMemories } from '../../storage/queries.js';

const app = new Hono();

// GET /api/projects — list all projects with stats
app.get('/', (c) => {
  const projects = listAllProjects();
  const current  = getCurrentProject();
  return c.json({ ok: true, data: projects, current_project: current });
});

// POST /api/projects — create a new project
app.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const name = body.name as string | undefined;
  if (!name || !name.trim()) {
    return c.json({ ok: false, error: 'name is required' }, 400);
  }

  try {
    const result = createProject(name.trim());
    const status = result.created ? 201 : 200;
    return c.json({ ok: true, data: result }, status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Create failed';
    return c.json({ ok: false, error: message }, 400);
  }
});

// POST /api/projects/switch — switch the active project at runtime
app.post('/switch', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const project = body.project as string | undefined;
  if (!project || !project.trim()) {
    return c.json({ ok: false, error: 'project is required' }, 400);
  }

  try {
    const result = switchProject(project.trim());
    return c.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Switch failed';
    return c.json({ ok: false, error: message }, 400);
  }
});

// GET /api/projects/universal — list all universal memories
app.get('/universal', (c) => {
  const limitParam = c.req.query('limit');
  const limit      = limitParam ? parseInt(limitParam, 10) : 50;
  const memories   = getUniversalMemories(limit > 0 ? limit : 50);
  return c.json({ ok: true, data: memories, total: memories.length });
});

// POST /api/projects/universal/:id — mark or unmark a memory as universal
app.post('/universal/:id', async (c) => {
  const id = c.req.param('id');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // Body optional — defaults to marking as universal
  }

  const isUniversal = body.is_universal !== false; // default true

  try {
    markUniversal(id, isUniversal);
    return c.json({ ok: true, id, is_universal: isUniversal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mark failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/projects/:name/stats — detailed stats for one project
app.get('/:name/stats', (c) => {
  const name = c.req.param('name');
  try {
    const stats = getProjectStats(name);
    return c.json({ ok: true, data: stats, project: name });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stats failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/projects/:name/universal — universal context for a project
app.get('/:name/universal', (c) => {
  const name       = c.req.param('name');
  const limitParam = c.req.query('limit');
  const limit      = limitParam ? parseInt(limitParam, 10) : 20;
  const memories   = getUniversalContext(name, limit > 0 ? limit : 20);
  return c.json({ ok: true, data: memories, project: name, total: memories.length });
});

// GET /api/projects/:name/candidates — detect universal candidates
app.get('/:name/candidates', (c) => {
  const name       = c.req.param('name');
  const candidates = detectUniversalCandidates(name);
  return c.json({ ok: true, data: candidates, project: name, total: candidates.length });
});

export default app;
