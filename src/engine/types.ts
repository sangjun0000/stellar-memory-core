// Memory types
export type MemoryType = 'decision' | 'observation' | 'task' | 'context' | 'error' | 'milestone' | 'procedural';

// Orbit zones
export const ORBIT_ZONES = {
  core:      { min: 0.1,  max: 1.0,  label: 'Core Memory' },
  near:      { min: 1.0,  max: 5.0,  label: 'Recent Memory' },
  active:    { min: 5.0,  max: 15.0, label: 'Active Memory' },
  archive:   { min: 15.0, max: 40.0, label: 'Stored Memory' },
  fading:    { min: 40.0, max: 70.0, label: 'Fading Memory' },
  forgotten: { min: 70.0, max: 100.0, label: 'Forgotten Memory' },
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
  procedural:  0.5,
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
  content_hash: string | null;        // SHA-256 of content for content-level deduplication
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Phase 2: optional in-memory embedding (not persisted in memories table)
  embedding?: Float32Array;
  // Temporal awareness
  valid_from?: string;
  valid_until?: string;
  superseded_by?: string;
  // Consolidation
  consolidated_into?: string;
  // Quality scoring
  quality_score?: number;
  // Multi-project
  is_universal?: boolean;
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
  // Sub-components
  recency: number;
  frequencyFactor: number;
  effectiveHalflife: number;
  // Composite scores
  activation: number;
  contentWeight: number;
  qualityModifier: number;
  // Legacy aliases (kept for backward compatibility with callers)
  frequency: number;
  impact: number;
  relevance: number;
  total: number;
}

// Knowledge Graph — Constellation
export type RelationType = 'uses' | 'caused_by' | 'part_of' | 'contradicts' | 'supersedes' | 'related_to' | 'depends_on' | 'derived_from';

export interface ConstellationEdge {
  id: string;
  source_id: string;       // memory ID
  target_id: string;       // memory ID
  relation: RelationType;
  weight: number;           // 0.0-1.0
  project: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

// Temporal Awareness
export interface TemporalInfo {
  valid_from?: string;      // ISO date — when this fact became true
  valid_until?: string;     // ISO date — when this fact stopped being true
  superseded_by?: string;   // memory ID that replaced this one
}

// Conflict Detection
export interface MemoryConflict {
  id: string;
  memory_id: string;        // the new memory
  conflicting_memory_id: string;  // the existing memory it conflicts with
  severity: 'high' | 'medium' | 'low';
  description: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution?: string;
  project: string;
  created_at: string;
  resolved_at?: string;
}

// Quality Scoring
export interface QualityScore {
  overall: number;          // 0.0-1.0
  specificity: number;      // detail level
  actionability: number;    // can be acted upon
  uniqueness: number;       // how different from others
  freshness: number;        // recently verified
}

// Memory Analytics
export interface MemoryAnalytics {
  total_memories: number;
  zone_distribution: Record<string, number>;
  type_distribution: Record<string, number>;
  avg_quality: number;
  avg_importance: number;
  recall_success_rate: number;
  consolidation_count: number;
  conflict_count: number;
  top_tags: Array<{ tag: string; count: number }>;
  activity_timeline: Array<{ date: string; created: number; accessed: number; forgotten: number }>;
}

// Observation Log
export interface ObservationEntry {
  id: string;
  content: string;
  extracted_memories: string[];   // IDs of memories created
  source: 'conversation' | 'reflection';
  project: string;
  created_at: string;
}

// Stellar config
export interface StellarConfig {
  dbPath: string;
  defaultProject: string;
  sunTokenBudget: number;
  decayHalfLifeHours: number;
  frequencySaturationPoint: number;
  // ACT-R adaptive stability parameters
  stabilityGrowth: number;       // exponent base for half-life growth per access (default 1.5)
  maxStabilityHours: number;     // cap on effective half-life in hours (default 8760 = 1 year)
  activationRecencyWeight: number;   // weight of recency in activation (default 0.6)
  activationFrequencyWeight: number; // weight of frequency in activation (default 0.4)
  // Retrieval scoring weights (used during recall, separate from storage importance)
  retrievalSemanticWeight: number;   // weight of semantic similarity (default 0.55)
  retrievalKeywordWeight: number;    // weight of keyword overlap (default 0.25)
  retrievalProximityWeight: number;  // weight of orbital proximity bonus (default 0.20)
  weights: {
    recency: number;
    frequency: number;
    impact: number;
    relevance: number;
  };
}
