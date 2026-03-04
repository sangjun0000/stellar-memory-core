/**
 * benchmarks/index.ts — Main benchmark runner
 *
 * Runs all Stellar Memory benchmarks and outputs results as:
 *   1. Console tables (human-readable)
 *   2. JSON file at benchmarks/results/results-<timestamp>.json
 *   3. Markdown report at benchmarks/results/report-<timestamp>.md
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --skip-embeddings   # skip slow embedding benchmark
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDecayBenchmark, formatDecayResult } from './importance-decay.js';
import { runLatencyBenchmark, formatLatencyTable } from './search-latency.js';
import { runAccuracyBenchmark, formatAccuracyResult } from './retrieval-accuracy.js';
import { runEmbeddingSpeedBenchmark, formatEmbeddingResult } from './embedding-speed.js';
import { runCacheBenchmark, formatCacheResult } from './corona-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');

const skipEmbeddings = process.argv.includes('--skip-embeddings');

interface BenchmarkSuite {
  runAt: string;
  nodeVersion: string;
  platform: string;
  decay: ReturnType<typeof runDecayBenchmark>;
  latency: Awaited<ReturnType<typeof runLatencyBenchmark>>[];
  accuracy: Awaited<ReturnType<typeof runAccuracyBenchmark>>;
  embedding?: Awaited<ReturnType<typeof runEmbeddingSpeedBenchmark>>;
  cache: Awaited<ReturnType<typeof runCacheBenchmark>>;
}

function generateMarkdownReport(suite: BenchmarkSuite): string {
  const lines: string[] = [
    '# Stellar Memory — Benchmark Report',
    '',
    `**Run at:** ${suite.runAt}  `,
    `**Node.js:** ${suite.nodeVersion}  `,
    `**Platform:** ${suite.platform}  `,
    '',
    '---',
    '',
    '## 1. Importance Decay Verification',
    '',
    `Status: **${suite.decay.passed ? 'PASSED' : 'FAILED'}**  `,
    `Distance mapping accuracy: **${(suite.decay.distanceMappingAccuracy * 100).toFixed(2)}%**`,
    '',
    '| Hours Elapsed | Expected Score | Actual Score | Error    | Status |',
    '|---------------|----------------|--------------|----------|--------|',
  ];

  for (const c of suite.decay.details) {
    lines.push(
      `| ${c.hoursElapsed.toString().padEnd(13)} | ${c.expectedScore.toFixed(4).padEnd(14)} | ${c.actualScore.toFixed(4).padEnd(12)} | ${c.error.toFixed(4).padEnd(8)} | ${c.passed ? 'OK' : 'FAIL'} |`
    );
  }

  lines.push(
    '',
    '---',
    '',
    '## 2. Search Latency',
    '',
    '| Dataset Size | Method                    | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) |',
    '|--------------|---------------------------|----------|----------|----------|-----------|',
  );

  for (const r of suite.latency) {
    const addRow = (method: string, stats: { p50: number; p95: number; p99: number; mean: number }) => {
      lines.push(
        `| ${r.datasetSize.toString().padEnd(12)} | ${method.padEnd(25)} | ${stats.p50.toFixed(2).padStart(8)} | ${stats.p95.toFixed(2).padStart(8)} | ${stats.p99.toFixed(2).padStart(8)} | ${stats.mean.toFixed(2).padStart(9)} |`
      );
    };
    addRow(r.keyword.method, r.keyword);
    addRow(r.hybrid.method, r.hybrid);
  }

  lines.push(
    '',
    '---',
    '',
    '## 3. Retrieval Accuracy',
    '',
    `**Queries run:** ${suite.accuracy.queriesRun}  `,
    `**Precision@5:** ${(suite.accuracy.precisionAt5 * 100).toFixed(1)}%  `,
    `**Precision@10:** ${(suite.accuracy.precisionAt10 * 100).toFixed(1)}%  `,
    `**Recall@10:** ${(suite.accuracy.recallAt10 * 100).toFixed(1)}%  `,
    `**F1 Score:** ${(suite.accuracy.f1Score * 100).toFixed(1)}%`,
    '',
    '| Query                           | P@5   | P@10  | R@10  |',
    '|---------------------------------|-------|-------|-------|',
  );

  for (const r of suite.accuracy.perQueryResults) {
    const q = r.query.padEnd(33).slice(0, 33);
    lines.push(
      `| ${q}| ${(r.precisionAt5 * 100).toFixed(0).padStart(3)}%  | ${(r.precisionAt10 * 100).toFixed(0).padStart(3)}%  | ${(r.recallAt10 * 100).toFixed(0).padStart(3)}%  |`
    );
  }

  if (suite.embedding) {
    lines.push(
      '',
      '---',
      '',
      '## 4. Embedding Generation Speed',
      '',
      `**Model load time:** ${suite.embedding.modelLoadTimeMs.toFixed(0)}ms  `,
      `**Estimated throughput:** ~${suite.embedding.throughputPerMinute} memories/minute`,
      '',
      '| Content Size      | Chars | 1st Call (ms) | Avg Warm (ms) |',
      '|-------------------|-------|---------------|---------------|',
    );

    for (const m of suite.embedding.results) {
      lines.push(
        `| ${m.label.padEnd(18)}| ${m.charCount.toString().padStart(5)} | ${m.firstCallMs.toFixed(1).padStart(13)} | ${m.avgWarmMs.toFixed(1).padStart(13)} |`
      );
    }
  }

  lines.push(
    '',
    '---',
    '',
    '## 5. Corona Cache Effectiveness',
    '',
    `**Total memories:** ${suite.cache.totalMemories}  `,
    `**Corona size:** ${suite.cache.coronaSize} memories (${suite.cache.coreCount} core, ${suite.cache.nearCount} near)  `,
    `**Cache warmup time:** ${suite.cache.warmupTimeMs.toFixed(2)}ms  `,
    `**Avg query time:** ${suite.cache.avgQueryTimeMs.toFixed(3)}ms`,
    '',
    '| Scenario                        | Queries | Hit Rate | Avg Hit (ms) | Avg Miss (ms) |',
    '|---------------------------------|---------|----------|--------------|---------------|',
  );

  for (const t of suite.cache.hitRateTests) {
    const scenario = t.scenario.padEnd(33).slice(0, 33);
    lines.push(
      `| ${scenario}| ${t.queries.toString().padStart(7)} | ${(t.hitRate * 100).toFixed(0).padStart(6)}%  | ${t.avgHitTimeMs.toFixed(3).padStart(12)} | ${t.avgMissTimeMs.toFixed(3).padStart(13)} |`
    );
  }

  lines.push(
    '',
    '---',
    '',
    '*Generated by Stellar Memory benchmark suite. Run `npm run benchmark` to reproduce.*',
  );

  return lines.join('\n');
}

async function main() {
  console.log('Stellar Memory — Benchmark Suite');
  console.log('=================================');
  console.log(`Node.js ${process.version} | ${process.platform}`);
  console.log(skipEmbeddings ? '(embedding benchmark skipped)' : '');

  // 1. Decay verification (pure math, no DB needed)
  console.log('\nRunning decay verification...');
  const decay = runDecayBenchmark();
  formatDecayResult(decay);

  // 2. Search latency at three dataset sizes
  console.log('\nRunning search latency benchmarks...');
  const latencyResults = [];
  for (const size of [100, 500, 1000]) {
    process.stdout.write(`  ${size} memories... `);
    const result = await runLatencyBenchmark(size, 50);
    process.stdout.write(`done (p50=${result.keyword.p50.toFixed(1)}ms)\n`);
    latencyResults.push(result);
  }
  console.log(formatLatencyTable(latencyResults));

  // 3. Retrieval accuracy
  console.log('\nRunning retrieval accuracy benchmark...');
  const accuracy = await runAccuracyBenchmark();
  formatAccuracyResult(accuracy);

  // 4. Embedding speed (optional — slow on first run due to model download)
  let embedding: Awaited<ReturnType<typeof runEmbeddingSpeedBenchmark>> | undefined;
  if (!skipEmbeddings) {
    console.log('\nRunning embedding speed benchmark...');
    console.log('  (first run downloads ~90MB model — subsequent runs are faster)');
    try {
      embedding = await runEmbeddingSpeedBenchmark(3);
      formatEmbeddingResult(embedding);
    } catch (err) {
      console.warn('  Embedding benchmark skipped:', err instanceof Error ? err.message : String(err));
    }
  }

  // 5. Corona cache
  console.log('\nRunning corona cache benchmark...');
  const cache = await runCacheBenchmark();
  formatCacheResult(cache);

  // Assemble results
  const suite: BenchmarkSuite = {
    runAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    decay,
    latency: latencyResults,
    accuracy,
    embedding,
    cache,
  };

  // Write results
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const jsonPath = join(RESULTS_DIR, `results-${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(suite, null, 2));
  console.log(`\nJSON results written to: ${jsonPath}`);

  const mdPath = join(RESULTS_DIR, `report-${timestamp}.md`);
  writeFileSync(mdPath, generateMarkdownReport(suite));
  console.log(`Markdown report written to: ${mdPath}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Decay verification:    ${decay.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`Retrieval accuracy:    P@10=${(accuracy.precisionAt10 * 100).toFixed(0)}% R@10=${(accuracy.recallAt10 * 100).toFixed(0)}% F1=${(accuracy.f1Score * 100).toFixed(0)}%`);
  console.log(`Search latency (1k):   p50=${latencyResults[2].keyword.p50.toFixed(1)}ms p99=${latencyResults[2].keyword.p99.toFixed(1)}ms`);
  console.log(`Corona cache warmup:   ${cache.warmupTimeMs.toFixed(1)}ms, avg query ${cache.avgQueryTimeMs.toFixed(3)}ms`);
  if (embedding) {
    console.log(`Embedding throughput:  ~${embedding.throughputPerMinute} memories/min`);
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
