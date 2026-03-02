import { useEffect, useState, useRef } from 'react';
import type { ZoneStat, OrbitZone } from '../api/client';
import { useTranslation } from '../i18n/context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZONE_COLORS: Record<OrbitZone, string> = {
  core:      '#fbbf24',
  near:      '#f97316',
  active:    '#22c55e',
  archive:   '#60a5fa',
  fading:    '#a78bfa',
  forgotten: '#9ca3af',
};

const ZONE_ORDER: OrbitZone[] = ['core', 'near', 'active', 'archive', 'fading', 'forgotten'];

// ---------------------------------------------------------------------------
// CSS — once per page
// ---------------------------------------------------------------------------

const STATS_CSS = `
@keyframes statsbar-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
@keyframes statsbar-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes statsbar-gradient-slide {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes statsbar-count-pop {
  0%   { transform: scale(0.85); opacity: 0.6; }
  60%  { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}
`;

function injectStatsCss() {
  if (document.getElementById('statsbar-css')) return;
  const el = document.createElement('style');
  el.id = 'statsbar-css';
  el.textContent = STATS_CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatsBarProps {
  totalMemories:    number;
  zones:            ZoneStat[];
  lastOrbitAt?:     string | null;
  lastUpdatedAt?:   number | null;
  onRefresh:        () => void;
  isRefreshing:     boolean;
  // Optional enriched stats
  avgQuality?:      number | null;
  conflictCount?:   number;
  proceduralCount?: number;
  universalCount?:  number;
}

// ---------------------------------------------------------------------------
// Zone pill badge
// ---------------------------------------------------------------------------

function ZonePill({ zone, count }: { zone: ZoneStat; count: number }) {
  const { t } = useTranslation();
  const color = ZONE_COLORS[zone.zone];
  const [hovered, setHovered] = useState(false);

  if (count === 0) return null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${t.zones[zone.zone]?.name ?? zone.label}: avg importance ${(zone.avg_importance * 100).toFixed(0)}%`}
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '5px',
        padding:      '2px 8px 2px 6px',
        borderRadius: '999px',
        background:   hovered ? `${color}28` : `${color}14`,
        border:       `1px solid ${color}${hovered ? '66' : '33'}`,
        boxShadow:    hovered ? `0 0 10px ${color}44` : 'none',
        cursor:       'default',
        transition:   'all 0.18s ease',
        userSelect:   'none',
      }}
    >
      {/* Zone dot */}
      <span
        style={{
          width:        '5px',
          height:       '5px',
          borderRadius: '50%',
          background:   color,
          boxShadow:    `0 0 ${hovered ? '6px' : '3px'} ${color}`,
          flexShrink:   0,
          transition:   'box-shadow 0.18s ease',
        }}
      />
      <span
        style={{
          fontSize:  '10px',
          color:     hovered ? color : `${color}cc`,
          fontWeight: 500,
          transition: 'color 0.18s ease',
        }}
      >
        {t.zones[zone.zone]?.name ?? zone.zone}
      </span>
      <span
        style={{
          fontSize:   '10px',
          fontFamily: 'monospace',
          color:      hovered ? '#e5e7eb' : '#9ca3af',
          fontWeight: 700,
          transition: 'color 0.18s ease',
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Premium refresh button
// ---------------------------------------------------------------------------

function RefreshButton({
  onClick,
  isRefreshing,
}: {
  onClick:      () => void;
  isRefreshing: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      disabled={isRefreshing}
      aria-label="Refresh data"
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '5px',
        padding:        '3px 10px',
        borderRadius:   '8px',
        border:         '1px solid rgba(255,255,255,0.1)',
        background:     isRefreshing
          ? 'rgba(96,165,250,0.12)'
          : 'rgba(255,255,255,0.04)',
        color:          isRefreshing ? '#60a5fa' : '#6b7280',
        fontSize:       '11px',
        cursor:         isRefreshing ? 'not-allowed' : 'pointer',
        boxShadow:      isRefreshing ? '0 0 10px rgba(96,165,250,0.2)' : 'none',
        transition:     'all 0.2s ease',
        letterSpacing:  '0.02em',
      }}
      onMouseEnter={(e) => {
        if (isRefreshing) return;
        const el = e.currentTarget as HTMLElement;
        el.style.background  = 'rgba(96,165,250,0.12)';
        el.style.borderColor = 'rgba(96,165,250,0.35)';
        el.style.color       = '#93c5fd';
        el.style.boxShadow   = '0 0 12px rgba(96,165,250,0.25)';
      }}
      onMouseLeave={(e) => {
        if (isRefreshing) return;
        const el = e.currentTarget as HTMLElement;
        el.style.background  = 'rgba(255,255,255,0.04)';
        el.style.borderColor = 'rgba(255,255,255,0.1)';
        el.style.color       = '#6b7280';
        el.style.boxShadow   = 'none';
      }}
    >
      <span
        style={{
          display:     'inline-block',
          fontSize:    '13px',
          animation:   isRefreshing ? 'statsbar-spin 0.8s linear infinite' : 'none',
          lineHeight:  1,
        }}
        aria-hidden="true"
      >
        ⟳
      </span>
      {isRefreshing ? t.statsBar.syncing : t.statsBar.refresh}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Animated memory count
// ---------------------------------------------------------------------------

function MemoryCount({ count }: { count: number }) {
  const { t } = useTranslation();
  const [displayCount, setDisplayCount] = useState(count);
  const [animKey, setAnimKey] = useState(0);
  const prevRef = useRef(count);

  useEffect(() => {
    if (count !== prevRef.current) {
      prevRef.current = count;
      setAnimKey((k) => k + 1);
      // Briefly animate the count ticking up/down
      const start   = displayCount;
      const end     = count;
      const diff    = end - start;
      const steps   = Math.min(Math.abs(diff), 12);
      if (steps === 0) return;
      let step = 0;
      const id = setInterval(() => {
        step++;
        setDisplayCount(Math.round(start + (diff * step) / steps));
        if (step >= steps) clearInterval(id);
      }, 40);
      return () => clearInterval(id);
    }
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        display:    'flex',
        alignItems: 'baseline',
        gap:        '5px',
      }}
    >
      <span
        style={{
          fontSize:   '10px',
          color:      '#4b5563',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {t.statsBar.memories}
      </span>
      <span
        key={animKey}
        style={{
          fontSize:   '16px',
          fontFamily: 'monospace',
          fontWeight: 800,
          color:      '#f3f4f6',
          textShadow: '0 0 16px rgba(96,165,250,0.5)',
          animation:  'statsbar-count-pop 0.35s ease-out both',
          lineHeight: 1,
        }}
      >
        {displayCount}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function HudDivider() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:   'inline-block',
        width:     '1px',
        height:    '14px',
        background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.15), transparent)',
        flexShrink: 0,
      }}
    />
  );
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
  avgQuality,
  conflictCount,
  proceduralCount,
  universalCount,
}: StatsBarProps) {
  injectStatsCss();
  const { t, formatRelative: formatRel } = useTranslation();

  const updatedLabel = lastUpdatedAt
    ? formatRel(new Date(lastUpdatedAt).toISOString())
    : null;

  // Sort zones by canonical order, filter out zero-count
  const sortedZones = ZONE_ORDER
    .map((z) => zones.find((s) => s.zone === z))
    .filter((z): z is ZoneStat => z != null && z.count > 0);

  return (
    <div
      style={{
        flexShrink:  0,
        position:    'relative',
        overflow:    'hidden',
      }}
    >
      {/* Main HUD bar */}
      <div
        style={{
          display:         'flex',
          alignItems:      'center',
          gap:             '10px',
          padding:         '6px 14px',
          background:      'linear-gradient(90deg, rgba(5,10,20,0.98), rgba(7,14,28,0.98))',
          borderBottom:    '1px solid rgba(255,255,255,0.06)',
          overflowX:       'auto',
          scrollbarWidth:  'none',
        }}
      >
        {/* Memory count — prominent HUD readout */}
        <MemoryCount count={totalMemories} />

        <HudDivider />

        {/* Zone pills */}
        {sortedZones.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>
            {sortedZones.map((z) => (
              <ZonePill key={z.zone} zone={z} count={z.count} />
            ))}
          </div>
        )}

        {/* Quality */}
        {avgQuality != null && (
          <>
            <HudDivider />
            <div title={t.statsBar.qualityTooltip} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{
                display:    'inline-block',
                width:      '5px', height: '5px',
                borderRadius: '50%',
                background: avgQuality >= 0.7 ? '#22c55e' : avgQuality >= 0.4 ? '#f59e0b' : '#ef4444',
                boxShadow:  `0 0 4px ${avgQuality >= 0.7 ? '#22c55e' : avgQuality >= 0.4 ? '#f59e0b' : '#ef4444'}`,
              }} />
              <span style={{ fontSize: '10px', color: '#374151' }}>{t.statsBar.quality}</span>
              <span style={{
                fontSize:   '10px',
                fontFamily: 'monospace',
                fontWeight: 700,
                color:      avgQuality >= 0.7 ? '#22c55e' : avgQuality >= 0.4 ? '#f59e0b' : '#ef4444',
              }}>
                {(avgQuality * 100).toFixed(0)}%
              </span>
            </div>
          </>
        )}

        {/* Conflicts */}
        {conflictCount != null && conflictCount > 0 && (
          <>
            <HudDivider />
            <div title={t.statsBar.conflictsTooltip} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{
                display:      'inline-flex',
                alignItems:   'center',
                gap:          '4px',
                padding:      '1px 6px',
                borderRadius: '999px',
                background:   'rgba(239,68,68,0.12)',
                border:       '1px solid rgba(239,68,68,0.3)',
                fontSize:     '10px',
                color:        '#f87171',
                fontWeight:   700,
                boxShadow:    '0 0 6px rgba(239,68,68,0.2)',
              }}>
                &#x26A0; {conflictCount}
              </span>
            </div>
          </>
        )}

        {/* Procedural */}
        {proceduralCount != null && proceduralCount > 0 && (
          <>
            <HudDivider />
            <div title={t.statsBar.rulesTooltip} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ fontSize: '10px', color: '#374151' }}>{t.statsBar.rules}</span>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#06b6d4', fontWeight: 700 }}>
                {proceduralCount}
              </span>
            </div>
          </>
        )}

        {/* Universal */}
        {universalCount != null && universalCount > 0 && (
          <>
            <HudDivider />
            <div title={t.statsBar.universalTooltip} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ fontSize: '10px', opacity: 0.7 }}>&#x1F310;</span>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#818cf8', fontWeight: 700 }}>
                {universalCount}
              </span>
            </div>
          </>
        )}

        {/* Orbit recalc */}
        {lastOrbitAt !== undefined && (
          <>
            <HudDivider />
            <div
              title={t.statsBar.orbitTooltip}
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '4px',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '10px', color: '#374151' }}>{t.statsBar.orbit}</span>
              <span style={{ fontSize: '10px', color: '#4b5563', fontFamily: 'monospace' }}>
                {formatRel(lastOrbitAt)}
              </span>
            </div>
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Last updated with blinking live dot */}
        {updatedLabel && (
          <div
            style={{
              display:    'flex',
              alignItems: 'center',
              gap:        '5px',
              flexShrink: 0,
            }}
          >
            {/* Blinking live indicator */}
            <span
              style={{
                display:      'inline-block',
                width:        '5px',
                height:       '5px',
                borderRadius: '50%',
                background:   isRefreshing ? '#60a5fa' : '#22c55e',
                boxShadow:    isRefreshing
                  ? '0 0 6px #60a5fa'
                  : '0 0 5px #22c55e',
                animation:    'statsbar-blink 1.4s ease-in-out infinite',
                flexShrink:   0,
              }}
            />
            <span style={{ fontSize: '10px', color: '#374151' }}>{t.statsBar.updated}</span>
            <span style={{ fontSize: '10px', color: '#4b5563', fontFamily: 'monospace' }}>
              {updatedLabel}
            </span>
          </div>
        )}

        <HudDivider />

        {/* Refresh button */}
        <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
      </div>

      {/* Animated gradient accent line at the bottom */}
      <div
        style={{
          height:            '1.5px',
          background:        'linear-gradient(90deg, #020408, #2563eb55, #7c3aed55, #eab30855, #16a34a55, #020408)',
          backgroundSize:    '300% 100%',
          animation:         'statsbar-gradient-slide 6s ease infinite',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
