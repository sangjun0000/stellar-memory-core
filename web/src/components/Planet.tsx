import type { MemoryType } from '../api/client';

// Color palette — vibrant/neon variants for high contrast on dark space backgrounds
// Shared across 3D planets, detail panel, legend
export const MEMORY_COLORS: Record<MemoryType, string> = {
  decision:    '#3b82f6', // blue-500  — clear, authoritative
  error:       '#ef4444', // red-500   — vivid, urgent
  task:        '#22c55e', // green-500 — bright, active
  observation: '#94a3b8', // slate-400 — neutral, quiet
  milestone:   '#f59e0b', // amber-500 — gold, celebratory
  context:     '#8b5cf6', // violet-500 — rich purple
};
