/**
 * routes/observations.ts — Observational Memory API routes
 *
 * POST /api/observations/process — processConversation
 * GET  /api/observations          — getObservations (query: project, limit)
 */

import { Hono } from 'hono';
import { processConversation } from '../../engine/observation.js';
import { getObservations } from '../../storage/queries.js';

const app = new Hono();

// POST /api/observations/process — body: { conversation, project? }
app.post('/process', async (c) => {
  try {
    const body = await c.req.json() as { conversation: string; project?: string };

    if (!body.conversation || typeof body.conversation !== 'string') {
      return c.json({ ok: false, error: 'conversation (string) is required in request body' }, 400);
    }

    const project = body.project ?? 'default';
    const stats   = await processConversation(body.conversation, project);

    return c.json({ ok: true, data: stats, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Observation processing failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/observations?project=default&limit=20
app.get('/', (c) => {
  const project    = c.req.query('project') ?? 'default';
  const limitParam = c.req.query('limit');
  const limit      = limitParam ? parseInt(limitParam, 10) : 20;

  try {
    const data = getObservations(project, limit > 0 ? limit : 20);
    return c.json({ ok: true, data, project, total: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Get observations failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
