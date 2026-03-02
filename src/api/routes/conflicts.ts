/**
 * routes/conflicts.ts — Memory Conflict API routes
 *
 * GET  /api/conflicts                 — getUnresolvedConflicts (query: project)
 * GET  /api/conflicts/:memoryId       — getConflictsForMemory
 * POST /api/conflicts/:id/resolve     — resolveConflict
 * POST /api/conflicts/:id/dismiss     — resolveConflict with dismiss action
 */

import { Hono } from 'hono';
import {
  getUnresolvedConflicts,
  resolveConflict,
} from '../../engine/conflict.js';
import { getConflictsForMemory } from '../../storage/queries.js';

const app = new Hono();

// GET /api/conflicts?project=default
app.get('/', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getUnresolvedConflicts(project);
    return c.json({ ok: true, data, project, total: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Get conflicts failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/conflicts/:memoryId — get conflicts for a specific memory
app.get('/:memoryId', (c) => {
  const memoryId = c.req.param('memoryId');
  try {
    const data = getConflictsForMemory(memoryId);
    return c.json({ ok: true, data, memoryId, total: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Get conflicts for memory failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /api/conflicts/:id/resolve — body: { resolution, action? }
app.post('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json() as {
      resolution?: string;
      action?: 'supersede' | 'dismiss' | 'keep_both';
    };
    const resolution = body.resolution ?? 'Resolved via API';
    const action     = body.action ?? 'supersede';
    resolveConflict(id, resolution, action);
    return c.json({ ok: true, id, action, resolution });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resolve conflict failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /api/conflicts/:id/dismiss — shortcut for dismiss action
app.post('/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json().catch(() => ({})) as { resolution?: string };
    const resolution = body.resolution ?? 'Dismissed via API';
    resolveConflict(id, resolution, 'dismiss');
    return c.json({ ok: true, id, action: 'dismiss', resolution });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dismiss conflict failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
