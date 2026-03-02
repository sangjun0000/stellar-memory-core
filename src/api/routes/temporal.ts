/**
 * routes/temporal.ts — Temporal Awareness API routes
 *
 * GET  /api/temporal/at        — getContextAtTime (query: timestamp, project)
 * GET  /api/temporal/chain/:id — getEvolutionChain
 * GET  /api/temporal/summary   — getTemporalSummary
 * POST /api/temporal/bounds/:id — setTemporalBounds
 * POST /api/temporal/supersede  — supersedeMemory (body: oldId, newId)
 */

import { Hono } from 'hono';
import {
  getContextAtTime,
  getEvolutionChain,
  getTemporalSummary,
  setTemporalBounds,
  supersedeMemory,
} from '../../engine/temporal.js';

const app = new Hono();

// GET /api/temporal/at?timestamp=ISO&project=default
app.get('/at', (c) => {
  const project   = c.req.query('project') ?? 'default';
  const timestamp = c.req.query('timestamp');

  if (!timestamp) {
    return c.json({ ok: false, error: 'timestamp query parameter is required' }, 400);
  }

  try {
    const data = getContextAtTime(project, timestamp);
    return c.json({ ok: true, data, project, timestamp });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Temporal query failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/temporal/chain/:id
app.get('/chain/:id', (c) => {
  const id = c.req.param('id');
  try {
    const data = getEvolutionChain(id);
    return c.json({ ok: true, data, memoryId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Evolution chain failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/temporal/summary?project=default
app.get('/summary', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const text = getTemporalSummary(project);
    return c.json({ ok: true, data: text, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Temporal summary failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /api/temporal/bounds/:id — body: { valid_from?, valid_until? }
app.post('/bounds/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json() as { valid_from?: string; valid_until?: string };
    setTemporalBounds(id, body.valid_from, body.valid_until);
    return c.json({ ok: true, id, valid_from: body.valid_from, valid_until: body.valid_until });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Set bounds failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /api/temporal/supersede — body: { oldId, newId }
app.post('/supersede', async (c) => {
  try {
    const body = await c.req.json() as { oldId: string; newId: string };
    if (!body.oldId || !body.newId) {
      return c.json({ ok: false, error: 'oldId and newId are required' }, 400);
    }
    supersedeMemory(body.oldId, body.newId);
    return c.json({ ok: true, oldId: body.oldId, newId: body.newId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supersede failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
