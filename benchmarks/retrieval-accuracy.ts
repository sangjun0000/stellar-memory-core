/**
 * retrieval-accuracy.ts — Precision@k and Recall@k for memory search
 *
 * Stores test memories with known relevance relationships and measures
 * how accurately the search system retrieves the expected results.
 */

import { randomUUID } from 'node:crypto';
import { initDatabase, resetDatabase } from '../src/storage/database.js';
import { insertMemory, searchMemories } from '../src/storage/queries.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryType } from '../src/engine/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AccuracyBenchmarkResult {
  name: string;
  queriesRun: number;
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  f1Score: number;
  perQueryResults: QueryResult[];
}

interface QueryResult {
  query: string;
  description: string;
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  retrieved: string[];
  expected: string[];
}

interface TestMemory {
  id: string;
  content: string;
  type: string;
  tags: string[];
  relevantTo: string[];
}

interface TestQuery {
  query: string;
  expectedIds: string[];
  description: string;
}

interface TestData {
  memories: TestMemory[];
  testQueries: TestQuery[];
}

/**
 * Calculate precision@k: fraction of top-k results that are relevant
 */
function precisionAtK(retrieved: string[], relevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const relevantSet = new Set(relevant);
  const hits = topK.filter(id => relevantSet.has(id)).length;
  return hits / Math.min(k, topK.length || 1);
}

/**
 * Calculate recall@k: fraction of relevant results found in top-k
 */
function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 1.0;
  const topK = retrieved.slice(0, k);
  const relevantSet = new Set(relevant);
  const hits = topK.filter(id => relevantSet.has(id)).length;
  return hits / relevant.length;
}

export async function runAccuracyBenchmark(dbPath: string = ':memory:'): Promise<AccuracyBenchmarkResult> {
  const dataPath = join(__dirname, 'data', 'test-memories.json');
  const testData = JSON.parse(readFileSync(dataPath, 'utf-8')) as TestData;

  resetDatabase();
  initDatabase(dbPath);

  const project = 'accuracy-bench';
  const idMap = new Map<string, string>(); // logical ID → actual UUID

  // Insert all test memories with fixed IDs for correlation
  for (const mem of testData.memories) {
    const actualId = randomUUID();
    idMap.set(mem.id, actualId);

    insertMemory({
      id: actualId,
      project,
      content: mem.content,
      summary: mem.content.slice(0, 60),
      type: mem.type as MemoryType,
      tags: mem.tags,
      distance: 5.0 + Math.random() * 20,
      importance: 0.3 + Math.random() * 0.4,
      impact: 0.5,
      access_count: 0,
    });
  }

  // Add noise memories to make retrieval harder (realistic corpus)
  const noiseContents = [
    'Weekly team sync meeting notes and action items for next sprint',
    'Fixed typo in README documentation file introduction section',
    'Updated package.json version bump for minor dependency upgrade',
    'Code review comments addressed for PR number 247 feature branch',
    'Rescheduled Friday deployment to avoid holiday weekend conflicts',
    'Configured editor settings for consistent code formatting team-wide',
    'Archived old feature branch after successful merge to main branch',
    'Created Jira ticket for design system icon library expansion request',
    'Reviewed pull request for new onboarding modal UI improvements',
    'Updated Slack channel description with new team contact information',
    'Coffee machine on third floor needs descaling according to maintenance',
    'Booked conference room for quarterly planning meeting next month',
    'Updated shared calendar with product roadmap review dates and times',
    'Forwarded invoice from cloud vendor to finance team for processing',
    'Added new team member to GitHub organization and Slack workspace',
    'Ordered replacement keyboards for developers who prefer mechanical',
    'Updated company wiki with new engineering onboarding guide content',
    'Migrated old Trello board contents to new Linear project management',
    'Scheduled one-on-one meetings with all direct reports this quarter',
    'Followed up on outstanding design mockups for mobile app screens',
  ];

  for (let i = 0; i < noiseContents.length; i++) {
    insertMemory({
      id: randomUUID(),
      project,
      content: noiseContents[i],
      summary: noiseContents[i].slice(0, 60),
      type: 'observation',
      tags: ['misc', 'noise'],
      distance: 20 + Math.random() * 60,
      importance: 0.1 + Math.random() * 0.2,
      impact: 0.2,
      access_count: 0,
    });
  }

  const perQueryResults: QueryResult[] = [];

  for (const testQuery of testData.testQueries) {
    const expectedActualIds = testQuery.expectedIds
      .map(logicalId => idMap.get(logicalId))
      .filter((id): id is string => id !== undefined);

    const results = searchMemories(project, testQuery.query, 20);
    const retrievedIds = results.map(m => m.id);

    const p5 = precisionAtK(retrievedIds, expectedActualIds, 5);
    const p10 = precisionAtK(retrievedIds, expectedActualIds, 10);
    const r10 = recallAtK(retrievedIds, expectedActualIds, 10);

    perQueryResults.push({
      query: testQuery.query,
      description: testQuery.description,
      precisionAt5: p5,
      precisionAt10: p10,
      recallAt10: r10,
      retrieved: retrievedIds.slice(0, 10),
      expected: expectedActualIds,
    });
  }

  resetDatabase();

  const avgP5 = perQueryResults.reduce((s, r) => s + r.precisionAt5, 0) / perQueryResults.length;
  const avgP10 = perQueryResults.reduce((s, r) => s + r.precisionAt10, 0) / perQueryResults.length;
  const avgR10 = perQueryResults.reduce((s, r) => s + r.recallAt10, 0) / perQueryResults.length;
  const f1 = avgP10 + avgR10 > 0
    ? (2 * avgP10 * avgR10) / (avgP10 + avgR10)
    : 0;

  return {
    name: 'Retrieval Accuracy',
    queriesRun: testData.testQueries.length,
    precisionAt5: avgP5,
    precisionAt10: avgP10,
    recallAt10: avgR10,
    f1Score: f1,
    perQueryResults,
  };
}

export function formatAccuracyResult(result: AccuracyBenchmarkResult): void {
  console.log('\n=== Retrieval Accuracy Benchmark ===');
  console.log(`Queries run: ${result.queriesRun}`);
  console.log(`Precision@5:  ${(result.precisionAt5 * 100).toFixed(1)}%`);
  console.log(`Precision@10: ${(result.precisionAt10 * 100).toFixed(1)}%`);
  console.log(`Recall@10:    ${(result.recallAt10 * 100).toFixed(1)}%`);
  console.log(`F1 Score:     ${(result.f1Score * 100).toFixed(1)}%`);
  console.log('\nPer-query breakdown:');
  console.log('Query                          | P@5   | P@10  | R@10  ');
  console.log('-------------------------------|-------|-------|-------');

  for (const r of result.perQueryResults) {
    const q = r.query.padEnd(31).slice(0, 31);
    const p5 = (r.precisionAt5 * 100).toFixed(0).padStart(5) + '%';
    const p10 = (r.precisionAt10 * 100).toFixed(0).padStart(5) + '%';
    const r10 = (r.recallAt10 * 100).toFixed(0).padStart(5) + '%';
    console.log(`${q}| ${p5} | ${p10} | ${r10} `);
  }
}
