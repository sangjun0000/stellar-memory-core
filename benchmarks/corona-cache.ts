/**
 * corona-cache.ts — Corona cache hit rate measurement
 *
 * Measures how effectively the in-memory corona cache serves
 * search queries vs falling through to the database layer.
 */

import { randomUUID } from 'node:crypto';
import { initDatabase, resetDatabase } from '../src/storage/database.js';
import { insertMemory } from '../src/storage/queries.js';
import { corona } from '../src/engine/corona.js';
import type { MemoryType } from '../src/engine/types.js';

export interface CacheBenchmarkResult {
  name: string;
  totalMemories: number;
  coronaSize: number;
  coreCount: number;
  nearCount: number;
  hitRateTests: HitRateTest[];
  warmupTimeMs: number;
  avgQueryTimeMs: number;
}

interface HitRateTest {
  scenario: string;
  queries: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgHitTimeMs: number;
  avgMissTimeMs: number;
}

const MEMORY_TYPES: MemoryType[] = ['decision', 'observation', 'task', 'context', 'error', 'milestone'];

const HIGH_IMPORTANCE_CONTENT = [
  'Critical architecture decision for production system scalability',
  'Production database connection pool configuration and tuning',
  'Authentication security policy and JWT token management',
  'Core API rate limiting and throttling configuration',
  'Primary caching strategy with Redis TTL and eviction policy',
  'Main deployment pipeline and rollback procedures',
  'Database migration strategy and version management approach',
  'Monitoring and alerting thresholds for SLA compliance',
  'Security incident response runbook and escalation procedures',
  'Performance baseline metrics and optimization targets',
];

const LOW_IMPORTANCE_CONTENT = [
  'Old quarterly meeting notes from two years ago',
  'Deprecated feature documentation no longer in use',
  'Historical bug report from previous version of the system',
  'Archived project proposal that was not approved',
  'Legacy configuration for decommissioned service',
];

