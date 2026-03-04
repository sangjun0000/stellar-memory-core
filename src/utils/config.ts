import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { StellarConfig } from '../engine/types.js';

function resolveDbPath(): string {
  const envPath = process.env['STELLAR_DB_PATH'];
  if (envPath) {
    // Ensure parent directory exists for custom paths too
    const dir = join(envPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return envPath;
  }

  const defaultDir = join(homedir(), '.stellar-memory');
  if (!existsSync(defaultDir)) {
    mkdirSync(defaultDir, { recursive: true });
  }
  return join(defaultDir, 'stellar.db');
}

function parseFloat_(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

function parseInt_(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(): StellarConfig {
  return {
    dbPath: resolveDbPath(),
    defaultProject: process.env['STELLAR_PROJECT'] ?? 'default',
    sunTokenBudget: parseInt_(process.env['STELLAR_SUN_TOKEN_BUDGET'], 800),
    decayHalfLifeHours: parseFloat_(process.env['STELLAR_DECAY_HALF_LIFE'], 72),
    // Frequency saturation: number of accesses at which frequency score plateaus
    frequencySaturationPoint: parseInt_(process.env['STELLAR_FREQ_SAT_POINT'], 20),
    weights: {
      recency:   parseFloat_(process.env['STELLAR_WEIGHT_RECENCY'],   0.30),
      frequency: parseFloat_(process.env['STELLAR_WEIGHT_FREQUENCY'], 0.20),
      impact:    parseFloat_(process.env['STELLAR_WEIGHT_IMPACT'],    0.30),
      relevance: parseFloat_(process.env['STELLAR_WEIGHT_RELEVANCE'], 0.20),
    },
  };
}

// Singleton config instance — loaded once at startup
let _config: StellarConfig | null = null;

export function getConfig(): StellarConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Allow tests to reset the singleton
export function resetConfig(): void {
  _config = null;
}
