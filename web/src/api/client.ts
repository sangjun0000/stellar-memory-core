// ---------------------------------------------------------------------------
// Types mirrored from the engine (no direct import to avoid bundling Node.js)
// ---------------------------------------------------------------------------

export type MemoryType = 'decision' | 'observation' | 'task' | 'context' | 'error' | 'milestone';
export type OrbitZone = 'corona' | 'inner' | 'habitable' | 'outer' | 'kuiper' | 'oort';

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
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:21547';

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

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMemories: (params?: { project?: string; zone?: OrbitZone; limit?: number }) =>
    get<{ data: Memory[]; total: number }>('/api/memories', params as Record<string, string | number | undefined>),

  getMemory: (id: string) =>
    get<{ data: Memory }>(`/api/memories/${id}`),

  searchMemories: (query: string, project?: string) =>
    get<{ data: Memory[]; total: number; query: string }>('/api/memories/search', { query, project }),

  createMemory: (body: {
    content: string;
    summary?: string;
    type?: MemoryType;
    project?: string;
    tags?: string[];
    impact?: number;
  }) => post<{ data: Memory }>('/api/memories', body),

  forgetMemory: (id: string) =>
    del<{ success: boolean; id: string }>(`/api/memories/${id}`),

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

  getSystemStatus: (project?: string) =>
    get<{ data: SystemStatus }>('/api/system/status', { project }),

  triggerOrbit: (project?: string) =>
    post<{ success: boolean; changes_count: number }>('/api/system/orbit' + qs({ project })),

  getZoneStats: (project?: string) =>
    get<{ data: ZoneStat[] }>('/api/system/zones', { project }),
};
