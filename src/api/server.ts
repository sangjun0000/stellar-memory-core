import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { initDatabase } from '../storage/database.js';
import { getConfig } from '../utils/config.js';
import { createWebSocketServer, handleUpgrade } from './websocket.js';
import memoriesRouter from './routes/memories.js';
import sunRouter from './routes/sun.js';
import systemRouter from './routes/system.js';
import { scanRouter, sourcesRouter } from './routes/scan.js';
import orbitRouter from './routes/orbit.js';
import constellationRouter from './routes/constellation.js';
import projectsRouter from './routes/projects.js';
import analyticsRouter from './routes/analytics.js';
import temporalRouter from './routes/temporal.js';
import conflictsRouter from './routes/conflicts.js';
import observationsRouter from './routes/observations.js';
import consolidationRouter from './routes/consolidation.js';
import sessionsRouter from './routes/sessions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(__dirname, '..', '..', 'web', 'dist');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config = getConfig();
initDatabase(config.dbPath);

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const app = new Hono();

// CORS — allow any localhost origin (Vite dev, Electron, any port)
app.use('/*', cors({
  origin: (origin) => {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return origin;
    }
    return undefined;
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Health check
app.get('/api/health', (c) => c.json({
  name: 'stellar-memory-api',
  version: '0.5.0',
  status: 'ok',
  uptime: process.uptime(),
}));

// Routers
app.route('/api/memories', memoriesRouter);
app.route('/api/sun', sunRouter);
app.route('/api/system', systemRouter);
app.route('/api/scan', scanRouter);
app.route('/api/sources', sourcesRouter);
app.route('/api/orbit', orbitRouter);
app.route('/api/constellation', constellationRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/analytics', analyticsRouter);
app.route('/api/temporal', temporalRouter);
app.route('/api/conflicts', conflictsRouter);
app.route('/api/observations', observationsRouter);
app.route('/api/consolidation', consolidationRouter);
app.route('/api/sessions', sessionsRouter);

// ---------------------------------------------------------------------------
// Static web dashboard (serve web/dist/ if it exists)
// ---------------------------------------------------------------------------

const hasWebDist = existsSync(join(WEB_DIST, 'index.html'));

if (hasWebDist) {
  // Serve static assets (JS, CSS, images)
  app.use('/*', serveStatic({ root: WEB_DIST }));

  // SPA fallback — non-API, non-asset routes return index.html
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    const indexPath = join(WEB_DIST, 'index.html');
    const html = readFileSync(indexPath, 'utf-8');
    return c.html(html);
  });
}

// Global error handler
app.onError((err, c) => {
  console.error('[stellar-api] error:', err);
  return c.json({ ok: false, error: err.message ?? 'Internal server error' }, 500);
});

// 404
app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = parseInt(process.env.STELLAR_API_PORT ?? '21547', 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[stellar-api] listening on http://localhost:${info.port}`);
  console.log(`[stellar-api] WebSocket available at ws://localhost:${info.port}/ws`);
});

// Initialize WebSocket server and attach upgrade handler
createWebSocketServer();
server.on('upgrade', handleUpgrade);
