/**
 * importance-decay.ts — Verify orbital decay formula
 *
 * Tests that the exponential decay curve produces expected recency scores
 * at known time intervals and validates the distance mapping formula.
 */

import { recencyScore, frequencyScore, importanceToDistance, distanceToImportance } from '../src/engine/orbit.js';

export interface DecayBenchmarkResult {
  name: string;
  passed: boolean;
  details: DecayCheckpoint[];
  distanceMappingAccuracy: number;
}

interface DecayCheckpoint {
  hoursElapsed: number;
  expectedScore: number;
  actualScore: number;
  error: number;
  passed: boolean;
}

/**
 * Verify exponential decay: score = 0.5^(hours / halfLife)
 * Default halfLife = 72 hours
 */
export function runDecayBenchmark(): DecayBenchmarkResult {
  const halfLife = 72;
  const checkpoints: DecayCheckpoint[] = [];

  // Key checkpoints: 1h, 24h, 72h (half-life), 168h (1 week), 720h (30 days)
  const testPoints = [
    { hours: 0,   expected: 1.000 },
    { hours: 1,   expected: Math.pow(0.5, 1/72) },   // ~0.990
    { hours: 24,  expected: Math.pow(0.5, 24/72) },  // ~0.794
    { hours: 72,  expected: 0.5 },                    // exactly 0.5 at half-life
    { hours: 168, expected: Math.pow(0.5, 168/72) }, // ~0.229
    { hours: 720, expected: Math.pow(0.5, 720/72) }, // ~0.001
  ];

  for (const point of testPoints) {
    const refTime = new Date(Date.now() - point.hours * 60 * 60 * 1000).toISOString();
    const actual = recencyScore(null, refTime, halfLife);
    const error = Math.abs(actual - point.expected);

    checkpoints.push({
      hoursElapsed: point.hours,
      expectedScore: point.expected,
      actualScore: actual,
      error,
      passed: error < 0.005, // allow 0.5% tolerance for floating point
    });
  }

  // Verify frequency saturation
  const freqAt0 = frequencyScore(0, 20);
  const freqAt1 = frequencyScore(1, 20);
  const freqAt20 = frequencyScore(20, 20);
  const freqAt100 = frequencyScore(100, 20);

  const freqCorrect =
    freqAt0 === 0 &&
    freqAt1 > 0 &&
    freqAt20 <= 1.0 &&
    freqAt100 === 1.0;

  // Verify distance mapping round-trip accuracy
  const testImportances = [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
  let totalError = 0;

  for (const imp of testImportances) {
    const dist = importanceToDistance(imp);
    const recovered = distanceToImportance(dist);
    totalError += Math.abs(imp - recovered);
  }

  const distanceMappingAccuracy = 1 - (totalError / testImportances.length);
  const allPassed = checkpoints.every(c => c.passed) && freqCorrect;

  return {
    name: 'Importance Decay Verification',
    passed: allPassed,
    details: checkpoints,
    distanceMappingAccuracy,
  };
}

export function formatDecayResult(result: DecayBenchmarkResult): void {
  console.log('\n=== Importance Decay Verification ===');
  console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`Distance mapping round-trip accuracy: ${(result.distanceMappingAccuracy * 100).toFixed(2)}%`);
  console.log('\nDecay curve checkpoints (halfLife=72h):');
  console.log('Hours | Expected | Actual  | Error   | Status');
  console.log('------|----------|---------|---------|-------');

  for (const c of result.details) {
    const hours = c.hoursElapsed.toString().padStart(5);
    const expected = c.expectedScore.toFixed(4).padStart(8);
    const actual = c.actualScore.toFixed(4).padStart(7);
    const error = c.error.toFixed(4).padStart(7);
    const status = c.passed ? 'OK' : 'FAIL';
    console.log(`${hours} | ${expected} | ${actual} | ${error} | ${status}`);
  }
}
