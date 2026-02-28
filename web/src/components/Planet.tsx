import type { MemoryType } from '../api/client';

// Color palette — accessible (blue-orange family + distinct hues)
// Shared across 3D planets, detail panel, legend
export const MEMORY_COLORS: Record<MemoryType, string> = {
  decision:    '#2563eb',
  error:       '#dc2626',
  task:        '#16a34a',
  observation: '#6b7280',
  milestone:   '#eab308',
  context:     '#7c3aed',
};
