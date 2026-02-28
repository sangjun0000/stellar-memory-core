import type { ZoneStat, OrbitZone } from '../api/client';

const ZONE_COLORS: Record<OrbitZone, string> = {
  corona:    '#fbbf24',
  inner:     '#f97316',
  habitable: '#22c55e',
  outer:     '#60a5fa',
  kuiper:    '#a78bfa',
  oort:      '#9ca3af',
};

interface ZoneStatsProps {
  zones: ZoneStat[];
  total: number;
  onZoneClick: (zone: OrbitZone | undefined) => void;
  activeZone: OrbitZone | undefined;
}

export function ZoneStats({ zones, total, onZoneClick, activeZone }: ZoneStatsProps) {
  return (
    <div className="panel flex flex-col">
      <div className="panel-header">Orbital Zones</div>
      <div className="p-3 space-y-1.5">
        {/* All zones filter */}
        <button
          onClick={() => onZoneClick(undefined)}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
            activeZone === undefined
              ? 'bg-gray-700 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          }`}
        >
          <span>All zones</span>
          <span className="font-mono">{total}</span>
        </button>

        {zones.map((z) => {
          const color = ZONE_COLORS[z.zone];
          const pct = total > 0 ? (z.count / total) * 100 : 0;

          return (
            <button
              key={z.zone}
              onClick={() => onZoneClick(z.zone)}
              className={`w-full flex flex-col gap-1 px-2 py-1.5 rounded text-xs transition-colors ${
                activeZone === z.zone
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="capitalize">{z.zone}</span>
                </div>
                <span className="font-mono">{z.count}</span>
              </div>
              {z.count > 0 && (
                <div className="h-0.5 bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
