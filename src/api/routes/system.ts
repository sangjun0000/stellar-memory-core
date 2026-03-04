import { Hono } from 'hono';
import { statSync } from 'node:fs';
import { getDatabase } from '../../storage/database.js';
import { getMemoriesByProject } from '../../storage/queries.js';
import { recalculateOrbits } from '../../engine/orbit.js';
import { getConfig } from '../../utils/config.js';
import { ORBIT_ZONES } from '../../engine/types.js';
import type { OrbitZone } from '../../engine/types.js';
import { emitOrbitRecalculated } from '../websocket.js';

const app = new Hono();

// GET /api/system/status — overall system status
app.get('/status', (c) => {
  const project = c.req.query('project') ?? 'default';
  const config = getConfig();

  const memories = getMemoriesByProject(project);

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(config.dbPath).size;
  } catch {
    // DB file may not be accessible in some environments
  }

  const zoneBreakdown: Record<string, number> = {};
  for (const zone of Object.keys(ORBIT_ZONES) as OrbitZone[]) {
    const { min, max } = ORBIT_ZONES[zone];
    zoneBreakdown[zone] = memories.filter(
      (m) => m.distance >= min && m.distance < max
    ).length;
  }

  return c.json({
    ok: true,
    data: {
      project,
      memory_count: memories.length,
      db_size_bytes: dbSizeBytes,
      db_path: config.dbPath,
      zone_breakdown: zoneBreakdown,
    },
  });
});

// POST /api/system/orbit — trigger orbit recalculation
app.post('/orbit', (c) => {
  const project = c.req.query('project') ?? 'default';
  const config = getConfig();

  const changes = recalculateOrbits(project, config);
  emitOrbitRecalculated(project, { changes_count: changes.length });

  return c.json({
    ok: true,
    changes_count: changes.length,
    data: changes,
  });
});

// GET /api/system/zones — per-zone statistics
app.get('/zones', (c) => {
  const project = c.req.query('project') ?? 'default';

  const memories = getMemoriesByProject(project);

  const zones = (Object.keys(ORBIT_ZONES) as OrbitZone[]).map((zone) => {
    const { min, max, label } = ORBIT_ZONES[zone];
    const zoneMemories = memories.filter(
      (m) => m.distance >= min && m.distance < max
    );

    return {
      zone,
      label,
      min_au: min,
      max_au: max,
      count: zoneMemories.length,
      avg_importance:
        zoneMemories.length > 0
          ? zoneMemories.reduce((s, m) => s + m.importance, 0) / zoneMemories.length
          : 0,
    };
  });

  return c.json({ ok: true, data: zones, project });
});

export default app;
