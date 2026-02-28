// Memory types
export type MemoryType = 'decision' | 'observation' | 'task' | 'context' | 'error' | 'milestone';

// Orbit zones
export const ORBIT_ZONES = {
  corona:    { min: 0.1,  max: 1.0,  label: 'Corona (Working Memory)' },
  inner:     { min: 1.0,  max: 5.0,  label: 'Inner Planets (Recent & Important)' },
  habitable: { min: 5.0,  max: 15.0, label: 'Habitable Zone (Active Knowledge)' },
  outer:     { min: 15.0, max: 40.0, label: 'Outer Planets (Background Knowledge)' },
  kuiper:    { min: 40.0, max: 70.0, label: 'Kuiper Belt (Fading Memories)' },
  oort:      { min: 70.0, max: 100.0, label: 'Oort Cloud (Nearly Forgotten)' },
} as const;

export type OrbitZone = keyof typeof ORBIT_ZONES;

// Default impact by memory type
export const IMPACT_DEFAULTS: Record<MemoryType, number> = {
  decision:    0.8,
  milestone:   0.7,
  error:       0.6,
  task:        0.5,
  context:     0.4,
  observation: 0.3,
};

// Importance weights
export const DEFAULT_WEIGHTS = {
  recency:   0.30,
  frequency: 0.20,
  impact:    0.30,
  relevance: 0.20,
} as const;

// Memory interface
export interface Memory {
  id: string;
  project: string;
  content: string;
  summary: string;
  type: MemoryType;
  tags: string[];           // stored as JSON string in DB
  distance: number;
  importance: number;
  velocity: number;
  impact: number;
  access_count: number;
  last_accessed_at: string | null;
  metadata: Record<string, unknown>;  // stored as JSON string in DB
  source: string | null;              // 'manual' | 'scanner' | etc.
  source_path: string | null;         // absolute file path (for scanner-created memories)
  source_hash: string | null;         // mtime-based hash for dedup
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Phase 2: optional in-memory embedding (not persisted in memories table)
  embedding?: Float32Array;
}

// Vector search result returned by searchByVector in vec.ts
export interface VectorSearchResult {
  memoryId: string;
  distance: number;        // L2 distance from sqlite-vec (lower = more similar)
}

// Sun state interface
export interface SunState {
  project: string;
  content: string;
  current_work: string;
  recent_decisions: string[];
  next_steps: string[];
  active_errors: string[];
  project_context: string;
  token_count: number;
  last_commit_at: string | null;
  updated_at: string;
}

// Orbit change record
export interface OrbitChange {
  memory_id: string;
  project: string;
  old_distance: number;
  new_distance: number;
  old_importance: number;
  new_importance: number;
  trigger: 'decay' | 'access' | 'commit' | 'manual' | 'gravity' | 'forget';
}

// Importance scoring components
export interface ImportanceComponents {
  recency: number;
  frequency: number;
  impact: number;
  relevance: number;
  total: number;
}

// Stellar config
export interface StellarConfig {
  dbPath: string;
  defaultProject: string;
  sunTokenBudget: number;
  decayHalfLifeHours: number;
  frequencySaturationPoint: number;
  weights: {
    recency: number;
    frequency: number;
    impact: number;
    relevance: number;
  };
}
