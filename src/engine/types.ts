// Memory types
export type MemoryType = 'decision' | 'observation' | 'task' | 'context' | 'error' | 'milestone' | 'procedural';

// Orbit zones — 4-zone system (Phase 1)
export const ORBIT_ZONES = {
  core:      { min: 0.1,  max: 3.0,  label: 'Core Memory' },
  near:      { min: 3.0,  max: 15.0, label: 'Recent Memory' },
  stored:    { min: 15.0, max: 60.0, label: 'Stored Memory' },
  forgotten: { min: 60.0, max: 100.0, label: 'Forgotten Memory' },
} as const;

export type OrbitZone = keyof typeof ORBIT_ZONES;

// Intrinsic value defaults by memory type (Phase 1)
export const INTRINSIC_DEFAULTS: Record<MemoryType, number> = {
  procedural:  0.85,
  decision:    0.80,
  milestone:   0.70,
  error:       0.65,
  task:        0.50,
  context:     0.40,
  observation: 0.30,
};

// Deprecated alias — kept for backward compatibility
export const IMPACT_DEFAULTS: Record<MemoryType, number> = INTRINSIC_DEFAULTS;

export type MemoryValidityState = 'active' | 'future' | 'expired' | 'superseded';

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
  // Phase 1: intrinsic value override (NULL = use INTRINSIC_DEFAULTS[type])
  intrinsic?: number | null;
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

// Importance scoring components (Phase 1 simplified)
export interface ImportanceComponents {
  // Primary sub-components
  recency: number;
  frequency: number;
  intrinsic: number;
  effectiveCount: number;
  total: number;
  // Deprecated aliases — kept for backward compatibility with callers
  frequencyFactor: number;
  effectiveHalflife: number;
  activation: number;
  contentWeight: number;
  qualityModifier: number;
  impact: number;
  relevance: number;
}

// Knowledge Graph -- Constellation
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
  // Phase 1: 3-factor formula weights
  weightRecency: number;           // default 0.35
  weightFrequency: number;         // default 0.25
  weightIntrinsic: number;         // default 0.40
  frequencyDecayHours: number;     // half-life for effective count (default 168h = 7 days)
  cacheMb: number;                 // RAM allocation for corona cache in MB (default: auto 5% of system RAM)
  // Retrieval scoring weights (used during recall, separate from storage importance)
  retrievalSemanticWeight: number;   // weight of semantic similarity (default 0.55)
  retrievalKeywordWeight: number;    // weight of keyword overlap (default 0.25)
  retrievalProximityWeight: number;  // weight of orbital proximity bonus (default 0.20)
  // Legacy weights object (deprecated, kept for backward compatibility)
  weights: {
    recency: number;
    frequency: number;
    impact: number;
    relevance: number;
  };
  // Embedding configuration
  embeddingDevice: string;   // 'cpu' | 'cuda' | 'dml' (default: 'cpu')
  embeddingModel: string;    // model name (default: 'Xenova/bge-m3')
  queryCacheSize: number;    // LRU cache size for query embeddings (default: 128)
}
