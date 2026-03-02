import { Hono } from 'hono';
import { getSunState } from '../../storage/queries.js';
import { commitToSun } from '../../engine/sun.js';

const app = new Hono();

// GET /api/sun — current sun state
app.get('/', (c) => {
  const project = c.req.query('project') ?? 'default';
  const sun = getSunState(project);

  if (!sun) {
    return c.json({
      ok: true,
      data: null,
      message: 'No sun state found. Use POST /api/sun/commit to initialize.',
    });
  }

  return c.json({ ok: true, data: sun });
});

// POST /api/sun/commit — commit session state to sun
app.post('/commit', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const project = (body.project as string | undefined) ?? 'default';
  const current_work = (body.current_work as string | undefined) ?? '';
  const decisions = (body.decisions as string[] | undefined) ?? [];
  const next_steps = (body.next_steps as string[] | undefined) ?? [];
  const errors = (body.errors as string[] | undefined) ?? [];
  const context = body.context as string | undefined;

  if (!current_work.trim()) {
    return c.json({ ok: false, error: 'current_work is required' }, 400);
  }

  commitToSun(project, { current_work, decisions, next_steps, errors, context });

  const updated = getSunState(project);
  return c.json({ ok: true, data: updated });
});

export default app;
