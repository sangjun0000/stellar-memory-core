// ---------------------------------------------------------------------------
// Types mirrored from the engine (no direct import to avoid bundling Node.js)
// ---------------------------------------------------------------------------

export type MemoryType = 'decision' | 'observation' | 'task' | 'context' | 'error' | 'milestone' | 'procedural';
export type OrbitZone = 'core' | 'near' | 'active' | 'archive' | 'fading' | 'forgotten';

export interface Memory {
  id: string;
  project: string;
  content: string;
  summary: string;
  type: MemoryType;
  tags: string[];
  distance: number;
  importance: number;
  velocity: number;
  impact: number;
  access_count: number;
  last_accessed_at: string | null;
  source_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Temporal fields
  valid_from?: string | null;
  valid_until?: string | null;
  superseded_by?: string | null;
  consolidated_into?: string | null;
  // Quality / universal
  quality_score?: number | null;
  is_universal?: boolean;
}

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

export interface ZoneStat {
  zone: OrbitZone;
  label: string;
  min_au: number;
  max_au: number;
  count: number;
  avg_importance: number;
}

export interface SystemStatus {
  project: string;
  memory_count: number;
  db_size_bytes: number;
  db_path: string;
  zone_breakdown: Record<OrbitZone, number>;
  last_orbit_at?: string | null;
}

export interface DataSource {
  id: string;
  path: string;
  status: 'active' | 'inactive' | 'error';
  file_count: number;
  last_scanned_at: string | null;
  error?: string;
}

export type RelationType = 'uses' | 'caused_by' | 'part_of' | 'contradicts' | 'supersedes' | 'related_to' | 'depends_on' | 'derived_from';

export interface ConstellationEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: RelationType;
  weight: number;
  project: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface ConstellationGraph {
  nodes: Memory[];
  edges: ConstellationEdge[];
}

// ---------------------------------------------------------------------------
// New types — multi-project, conflicts, consolidation, analytics
// ---------------------------------------------------------------------------

export interface MemoryConflict {
  id: string;
  memory_id: string;
  conflicting_memory_id: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution?: string;
  project: string;
  created_at: string;
  resolved_at?: string;
}

export interface ObservationEntry {
  id: string;
  content: string;
  extracted_memories: string[];
  source: 'conversation' | 'reflection';
  project: string;
  created_at: string;
}

export interface ProjectInfo {
  project: string;
  memoryCount: number;
  lastUpdated?: string;
  hasUniversal?: boolean;
}

export interface MemoryHealth {
  totalMemories: number;
  activeRatio: number;
  staleRatio: number;
  qualityAvg: number;
  conflictRatio: number;
  consolidationOpportunities: number;
  recommendations: string[];
}

export interface TopicCluster {
  topic: string;
  memoryCount: number;
  avgImportance: number;
  avgDistance: number;
  recentActivity: number;
}

export interface SurvivalPoint {
  ageInDays: number;
  survivingCount: number;
  accessedCount: number;
  forgottenCount: number;
}

