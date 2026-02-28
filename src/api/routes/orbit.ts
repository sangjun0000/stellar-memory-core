import { Hono } from 'hono';
import { recalculateOrbits } from '../../engine/orbit.js';
import { getDatabase } from '../../storage/database.js';
import { getConfig } from '../../utils/config.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Raw row shape for orbit_log
// ---------------------------------------------------------------------------

interface RawOrbitLogRow {
  id: number;
  memory_id: string;
  project: string;
  old_distance: number;
  new_distance: number;
  old_importance: number;
  new_importance: number;
  trigger: string;
  created_at: string;
}

// POST /api/orbit — trigger a full orbit recalculation for a project
//
// Query params:
//   project (default: "default")
app.post('/', (c) => {
  const project = c.req.query('project') ?? 'default';
  const config  = getConfig();

  try {
    const changes = recalculateOrbits(project, config);
    return c.json({ ok: true, data: changes, changes_count: changes.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Orbit recalculation failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/orbit/history — recent orbit log entries for a project
//
// Query params:
//   project (default: "default")
//   limit   (default: 50, max: 200)
//   trigger ("decay" | "access" | "forget" — optional filter)
app.get('/history', (c) => {
  const project      = c.req.query('project') ?? 'default';
  const limitParam   = c.req.query('limit');
  const trigger      = c.req.query('trigger');
  const limit        = Math.min(200, Math.max(1, limitParam ? parseInt(limitParam, 10) : 50));

  try {
    const db = getDatabase();

    let rows: unknown[];

    if (trigger) {
      rows = db.prepare(`
        SELECT * FROM orbit_log
        WHERE project = ? AND trigger = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(project, trigger, limit) as unknown[];
    } else {
      rows = db.prepare(`
        SELECT * FROM orbit_log
        WHERE project = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(project, limit) as unknown[];
    }

    const entries = (rows as RawOrbitLogRow[]).map((r) => ({
      id:             r.id,
      memory_id:      r.memory_id,
      project:        r.project,
      old_distance:   r.old_distance,
      new_distance:   r.new_distance,
      old_importance: r.old_importance,
      new_importance: r.new_importance,
      trigger:        r.trigger,
      created_at:     r.created_at,
    }));

    return c.json({ ok: true, data: entries, total: entries.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch orbit history';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
