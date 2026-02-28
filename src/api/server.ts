import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { initDatabase } from '../storage/database.js';
import { getConfig } from '../utils/config.js';
import memoriesRouter from './routes/memories.js';
import sunRouter from './routes/sun.js';
import systemRouter from './routes/system.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config = getConfig();
initDatabase(config.dbPath);

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const app = new Hono();

// CORS — allow all origins for local development
app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));

// Health check
app.get('/', (c) => c.json({ name: 'stellar-memory-api', version: '0.1.0', status: 'ok' }));

// Routers
app.route('/api/memories', memoriesRouter);
app.route('/api/sun', sunRouter);
app.route('/api/system', systemRouter);

// Global error handler
app.onError((err, c) => {
  console.error('[stellar-api] error:', err);
  return c.json({ error: err.message ?? 'Internal server error' }, 500);
});

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = parseInt(process.env.STELLAR_API_PORT ?? '21547', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[stellar-api] listening on http://localhost:${info.port}`);
});
