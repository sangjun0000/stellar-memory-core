import type { ZoneStat, OrbitZone } from '../api/client';

// ── Zone color palette ──────────────────────────────────────────────────────
const ZONE_COLORS: Record<OrbitZone, string> = {
  corona:    '#fbbf24',
  inner:     '#f97316',
  habitable: '#22c55e',
  outer:     '#60a5fa',
  kuiper:    '#a78bfa',
  oort:      '#9ca3af',
};

// Orbital radius hint — used to render the mini position dot on the bar rail.
// Values are 0-1, representing distance from centre.
const ZONE_RADIUS: Record<OrbitZone, number> = {
  corona:    0.04,
  inner:     0.18,
  habitable: 0.38,
  outer:     0.58,
  kuiper:    0.78,
  oort:      0.95,
};

const ZONE_LABELS: Record<OrbitZone, string> = {
  corona:    'Corona',
  inner:     'Inner',
  habitable: 'Habitable',
  outer:     'Outer',
  kuiper:    'Kuiper',
  oort:      'Oort',
};

// ── Props ───────────────────────────────────────────────────────────────────
interface ZoneStatsProps {
  zones: ZoneStat[];
  total: number;
  onZoneClick: (zone: OrbitZone | undefined) => void;
  activeZone: OrbitZone | undefined;
}

// ── Component ───────────────────────────────────────────────────────────────
export function ZoneStats({ zones, total, onZoneClick, activeZone }: ZoneStatsProps) {
  return (
    <div className="panel flex flex-col" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div className="panel-header flex items-center justify-between">
        <span>Orbital Zones</span>
        <span
          className="font-mono text-xs"
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: 'rgba(148,163,184,0.5)',
            fontSize: '10px',
            letterSpacing: '0.05em',
          }}
        >
          {total} total
        </span>
      </div>

      <div className="p-2 flex flex-col gap-1">
        {/* ── All zones button ── */}
        <button
          onClick={() => onZoneClick(undefined)}
          className="w-full flex items-center justify-between rounded transition-all"
          style={{
            padding: '8px 10px',
            fontSize: '12px',
            cursor: 'pointer',
            background:
              activeZone === undefined
                ? 'linear-gradient(135deg, rgba(96,165,250,0.12) 0%, rgba(96,165,250,0.06) 100%)'
                : 'transparent',
            border:
              activeZone === undefined
                ? '1px solid rgba(96,165,250,0.35)'
                : '1px solid transparent',
            boxShadow:
              activeZone === undefined
                ? '0 0 12px rgba(96,165,250,0.1), inset 0 0 12px rgba(96,165,250,0.04)'
                : 'none',
            color: activeZone === undefined ? '#e2e8f0' : 'rgba(148,163,184,0.6)',
          }}
          onMouseEnter={(e) => {
            if (activeZone !== undefined) {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
              (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1';
            }
          }}
          onMouseLeave={(e) => {
            if (activeZone !== undefined) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(148,163,184,0.6)';
            }
          }}
        >
          <div className="flex items-center gap-2">
            {/* Mini "all zones" icon — concentric rings */}
            <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, opacity: 0.7 }}>
              <circle cx="6" cy="6" r="1.5" fill="rgba(148,163,184,0.8)" />
              <circle cx="6" cy="6" r="3.5" fill="none" stroke="rgba(148,163,184,0.4)" strokeWidth="0.8" />
              <circle cx="6" cy="6" r="5.5" fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="0.6" />
            </svg>
            <span style={{ fontWeight: 500 }}>All zones</span>
          </div>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
            {total}
          </span>
        </button>

        {/* ── Per-zone buttons ── */}
        {zones.map((z) => {
          const color = ZONE_COLORS[z.zone];
          const radius = ZONE_RADIUS[z.zone];
          const label = ZONE_LABELS[z.zone];
          const pct = total > 0 ? (z.count / total) * 100 : 0;
          const isActive = activeZone === z.zone;

          return (
            <button
              key={z.zone}
              onClick={() => onZoneClick(z.zone)}
              className="w-full flex flex-col rounded transition-all"
              style={{
                padding: '8px 10px',
                gap: '6px',
                cursor: 'pointer',
                background: isActive
                  ? `linear-gradient(135deg, ${color}14 0%, ${color}08 100%)`
                  : 'transparent',
                border: isActive
                  ? `1px solid ${color}55`
                  : '1px solid transparent',
                boxShadow: isActive
                  ? `0 0 14px ${color}20, inset 0 0 12px ${color}08`
                  : 'none',
                color: isActive ? '#f1f5f9' : 'rgba(148,163,184,0.65)',
                fontSize: '12px',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.035)';
                  (e.currentTarget as HTMLButtonElement).style.border = `1px solid ${color}25`;
                  (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.border = '1px solid transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'rgba(148,163,184,0.65)';
                }
              }}
            >
              {/* Label row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Color dot with glow when active */}
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: color,
                      boxShadow: isActive ? `0 0 8px ${color}cc` : `0 0 4px ${color}66`,
                      transition: 'box-shadow 0.2s ease',
                    }}
                  />
                  <span style={{ fontWeight: 500 }}>{label}</span>
                </div>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
                  {z.count}
                </span>
              </div>

              {/* Progress bar + orbital position rail */}
              {z.count > 0 && (
                <div style={{ position: 'relative' }}>
                  {/* Background rail */}
                  <div
                    style={{
                      height: '3px',
                      borderRadius: '999px',
                      background: 'rgba(255,255,255,0.06)',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {/* Animated gradient fill */}
                    <div
                      style={{
                        height: '100%',
                        borderRadius: '999px',
                        width: `${pct}%`,
                        background: isActive
                          ? `linear-gradient(90deg, ${color}99, ${color}ff)`
                          : `linear-gradient(90deg, ${color}55, ${color}88)`,
                        boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                        transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1), background 0.2s ease, box-shadow 0.2s ease',
                        animation: 'zoneBarSlide 0.6s ease-out',
                      }}
                    />
                  </div>

                  {/* Orbital position indicator — tiny dot on a separate rail */}
                  <div
                    style={{
                      marginTop: '3px',
                      height: '2px',
                      position: 'relative',
                      opacity: 0.35,
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: `${radius * 100}%`,
                        top: '-1px',
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        backgroundColor: color,
                        transform: 'translateX(-50%)',
                        boxShadow: `0 0 4px ${color}`,
                      }}
                    />
                    {/* Orbit rail line */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: '1px',
                        height: '1px',
                        background: 'rgba(255,255,255,0.08)',
                        borderRadius: '999px',
                      }}
                    />
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
