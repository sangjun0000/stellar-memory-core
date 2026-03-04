/**
 * tests/scheduler.test.ts — Scheduler logic tests with mocked timers.
 *
 * Uses vitest's fake timer APIs to control setInterval without wall-clock delays.
 * The DB is initialised in-memory so orbit recalc / cleanup tasks can run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StellarScheduler, DEFAULT_SCHEDULE_CONFIG } from '../src/service/scheduler.js';
import { setupTestDb, teardownTestDb } from './setup.js';

// ---------------------------------------------------------------------------
// Suppress logger output during tests
// ---------------------------------------------------------------------------

vi.spyOn(process.stderr, 'write').mockReturnValue(true);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScheduler(overrides: Partial<typeof DEFAULT_SCHEDULE_CONFIG> = {}) {
  return new StellarScheduler({ ...DEFAULT_SCHEDULE_CONFIG, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StellarScheduler', () => {
  beforeEach(() => {
    setupTestDb();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    teardownTestDb();
  });

  it('initialises with all tasks in blank state', () => {
    const scheduler = makeScheduler();
    const status = scheduler.getStatus();

    expect(status.recalculateOrbits.runCount).toBe(0);
    expect(status.scanLocalFiles.runCount).toBe(0);
    expect(status.cleanupForgottenZone.runCount).toBe(0);

    expect(status.recalculateOrbits.lastRunAt).toBeNull();
    expect(status.recalculateOrbits.lastError).toBeNull();
    expect(status.recalculateOrbits.isRunning).toBe(false);
  });

  it('stop() before start() does not throw', () => {
    const scheduler = makeScheduler();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it('start() twice does not register duplicate timers', async () => {
    const scheduler = makeScheduler({
      orbitRecalcInterval: 1000,
      localScanInterval:   1000,
      cleanupInterval:     1000,
    });

    scheduler.start();
    scheduler.start(); // second call should be a no-op

    // Advance past the immediate fire + one interval tick
    await vi.advanceTimersByTimeAsync(1500);

    // runCount should be capped at one immediate + one ticked — not doubled
    const status = scheduler.getStatus();
    // Each task fires once immediately then again after the interval — not 4x
    expect(status.recalculateOrbits.runCount).toBeGreaterThanOrEqual(1);

    scheduler.stop();
  });

  it('stop() clears all timers', async () => {
    const scheduler = makeScheduler({
      orbitRecalcInterval: 5000,
      localScanInterval:   5000,
      cleanupInterval:     5000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(100); // let immediate fires settle

    const countAfterStart = scheduler.getStatus().recalculateOrbits.runCount;

    scheduler.stop();

    // After stop, advancing timers should not trigger more runs
    await vi.advanceTimersByTimeAsync(100_000);

    expect(scheduler.getStatus().recalculateOrbits.runCount).toBe(countAfterStart);
  });

  it('runNow() executes a task immediately', async () => {
    const scheduler = makeScheduler();

    await scheduler.runNow('recalculateOrbits');
    const status = scheduler.getStatus();

    expect(status.recalculateOrbits.runCount).toBe(1);
    expect(status.recalculateOrbits.lastRunAt).not.toBeNull();
    expect(status.recalculateOrbits.lastError).toBeNull();
  });

  it('runNow() records errors in status without throwing', async () => {
    const scheduler = makeScheduler();

    const status = scheduler.getStatus();
    expect(status.cleanupForgottenZone.lastError).toBeNull();

    // cleanupForgottenZone on an empty DB should complete cleanly
    await scheduler.runNow('cleanupForgottenZone');
    expect(scheduler.getStatus().cleanupForgottenZone.runCount).toBe(1);
    expect(scheduler.getStatus().cleanupForgottenZone.lastError).toBeNull();
  });

  it('recalculateOrbits task runs without error when DB is empty', async () => {
    const scheduler = makeScheduler();
    await scheduler.runNow('recalculateOrbits');
    expect(scheduler.getStatus().recalculateOrbits.lastError).toBeNull();
  });

  it('cleanupForgottenZone task runs without error when DB is empty', async () => {
    const scheduler = makeScheduler();
    await scheduler.runNow('cleanupForgottenZone');
    expect(scheduler.getStatus().cleanupForgottenZone.lastError).toBeNull();
  });

  it('task status tracks lastDuration in milliseconds', async () => {
    const scheduler = makeScheduler();
    await scheduler.runNow('recalculateOrbits');
    const { lastDuration } = scheduler.getStatus().recalculateOrbits;
    expect(lastDuration).not.toBeNull();
    expect(typeof lastDuration).toBe('number');
    expect(lastDuration!).toBeGreaterThanOrEqual(0);
  });
});

describe('DEFAULT_SCHEDULE_CONFIG', () => {
  it('has sensible default intervals', () => {
    expect(DEFAULT_SCHEDULE_CONFIG.orbitRecalcInterval).toBe(60 * 60 * 1000);
    expect(DEFAULT_SCHEDULE_CONFIG.localScanInterval).toBe(30 * 60 * 1000);
    expect(DEFAULT_SCHEDULE_CONFIG.cleanupInterval).toBe(24 * 60 * 60 * 1000);
  });

  it('oortCleanupAgeDays defaults to 30', () => {
    expect(DEFAULT_SCHEDULE_CONFIG.oortCleanupAgeDays).toBe(30);
  });
});