export async function runCacheBenchmark(dbPath: string = ':memory:'): Promise<CacheBenchmarkResult> {
  const project = 'cache-bench';

  resetDatabase();
  initDatabase(dbPath);

  const highImportanceIds: string[] = [];
  const lowImportanceIds: string[] = [];

  // Insert high-importance memories (close to sun — should be in corona)
  for (let i = 0; i < HIGH_IMPORTANCE_CONTENT.length; i++) {
    const id = randomUUID();
    highImportanceIds.push(id);
    insertMemory({
      id,
      project,
      content: HIGH_IMPORTANCE_CONTENT[i % HIGH_IMPORTANCE_CONTENT.length],
      summary: HIGH_IMPORTANCE_CONTENT[i % HIGH_IMPORTANCE_CONTENT.length].slice(0, 50),
      type: MEMORY_TYPES[i % MEMORY_TYPES.length],
      tags: ['critical', 'production'],
      distance: 0.5 + i * 0.1,  // core zone: 0.1–1.0 AU
      importance: 0.95 - i * 0.01,
      impact: 0.9,
      access_count: 50 - i,
    });
  }

  // Insert low-importance memories (far from sun — outside corona range)
  for (let i = 0; i < 50; i++) {
    const id = randomUUID();
    lowImportanceIds.push(id);
    insertMemory({
      id,
      project,
      content: LOW_IMPORTANCE_CONTENT[i % LOW_IMPORTANCE_CONTENT.length] + ` item ${i}`,
      summary: `Low importance item ${i}`,
      type: 'observation',
      tags: ['archive', 'old'],
      distance: 50 + i * 0.8,  // fading/forgotten zone
      importance: 0.05 + Math.random() * 0.1,
      impact: 0.2,
      access_count: 0,
    });
  }

  // Insert medium-importance memories (near zone: 1.0–5.0 AU)
  const nearIds: string[] = [];
  for (let i = 0; i < 30; i++) {
    const id = randomUUID();
    nearIds.push(id);
    insertMemory({
      id,
      project,
      content: `Medium importance memory about ${['database', 'api', 'auth', 'frontend'][i % 4]} topic variant ${i}`,
      summary: `Near memory ${i}`,
      type: MEMORY_TYPES[i % MEMORY_TYPES.length],
      tags: ['active'],
      distance: 1.0 + i * 0.13,  // near zone
      importance: 0.5 + Math.random() * 0.3,
      impact: 0.5,
      access_count: 5 + (i % 10),
    });
  }

  // Warm up corona cache
  const warmupStart = performance.now();
  corona.warmup(project);
  const warmupTimeMs = performance.now() - warmupStart;

  const stats = corona.stats();

  const hitRateTests: HitRateTest[] = [];

  // Test 1: Hot query — terms found in core memories
  const hotQueries = ['architecture', 'production', 'database', 'authentication', 'security'];
  {
    let hits = 0;
    let misses = 0;
    const hitTimes: number[] = [];
    const missTimes: number[] = [];
    const ITERS = 50;

    for (let i = 0; i < ITERS; i++) {
      const query = hotQueries[i % hotQueries.length];
      const start = performance.now();
      const results = corona.search(query, 5);
      const elapsed = performance.now() - start;

      if (results.length > 0) {
        hits++;
        hitTimes.push(elapsed);
      } else {
        misses++;
        missTimes.push(elapsed);
      }
    }

    hitRateTests.push({
      scenario: 'Hot queries (core zone terms)',
      queries: ITERS,
      hits,
      misses,
      hitRate: hits / ITERS,
      avgHitTimeMs: hitTimes.length > 0 ? hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length : 0,
      avgMissTimeMs: missTimes.length > 0 ? missTimes.reduce((a, b) => a + b, 0) / missTimes.length : 0,
    });
  }

  // Test 2: Mixed query — terms from near zone memories
  const mixedQueries = ['database api auth frontend active', 'topic variant', 'medium importance memory'];
  {
    let hits = 0;
    let misses = 0;
    const hitTimes: number[] = [];
    const missTimes: number[] = [];
    const ITERS = 50;

    for (let i = 0; i < ITERS; i++) {
      const query = mixedQueries[i % mixedQueries.length];
      const start = performance.now();
      const results = corona.search(query, 5);
      const elapsed = performance.now() - start;

      if (results.length > 0) {
        hits++;
        hitTimes.push(elapsed);
      } else {
        misses++;
        missTimes.push(elapsed);
      }
    }

    hitRateTests.push({
      scenario: 'Mixed queries (near zone terms)',
      queries: ITERS,
      hits,
      misses,
      hitRate: hits / ITERS,
      avgHitTimeMs: hitTimes.length > 0 ? hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length : 0,
      avgMissTimeMs: missTimes.length > 0 ? missTimes.reduce((a, b) => a + b, 0) / missTimes.length : 0,
    });
  }

  // Test 3: Cold query — terms only in distant memories (cache miss)
  const coldQueries = ['deprecated archived historical quarterly legacy decommissioned'];
  {
    let hits = 0;
    let misses = 0;
    const hitTimes: number[] = [];
    const missTimes: number[] = [];
    const ITERS = 20;

    for (let i = 0; i < ITERS; i++) {
      const query = coldQueries[i % coldQueries.length];
      const start = performance.now();
      const results = corona.search(query, 5);
      const elapsed = performance.now() - start;

      if (results.length > 0) {
        hits++;
        hitTimes.push(elapsed);
      } else {
        misses++;
        missTimes.push(elapsed);
      }
    }

    hitRateTests.push({
      scenario: 'Cold queries (distant memory terms)',
      queries: ITERS,
      hits,
      misses,
      hitRate: hits / ITERS,
      avgHitTimeMs: hitTimes.length > 0 ? hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length : 0,
      avgMissTimeMs: missTimes.length > 0 ? missTimes.reduce((a, b) => a + b, 0) / missTimes.length : 0,
    });
  }

  resetDatabase();

  const allTimes = hitRateTests.flatMap(t => [t.avgHitTimeMs, t.avgMissTimeMs]).filter(t => t > 0);
  const avgQueryTimeMs = allTimes.length > 0
    ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length
    : 0;

  return {
    name: 'Corona Cache Effectiveness',
    totalMemories: HIGH_IMPORTANCE_CONTENT.length + lowImportanceIds.length + nearIds.length,
    coronaSize: stats.total,
    coreCount: stats.core,
    nearCount: stats.near,
    hitRateTests,
    warmupTimeMs,
    avgQueryTimeMs,
  };
}

export function formatCacheResult(result: CacheBenchmarkResult): void {
  console.log('\n=== Corona Cache Benchmark ===');
  console.log(`Total memories: ${result.totalMemories}`);
  console.log(`Corona size: ${result.coronaSize} memories (${result.coreCount} core, ${result.nearCount} near)`);
  console.log(`Cache warmup time: ${result.warmupTimeMs.toFixed(2)}ms`);
  console.log(`Avg query time: ${result.avgQueryTimeMs.toFixed(3)}ms`);
  console.log('\nHit rate by scenario:');
  console.log('Scenario                         | Queries | Hit Rate | Avg Hit (ms) | Avg Miss (ms)');
  console.log('---------------------------------|---------|----------|--------------|---------------');

  for (const t of result.hitRateTests) {
    const scenario = t.scenario.padEnd(33).slice(0, 33);
    const queries = t.queries.toString().padStart(7);
    const hitRate = (t.hitRate * 100).toFixed(0).padStart(7) + '%';
    const avgHit = t.avgHitTimeMs.toFixed(3).padStart(12);
    const avgMiss = t.avgMissTimeMs.toFixed(3).padStart(13);
    console.log(`${scenario}| ${queries} | ${hitRate} | ${avgHit} | ${avgMiss}`);
  }
}