export interface AnalyticsOverview {
  total_memories: number;
  zone_distribution: Record<string, number>;
  type_distribution: Record<string, number>;
  avg_quality: number;
  avg_importance: number;
  recall_success_rate: number;
  consolidation_count: number;
  conflict_count: number;
  top_tags: Array<{ tag: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}${qs(params)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Memories
  getMemories: (params?: { project?: string; zone?: OrbitZone; limit?: number; summary_only?: string }) =>
    get<{ data: Memory[]; total: number }>('/api/memories', params as Record<string, string | number | undefined>),

  getMemory: (id: string) =>
    get<{ data: Memory }>(`/api/memories/${id}`),

  searchMemories: (
    query: string,
    project?: string,
    type?: MemoryType,
    zone?: OrbitZone,
  ) =>
    get<{ data: Memory[]; total: number; query: string }>(
      '/api/memories/search',
      { q: query, project, type, zone } as Record<string, string | undefined>,
    ),

  createMemory: (body: {
    content: string;
    summary?: string;
    type?: MemoryType;
    project?: string;
    tags?: string[];
    impact?: number;
  }) => post<{ data: Memory }>('/api/memories', body),

  updateOrbit: (id: string, distance: number) =>
    patch<{ ok: boolean; data: { id: string; new_distance: number; new_importance: number } }>(
      `/api/memories/${id}/orbit`,
      { distance },
    ),

  forgetMemory: (id: string) =>
    del<{ ok: boolean; id: string }>(`/api/memories/${id}`),

  // Sun
  getSun: (project?: string) =>
    get<{ data: SunState | null }>('/api/sun', { project }),

  commitSun: (body: {
    project?: string;
    current_work: string;
    decisions?: string[];
    next_steps?: string[];
    errors?: string[];
    context?: string;
  }) => post<{ data: SunState; success: boolean }>('/api/sun/commit', body),

  // System
  getSystemStatus: (project?: string) =>
    get<{ data: SystemStatus }>('/api/system/status', { project }),

  triggerOrbit: (project?: string) =>
    post<{ success: boolean; changes_count: number }>('/api/system/orbit' + qs({ project })),

  getZoneStats: (project?: string) =>
    get<{ data: ZoneStat[] }>('/api/system/zones', { project }),

  // Data sources
  getDataSources: (project?: string) =>
    get<{ data: DataSource[] }>('/api/sources', { project }),

  // Constellation
  getConstellation: (id: string, project?: string, depth?: number) =>
    get<{ ok: boolean; data: ConstellationGraph }>(
      `/api/constellation/${id}`,
      { project, depth } as Record<string, string | number | undefined>,
    ),

  getRelatedMemories: (id: string, project?: string, limit?: number) =>
    get<{ ok: boolean; data: Memory[]; total: number }>(
      `/api/constellation/${id}/related`,
      { project, limit } as Record<string, string | number | undefined>,
    ),

  // Projects
  listProjects: () =>
    get<{ data: ProjectInfo[]; current_project: string }>('/api/projects'),

  switchProject: (name: string) =>
    post<{ ok: boolean; data: { previous: string; current: string; memoryCount: number } }>('/api/projects/switch', { project: name }),

  createProject: (name: string) =>
    post<{ ok: boolean; data: ProjectInfo }>('/api/projects', { name }),

  markUniversal: (id: string, isUniversal: boolean) =>
    post<{ ok: boolean; id: string; is_universal: boolean }>(`/api/projects/universal/${id}`, { is_universal: isUniversal }),

  // Conflicts
  getConflicts: (project?: string) =>
    get<{ data: MemoryConflict[]; total: number }>('/api/conflicts', { project }),

  getConflictsForMemory: (memoryId: string) =>
    get<{ data: MemoryConflict[]; total: number }>(`/api/conflicts/${memoryId}`),

  resolveConflict: (id: string, resolution: string, action: string) =>
    post<{ ok: boolean }>(`/api/conflicts/${id}/resolve`, { resolution, action }),

  dismissConflict: (id: string) =>
    post<{ ok: boolean }>(`/api/conflicts/${id}/dismiss`),

  // Consolidation
  getConsolidationCandidates: (project?: string) =>
    get<{ data: Array<{ memories: Memory[]; similarity: number }>; total: number }>('/api/consolidation/candidates', { project }),

  runConsolidation: (project?: string) =>
    post<{ ok: boolean; data: { groupsFound: number; memoriesConsolidated: number; newMemoriesCreated: number } }>('/api/consolidation/run', { project }),

  // Temporal
  getContextAtTime: (timestamp: string, project?: string) =>
    get<{ data: Memory[] }>('/api/temporal/at', { timestamp, project }),

  getEvolutionChain: (id: string) =>
    get<{ data: Memory[] }>(`/api/temporal/chain/${id}`),

  // Observations
  getObservations: (project?: string, limit?: number) =>
    get<{ data: ObservationEntry[]; total: number }>('/api/observations', { project, limit }),

  // Analytics
  getAnalyticsOverview: (project?: string) =>
    get<{ data: AnalyticsOverview }>('/api/analytics/overview', { project }),

  getMemoryHealth: (project?: string) =>
    get<{ data: MemoryHealth }>('/api/analytics/health', { project }),

  getSurvivalCurve: (project?: string) =>
    get<{ data: SurvivalPoint[] }>('/api/analytics/survival', { project }),

  getTopicClusters: (project?: string) =>
    get<{ data: TopicCluster[] }>('/api/analytics/clusters', { project }),

  // Full Scan (onboarding)
  startFullScan: (config: { mode: 'full' | 'folders'; paths?: string[]; includeGit?: boolean }) =>
    fetch(`${BASE_URL}/api/scan/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  // Meta Scan (quick scan — metadata only)
  startMetaScan: (config: { paths?: string[] }) =>
    fetch(`${BASE_URL}/api/scan/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  getScanStatus: () =>
    get<{ data: { isScanning: boolean; startedAt?: number; progress?: { scannedFiles: number; createdMemories: number; totalFiles: number; currentFile: string; percentComplete: number } } }>('/api/scan/status'),

  cancelScan: () =>
    post<{ ok: boolean; message?: string }>('/api/scan/cancel'),
};
