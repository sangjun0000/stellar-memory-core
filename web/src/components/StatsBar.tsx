import type { ZoneStat, OrbitZone } from '../api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZONE_COLORS: Record<OrbitZone, string> = {
  corona:    '#fbbf24',
  inner:     '#f97316',
  habitable: '#22c55e',
  outer:     '#60a5fa',
  kuiper:    '#a78bfa',
  oort:      '#9ca3af',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatsBarProps {
  totalMemories: number;
  zones: ZoneStat[];
  lastOrbitAt?: string | null;
  lastUpdatedAt?: number | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatsBar({
  totalMemories,
  zones,
  lastOrbitAt,
  lastUpdatedAt,
  onRefresh,
  isRefreshing,
}: StatsBarProps) {
  const updatedLabel = lastUpdatedAt
    ? formatRelative(new Date(lastUpdatedAt).toISOString())
    : null;

  return (
    <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 bg-space-900 border-b border-gray-800 text-xs text-gray-400 overflow-x-auto">
      {/* Total memories */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-gray-600">Memories</span>
        <span className="font-mono text-gray-200 font-semibold">{totalMemories}</span>
      </div>

      <span className="text-gray-700" aria-hidden="true">|</span>

      {/* Zone breakdown */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {zones.map((z) => (
          <div key={z.zone} className="flex items-center gap-1">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: ZONE_COLORS[z.zone] }}
              aria-hidden="true"
            />
            <span className="capitalize text-gray-500">{z.zone}</span>
            <span className="font-mono text-gray-300">{z.count}</span>
          </div>
        ))}
      </div>

      {/* Orbit recalc timestamp */}
      {lastOrbitAt !== undefined && (
        <>
          <span className="text-gray-700 shrink-0" aria-hidden="true">|</span>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-gray-600">Orbit recalc:</span>
            <span className="text-gray-400">{formatRelative(lastOrbitAt)}</span>
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Last updated + manual refresh */}
      <div className="flex items-center gap-2 shrink-0">
        {updatedLabel && (
          <span className="text-gray-600">Updated {updatedLabel}</span>
        )}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Refresh data"
        >
          <span
            className={isRefreshing ? 'animate-spin inline-block' : 'inline-block'}
            aria-hidden="true"
          >
            &#8635;
          </span>
          Refresh
        </button>
      </div>
    </div>
  );
}
