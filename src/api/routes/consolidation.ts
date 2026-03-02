/**
 * routes/consolidation.ts — Memory Consolidation API routes
 *
 * GET  /api/consolidation/candidates      — findConsolidationCandidates
 * POST /api/consolidation/run             — runConsolidation
 * GET  /api/consolidation/history/:id     — getConsolidationSources
 */

import { Hono } from 'hono';
import {
  findConsolidationCandidates,
  runConsolidation,
  getConsolidationSources,
} from '../../engine/consolidation.js';

const app = new Hono();

// GET /api/consolidation/candidates?project=default
app.get('/candidates', async (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const candidates = await findConsolidationCandidates(project);
    return c.json({
      ok: true,
      data: candidates.map(({ memories, similarity }) => ({
        similarity,
        memoryCount: memories.length,
        memories: memories.map(m => ({
          id:       m.id,
          type:     m.type,
          summary:  m.summary,
          distance: m.distance,
        })),
      })),
      project,
      total: candidates.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Find candidates failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /api/consolidation/run — body: { project? }
app.post('/run', async (c) => {
  try {
    const body    = await c.req.json().catch(() => ({})) as { project?: string };
    const project = body.project ?? 'default';
    const stats   = await runConsolidation(project);
    return c.json({ ok: true, data: stats, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Consolidation run failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/consolidation/history/:id — get source memories for a consolidated memory
app.get('/history/:id', (c) => {
  const id = c.req.param('id');
  try {
    const sources = getConsolidationSources(id);
    return c.json({ ok: true, data: sources, consolidatedId: id, total: sources.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Consolidation history failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
