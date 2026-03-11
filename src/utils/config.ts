import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
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

function detectProject(): string {
  const env = process.env['STELLAR_PROJECT'];
  if (env) return env;

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (gitRoot) return basename(gitRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50);
  } catch {
    // not a git repo — fall through
  }

  const dirName = basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50);
  return dirName || 'default';
}

function loadConfig(): StellarConfig {
  return {
    dbPath: resolveDbPath(),
    defaultProject: detectProject(),
    sunTokenBudget: parseInt_(process.env['STELLAR_SUN_TOKEN_BUDGET'], 800),
    decayHalfLifeHours: parseFloat_(process.env['STELLAR_DECAY_HALF_LIFE'], 72),
    // Frequency saturation: number of accesses at which frequency score plateaus
    frequencySaturationPoint: parseInt_(process.env['STELLAR_FREQ_SAT_POINT'], 50),
    // ACT-R adaptive stability
    stabilityGrowth:             parseFloat_(process.env['STELLAR_STABILITY_GROWTH'], 1.5),
    maxStabilityHours:           parseFloat_(process.env['STELLAR_MAX_STABILITY'], 8760),
    activationRecencyWeight:     parseFloat_(process.env['STELLAR_ACTIVATION_RECENCY_WEIGHT'], 0.6),
    activationFrequencyWeight:   parseFloat_(process.env['STELLAR_ACTIVATION_FREQUENCY_WEIGHT'], 0.4),
    // Retrieval scoring weights
    retrievalSemanticWeight:     parseFloat_(process.env['STELLAR_RETRIEVAL_SEMANTIC_WEIGHT'], 0.55),
    retrievalKeywordWeight:      parseFloat_(process.env['STELLAR_RETRIEVAL_KEYWORD_WEIGHT'], 0.25),
    retrievalProximityWeight:    parseFloat_(process.env['STELLAR_RETRIEVAL_PROXIMITY_WEIGHT'], 0.20),
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
