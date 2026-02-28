import { Hono } from 'hono';
import { StellarScanner, listDataSources } from '../../scanner/index.js';
import type { ScanConfig } from '../../scanner/types.js';

// ---------------------------------------------------------------------------
// POST /api/scan — trigger a one-shot directory scan
// ---------------------------------------------------------------------------

export const scanRouter = new Hono();

scanRouter.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const path = body.path as string | undefined;
  if (!path || !path.trim()) {
    return c.json({ ok: false, error: 'path is required' }, 400);
  }

  const recursive = body.recursive !== false; // default: true
  const git       = body.git !== false;       // default: true
  const maxKb     = body.max_kb as number | undefined;

  const scannerConfig: Partial<ScanConfig> = {};
  if (maxKb !== undefined && maxKb > 0) {
    scannerConfig.maxFileSize = maxKb * 1024;
  }

  const scanner = new StellarScanner(scannerConfig);

  try {
    const result = await scanner.scanPath(path.trim(), {
      recursive,
      includeGit: git,
    });

    return c.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sources — list all registered data sources
// ---------------------------------------------------------------------------

export const sourcesRouter = new Hono();

sourcesRouter.get('/', (c) => {
  try {
    const sources = listDataSources();
    return c.json({ ok: true, data: sources, total: sources.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list sources';
    return c.json({ ok: false, error: message }, 500);
  }
});
