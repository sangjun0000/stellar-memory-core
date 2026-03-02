/**
 * routes/analytics.ts — Memory Analytics API routes
 *
 * GET /api/analytics/overview      — full MemoryAnalytics object
 * GET /api/analytics/survival      — survival curve (age buckets)
 * GET /api/analytics/movements     — orbit movement timeline
 * GET /api/analytics/clusters      — topic cluster heatmap
 * GET /api/analytics/patterns      — periodic access pattern detection
 * GET /api/analytics/health        — health metrics + recommendations
 * GET /api/analytics/report        — full text report
 */

import { Hono } from 'hono';
import {
  getFullAnalytics,
  getSurvivalCurve,
  getOrbitMovements,
  getTopicClusters,
  detectAccessPatterns,
  getMemoryHealth,
  generateReport,
} from '../../engine/analytics.js';

const app = new Hono();

// GET /api/analytics/overview
app.get('/overview', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getFullAnalytics(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analytics failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/survival
app.get('/survival', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getSurvivalCurve(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Survival curve failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/movements?days=30
app.get('/movements', (c) => {
  const project   = c.req.query('project') ?? 'default';
  const daysParam = c.req.query('days');
  const days      = daysParam ? parseInt(daysParam, 10) : 30;
  try {
    const data = getOrbitMovements(project, days > 0 ? days : 30);
    return c.json({ ok: true, data, project, days });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Movements failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/clusters
app.get('/clusters', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getTopicClusters(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Clusters failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/patterns
app.get('/patterns', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = detectAccessPatterns(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Patterns failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/health
app.get('/health', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getMemoryHealth(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/report
app.get('/report', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const text   = generateReport(project);
    const accept = c.req.header('accept') ?? '';
    if (accept.includes('text/plain')) {
      return c.text(text);
    }
    return c.json({ ok: true, data: text, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// Aliases for new naming convention
// GET /api/analytics/summary — alias for overview
app.get('/summary', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getFullAnalytics(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analytics summary failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// GET /api/analytics/topics — alias for clusters
app.get('/topics', (c) => {
  const project = c.req.query('project') ?? 'default';
  try {
    const data = getTopicClusters(project);
    return c.json({ ok: true, data, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Topics failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
