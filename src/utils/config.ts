import { homedir, totalmem, platform } from 'node:os';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type { StellarConfig } from '../engine/types.js';

// Shape of ~/.stellar-memory/config.json (written by `init`)
interface UserConfig {
  device?: 'cpu' | 'gpu';
  queryCacheSize?: number;
  ramPercent?: number;
}

function loadUserConfig(): UserConfig {
  const configPath = join(homedir(), '.stellar-memory', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as UserConfig;
  } catch {
    return {};
  }
}

/**
 * Map the user-friendly "gpu" device choice to the platform-specific backend.
 * Windows uses DirectML; Linux/macOS use CUDA.
 */
function resolveDeviceFromUserConfig(device: 'cpu' | 'gpu'): string {
  if (device === 'cpu') return 'cpu';
  return platform() === 'win32' ? 'dml' : 'cuda';
}

/**
 * Auto-detect RAM allocation: 5% of system RAM, clamped to [64, 2048] MB.
 */
function autoDetectCacheMb(): number {
  const totalMb = Math.floor(totalmem() / (1024 * 1024));
  const fivePercent = Math.floor(totalMb * 0.05);
  return Math.max(64, Math.min(2048, fivePercent));
}


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
  // Read user config written by `init` (~/.stellar-memory/config.json).
  // Env vars always take precedence over config.json values.
  const userCfg = loadUserConfig();

  // RAM cache: env → config.json ramPercent → auto-detect 5%
  const cacheMbDefault = userCfg.ramPercent != null
    ? Math.max(64, Math.min(2048, Math.floor(totalmem() / (1024 * 1024) * userCfg.ramPercent / 100)))
    : autoDetectCacheMb();

  // Embedding device: env → config.json device → cpu (safe default)
  let embeddingDevice: string;
  if (process.env['STELLAR_EMBEDDING_DEVICE']) {
    embeddingDevice = process.env['STELLAR_EMBEDDING_DEVICE'];
  } else if (userCfg.device != null) {
    embeddingDevice = resolveDeviceFromUserConfig(userCfg.device);
  } else {
    embeddingDevice = 'cpu';
  }

  return {
    dbPath: resolveDbPath(),
    defaultProject: detectProject(),
    sunTokenBudget: parseInt_(process.env['STELLAR_SUN_TOKEN_BUDGET'], 800),
    decayHalfLifeHours: parseFloat_(process.env['STELLAR_DECAY_HALF_LIFE'], 72),
    // Frequency saturation: number of accesses at which frequency score plateaus
    frequencySaturationPoint: parseInt_(process.env['STELLAR_FREQ_SAT_POINT'], 50),
    // Phase 1: 3-factor formula weights
    weightRecency:        parseFloat_(process.env['STELLAR_WEIGHT_RECENCY_V2'],    0.35),
    weightFrequency:      parseFloat_(process.env['STELLAR_WEIGHT_FREQUENCY_V2'], 0.25),
    weightIntrinsic:      parseFloat_(process.env['STELLAR_WEIGHT_INTRINSIC'],     0.40),
    frequencyDecayHours:  parseFloat_(process.env['STELLAR_FREQ_DECAY_HOURS'],     168),
    cacheMb:             parseInt_(process.env['STELLAR_CACHE_MB'], cacheMbDefault),
    // Retrieval scoring weights
    retrievalSemanticWeight:     parseFloat_(process.env['STELLAR_RETRIEVAL_SEMANTIC_WEIGHT'], 0.55),
    retrievalKeywordWeight:      parseFloat_(process.env['STELLAR_RETRIEVAL_KEYWORD_WEIGHT'], 0.25),
    retrievalProximityWeight:    parseFloat_(process.env['STELLAR_RETRIEVAL_PROXIMITY_WEIGHT'], 0.20),
    // Legacy weights (deprecated, kept for backward compatibility)
    weights: {
      recency:   parseFloat_(process.env['STELLAR_WEIGHT_RECENCY'],   0.30),
      frequency: parseFloat_(process.env['STELLAR_WEIGHT_FREQUENCY'], 0.20),
      impact:    parseFloat_(process.env['STELLAR_WEIGHT_IMPACT'],    0.30),
      relevance: parseFloat_(process.env['STELLAR_WEIGHT_RELEVANCE'], 0.20),
    },
    // Embedding configuration
    embeddingDevice,
    embeddingModel: process.env['STELLAR_EMBEDDING_MODEL'] ?? 'Xenova/bge-m3',
    // Query embedding LRU cache: env → config.json → default 128
    queryCacheSize: parseInt_(process.env['STELLAR_QUERY_CACHE_SIZE'], userCfg.queryCacheSize ?? 128),
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
