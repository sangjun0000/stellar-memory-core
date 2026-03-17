/**
 * routes/sessions.ts — Session Ledger API routes
 *
 * GET /api/sessions         — list sessions for a project
 * GET /api/sessions/:id/ledger — get ledger entries for a session
 */

import { Hono } from 'hono';
import { listSessions, getSessionLedger } from '../../engine/ledger.js';

const app = new Hono();

// GET /api/sessions?project=default&limit=20&offset=0
app.get('/', (c) => {
  const project = c.req.query('project') ?? 'default';
  const limit   = parseInt(c.req.query('limit')  ?? '20', 10);
  const offset  = parseInt(c.req.query('offset') ?? '0',  10);

  try {
    const sessions = listSessions(project, limit, offset);
    return c.json({ ok: true, data: sessions, project, total: sessions.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list sessions';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/sessions/:id/ledger
app.get('/:id/ledger', (c) => {
  const id = c.req.param('id');

  try {
    const entries = getSessionLedger(id);
    return c.json({ ok: true, data: entries, sessionId: id, total: entries.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get ledger';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
