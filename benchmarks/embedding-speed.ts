/**
 * embedding-speed.ts — Embedding generation throughput measurement
 *
 * Times the all-MiniLM-L6-v2 model for various content lengths.
 * First call includes model loading time; subsequent calls show steady-state.
 */

import { generateEmbedding } from '../src/engine/embedding.js';

export interface EmbeddingSpeedResult {
  name: string;
  modelLoadTimeMs: number;
  results: EmbeddingMeasurement[];
  throughputPerMinute: number;
}

interface EmbeddingMeasurement {
  label: string;
  charCount: number;
  firstCallMs: number;
  avgWarmMs: number;
  iterations: number;
}

const TEST_CONTENTS: Array<{ label: string; content: string }> = [
  {
    label: 'Short (10 chars)',
    content: 'Auth error',
  },
  {
    label: 'Medium (100 chars)',
    content: 'Chose PostgreSQL for production database due to better JSON support and JSONB indexing capabilities',
  },
  {
    label: 'Long (500 chars)',
    content: 'User authentication module is complete with OAuth2 implementation and JWT token refresh flow. ' +
      'The system supports Google, GitHub, and email/password login methods. ' +
      'Token refresh happens automatically when access token expires, and refresh tokens are rotated on use. ' +
      'Logout invalidates both tokens. Rate limiting is applied to login endpoint to prevent brute force attacks. ' +
      'Two-factor authentication via TOTP is supported for enhanced security.',
  },
  {
    label: 'Max (2000 chars)',
    content: 'A'.repeat(500) + ' database architecture decision involving PostgreSQL ' +
      'B'.repeat(500) + ' with connection pooling and read replicas ' +
      'C'.repeat(500) + ' for high availability and performance optimization ' +
      'D'.repeat(400),
  },
];

export async function runEmbeddingSpeedBenchmark(iterations: number = 5): Promise<EmbeddingSpeedResult> {
  const measurements: EmbeddingMeasurement[] = [];

  // First: time the model load + first inference
  const modelLoadStart = performance.now();
  await generateEmbedding('model warmup initialization ping');
  const modelLoadTimeMs = performance.now() - modelLoadStart;

  // Measure each content length
  for (const { label, content } of TEST_CONTENTS) {
    // First call (model already loaded — measures just inference)
    const firstStart = performance.now();
    await generateEmbedding(content);
    const firstCallMs = performance.now() - firstStart;

    // Warm iterations
    const warmTimings: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await generateEmbedding(content);
      warmTimings.push(performance.now() - start);
    }

    const avgWarm = warmTimings.reduce((a, b) => a + b, 0) / warmTimings.length;

    measurements.push({
      label,
      charCount: content.length,
      firstCallMs,
      avgWarmMs: avgWarm,
      iterations,
    });
  }

  // Calculate throughput: how many average-sized memories per minute
  const avgMs = measurements[1].avgWarmMs; // use 100-char medium as baseline
  const throughputPerMinute = avgMs > 0 ? Math.floor(60_000 / avgMs) : 0;

  return {
    name: 'Embedding Generation Speed',
    modelLoadTimeMs,
    results: measurements,
    throughputPerMinute,
  };
}

export function formatEmbeddingResult(result: EmbeddingSpeedResult): void {
  console.log('\n=== Embedding Generation Speed ===');
  console.log(`Model load time: ${result.modelLoadTimeMs.toFixed(0)}ms`);
  console.log(`Estimated throughput: ~${result.throughputPerMinute} memories/minute`);
  console.log('\nPer content length:');
  console.log('Content Size       | Chars | 1st (ms) | Avg Warm (ms)');
  console.log('-------------------|-------|----------|---------------');

  for (const m of result.results) {
    const label = m.label.padEnd(19);
    const chars = m.charCount.toString().padStart(5);
    const first = m.firstCallMs.toFixed(1).padStart(8);
    const avg = m.avgWarmMs.toFixed(1).padStart(13);
    console.log(`${label}| ${chars} | ${first} | ${avg}`);
  }
}
