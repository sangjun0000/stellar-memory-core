import { useState, useCallback, useEffect } from 'react';
import type { Memory, MemoryConflict } from '../api/client';
import { api } from '../api/client';
import { MEMORY_COLORS } from './Planet';
import { useTranslation } from '../i18n/context';

interface MemoryDetailProps {
  memory: Memory;
  onClose: () => void;
  onForget: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, string> = {
  decision:    '💡',
  error:       '🔴',
  task:        '📋',
  observation: '👁️',
  milestone:   '🏆',
  context:     '📎',
  procedural:  '🧭',
};


const ZONE_INFO: { max: number; label: string; color: string }[] = [
  { max: 1,   label: 'Corona',    color: '#fbbf24' },
  { max: 5,   label: 'Inner',     color: '#f97316' },
  { max: 15,  label: 'Habitable', color: '#22c55e' },
  { max: 40,  label: 'Outer',     color: '#60a5fa' },
  { max: 70,  label: 'Kuiper',    color: '#a78bfa' },
  { max: 101, label: 'Oort',      color: '#9ca3af' },
];

function getZone(distance: number) {
  return ZONE_INFO.find((z) => distance < z.max) ?? ZONE_INFO[5];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Animated stat bar — gradient shimmer fill
// ---------------------------------------------------------------------------

function StatBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 60);
    return () => clearTimeout(t);
  }, [value]);

  const pct = `${(value * 100).toFixed(0)}%`;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-12 shrink-0">{label}</span>
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        {/* Base fill */}
        <div
          style={{
            width:      animated ? pct : '0%',
            height:     '100%',
            background: `linear-gradient(90deg, ${color}cc, ${color}, ${color}dd)`,
            boxShadow:  `0 0 6px ${color}88`,
            borderRadius: '999px',
            transition: 'width 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
            position:   'relative',
            overflow:   'hidden',
          }}
        >
          {/* Shimmer overlay */}
          <div
            style={{
              position:   'absolute',
              inset:      0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
              animation:  'shimmer 2.2s infinite',
            }}
          />
        </div>
      </div>
      <span className="text-[10px] font-mono w-7 text-right" style={{ color }}>
        {pct}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section with glowing divider header
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  color,
  defaultOpen = true,
  children,
}: {
  title:        string;
  icon:         string;
  color:        string;
  defaultOpen?: boolean;
  children:     React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 transition-colors group"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = `${color}08`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {/* Glow accent line */}
        <span
          style={{
            display:      'inline-block',
            width:        '2px',
            height:       '12px',
            borderRadius: '2px',
            background:   color,
            boxShadow:    `0 0 6px ${color}`,
            flexShrink:   0,
          }}
        />
        <span className="text-[11px]">{icon}</span>
        <span
          className="text-[10px] font-bold uppercase tracking-widest flex-1 text-left"
          style={{ color: `${color}cc` }}
        >
          {title}
        </span>
        <span
          className="text-[10px] font-mono transition-transform duration-200"
          style={{
            color:     `${color}88`,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property Row
// ---------------------------------------------------------------------------

function PropRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-1 text-xs">
      <span className="text-gray-600 w-20 flex-shrink-0 text-right font-medium uppercase tracking-wide text-[9px]">
        {label}
      </span>
      <span
        className={`text-gray-300 flex-1 break-words ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holographic tag chip
// ---------------------------------------------------------------------------

function TagChip({ tag, color }: { tag: string; color: string }) {
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full cursor-default transition-all duration-200"
      style={{
        background:  `linear-gradient(135deg, ${color}18, ${color}08)`,
        border:      `1px solid ${color}40`,
        color:       `${color}cc`,
        boxShadow:   'none',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 0 8px ${color}55, inset 0 0 8px ${color}18`;
        el.style.borderColor = `${color}88`;
        el.style.color = color;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = 'none';
        el.style.borderColor = `${color}40`;
        el.style.color = `${color}cc`;
      }}
    >
      #{tag}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Footer action button
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  children,
  variant = 'default',
  title,
}: {
  onClick:   () => void;
  children:  React.ReactNode;
  variant?:  'default' | 'danger';
  title?:    string;
}) {
  const base: React.CSSProperties = {
    flex:         '1',
    fontSize:     '11px',
    padding:      '6px 8px',
    borderRadius: '8px',
    border:       variant === 'danger'
      ? '1px solid rgba(220,38,38,0.4)'
      : '1px solid rgba(255,255,255,0.1)',
    background:   variant === 'danger'
      ? 'rgba(220,38,38,0.08)'
      : 'rgba(255,255,255,0.04)',
    color:        variant === 'danger' ? '#f87171' : '#9ca3af',
    cursor:       'pointer',
    transition:   'all 0.2s ease',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    gap:          '5px',
  };

  return (
    <button
      onClick={onClick}
      title={title}
      style={base}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (variant === 'danger') {
          el.style.background  = 'rgba(220,38,38,0.18)';
          el.style.borderColor = 'rgba(220,38,38,0.7)';
          el.style.color       = '#fca5a5';
          el.style.boxShadow   = '0 0 12px rgba(220,38,38,0.25)';
        } else {
          el.style.background  = 'rgba(255,255,255,0.08)';
          el.style.borderColor = 'rgba(255,255,255,0.2)';
          el.style.color       = '#e5e7eb';
          el.style.boxShadow   = '0 0 10px rgba(255,255,255,0.06)';
        }
        el.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        Object.assign(el.style, base);
        el.style.transform = '';
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Quality score ring
// ---------------------------------------------------------------------------

function QualityRing({ score }: { score: number }) {
  const { t } = useTranslation();
  const pct = score * 100;
  const ringColor = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const label     = pct >= 70 ? t.memoryDetail.qualityGood : pct >= 40 ? t.memoryDetail.qualityFair : t.memoryDetail.qualityLow;

  return (
    <span
      title={`Quality: ${pct.toFixed(0)}%`}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            '4px',
        fontSize:       '10px',
        fontFamily:     'monospace',
        color:          ringColor,
        background:     `${ringColor}18`,
        border:         `1px solid ${ringColor}44`,
        borderRadius:   '999px',
        padding:        '1px 6px 1px 4px',
        boxShadow:      `0 0 6px ${ringColor}33`,
      }}
    >
      <span style={{
        display:      'inline-block',
        width:        '6px',
        height:       '6px',
        borderRadius: '50%',
        background:   ringColor,
        boxShadow:    `0 0 4px ${ringColor}`,
        flexShrink:   0,
      }} />
      {pct.toFixed(0)}% {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shimmer keyframe — injected once
// ---------------------------------------------------------------------------

const SHIMMER_CSS = `
@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes md-fade-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes close-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(90deg); }
}
`;

function injectShimmer() {
  if (document.getElementById('md-shimmer-css')) return;
  const style = document.createElement('style');
  style.id = 'md-shimmer-css';
  style.textContent = SHIMMER_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MemoryDetail({ memory, onClose, onForget }: MemoryDetailProps) {
  injectShimmer();

  const { t, formatRelative: formatRel } = useTranslation();
  const color = MEMORY_COLORS[memory.type] ?? '#6b7280';
  const zone  = getZone(memory.distance);
  const [contentExpanded, setContentExpanded]   = useState(true);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [conflicts, setConflicts]               = useState<MemoryConflict[]>([]);
  const [isUniversal, setIsUniversal]           = useState(!!memory.is_universal);
  const [togglingUniversal, setTogglingUniversal] = useState(false);

  // Auto-revert confirmation after 3 seconds
  useEffect(() => {
    if (!confirmingForget) return;
    const t = setTimeout(() => setConfirmingForget(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingForget]);

  // Load conflicts for this memory
  useEffect(() => {
    api.getConflictsForMemory(memory.id)
      .then((res) => setConflicts(res.data ?? []))
      .catch(() => setConflicts([]));
  }, [memory.id]);

  const handleToggleUniversal = useCallback(async () => {
    setTogglingUniversal(true);
    try {
      await api.markUniversal(memory.id, !isUniversal);
      setIsUniversal(!isUniversal);
    } catch {
      // silently ignore
    } finally {
      setTogglingUniversal(false);
    }
  }, [memory.id, isUniversal]);

  const handleDismissConflict = useCallback(async (conflictId: string) => {
    try {
      await api.dismissConflict(conflictId);
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
    } catch {
      // silently ignore
    }
  }, []);
  const maxPreview = 500;
  const isLong = memory.content.length > maxPreview;

  const sourcePath =
    memory.source_path ??
    (memory.metadata?.source_path as string | undefined) ??
    null;

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const handleOpenPath = useCallback((path: string) => {
    const w = window as { electronAPI?: { openPath: (p: string) => void } };
    if (w.electronAPI?.openPath) {
      w.electronAPI.openPath(path);
    } else {
      void navigator.clipboard.writeText(path);
    }
  }, []);

  const isElectron = !!(window as { electronAPI?: unknown }).electronAPI;

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: '#070d1a',
        animation:  'md-fade-in 0.22s ease-out both',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: `linear-gradient(160deg, ${color}22 0%, ${color}0a 40%, #050a1400 100%)`,
          borderBottom: `1px solid ${color}30`,
          padding: '14px 14px 12px',
          flexShrink: 0,
        }}
      >
        <div className="flex items-start gap-3">
          {/* Glowing icon orb */}
          <div
            style={{
              width:        '38px',
              height:       '38px',
              borderRadius: '50%',
              background:   `radial-gradient(circle at 40% 35%, ${color}44, ${color}18 60%, transparent 100%)`,
              border:       `1px solid ${color}55`,
              boxShadow:    `0 0 18px ${color}44, inset 0 0 12px ${color}22`,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     '18px',
              flexShrink:   0,
            }}
          >
            {TYPE_ICONS[memory.type] ?? '📄'}
          </div>

          <div className="flex-1 min-w-0">
            <div
              className="text-sm font-semibold leading-snug"
              style={{ color: '#f3f4f6', textShadow: `0 0 20px ${color}44` }}
            >
              {memory.summary || t.memoryDetail.untitled}
            </div>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {/* Type badge */}
              <span
                className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                style={{
                  color,
                  background: `${color}22`,
                  border:     `1px solid ${color}44`,
                  boxShadow:  `0 0 8px ${color}33`,
                }}
              >
                {t.memoryTypes[memory.type] ?? memory.type}
              </span>

              {/* Zone badge */}
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                style={{
                  color:       zone.color,
                  background:  `${zone.color}18`,
                  border:      `1px solid ${zone.color}33`,
                }}
              >
                {zone.label} · {memory.distance.toFixed(1)} AU
              </span>

              {/* Quality score badge */}
              {memory.quality_score != null && (
                <QualityRing score={memory.quality_score} />
              )}

              {/* Universal badge */}
              {isUniversal && (
                <span
                  title={t.memoryDetail.universalBadge}
                  style={{
                    display:     'inline-flex',
                    alignItems:  'center',
                    gap:         '3px',
                    fontSize:    '10px',
                    color:       '#818cf8',
                    background:  'rgba(99,102,241,0.12)',
                    border:      '1px solid rgba(99,102,241,0.3)',
                    borderRadius: '999px',
                    padding:     '1px 6px',
                  }}
                >
                  &#x1F310; {t.memoryDetail.universal}
                </span>
              )}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            title={t.memoryDetail.close}
            style={{
              width:        '26px',
              height:       '26px',
              borderRadius: '50%',
              border:       '1px solid rgba(255,255,255,0.12)',
              background:   'rgba(255,255,255,0.05)',
              color:        '#6b7280',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     '11px',
              flexShrink:   0,
              transition:   'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.background  = 'rgba(220,38,38,0.18)';
              el.style.borderColor = 'rgba(220,38,38,0.5)';
              el.style.color       = '#fca5a5';
              el.style.boxShadow   = '0 0 10px rgba(220,38,38,0.3)';
              el.style.transform   = 'rotate(90deg)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.background  = 'rgba(255,255,255,0.05)';
              el.style.borderColor = 'rgba(255,255,255,0.12)';
              el.style.color       = '#6b7280';
              el.style.boxShadow   = '';
              el.style.transform   = '';
            }}
          >
            ✕
          </button>
        </div>

        {/* Animated stat bars */}
        <div className="mt-3 space-y-1.5">
          <StatBar label={t.memoryDetail.importance} value={memory.importance} color={color} />
          <StatBar label={t.memoryDetail.impact}     value={memory.impact}     color={color} />
        </div>

        {/* Holographic tags */}
        {memory.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {memory.tags.slice(0, 6).map((tag) => (
              <TagChip key={tag} tag={tag} color={color} />
            ))}
            {memory.tags.length > 6 && (
              <span className="text-[10px] text-gray-600 self-center">
                +{memory.tags.length - 6} {t.memoryDetail.more}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${color}33 transparent` }}>

        {/* Content — always visible, no collapsible wrapper */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div
            style={{
              background:   'rgba(0,0,0,0.45)',
              border:       `1px solid rgba(255,255,255,0.07)`,
              borderLeft:   `3px solid ${color}55`,
              borderRadius: '6px',
              padding:      '10px 12px',
              fontFamily:   "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize:     '12px',
              lineHeight:   '1.8',
              color:        '#e5e7eb',
              whiteSpace:   'pre-wrap',
              wordBreak:    'break-word',
              boxShadow:    `inset 0 0 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.03)`,
              maxHeight:    '40vh',
              overflowY:    'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: `${color}33 transparent`,
            }}
          >
            {isLong && !contentExpanded
              ? memory.content.slice(0, maxPreview) + '…'
              : memory.content}
          </div>
          {isLong && (
            <button
              onClick={() => setContentExpanded(!contentExpanded)}
              className="text-[10px] mt-1.5 transition-colors"
              style={{ color: `${color}bb` }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = color; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = `${color}bb`; }}
            >
              {contentExpanded
                ? '▲ ' + t.memoryDetail.collapse
                : `▼ ${t.memoryDetail.expand} · ${memory.content.length} ${t.memoryDetail.chars}`}
            </button>
          )}
        </div>

        {/* Properties */}
        <Section title={t.memoryDetail.properties} icon="📊" color={color} defaultOpen={false}>
          <div className="space-y-0.5">
            <PropRow label={t.memoryDetail.type}  value={<span style={{ color }}>{t.memoryTypes[memory.type] ?? memory.type}</span>} />
            <PropRow label={t.memoryDetail.zone}  value={<span style={{ color: zone.color }}>{zone.label}</span>} />
            <PropRow label={t.memoryDetail.distance} value={`${memory.distance.toFixed(2)} AU`} mono />
            <PropRow
              label={t.memoryDetail.velocity}
              value={
                <span
                  style={{
                    color: memory.velocity > 0 ? '#4ade80'
                         : memory.velocity < 0 ? '#f87171'
                         : '#6b7280',
                  }}
                >
                  {memory.velocity > 0 ? '↗ +' : memory.velocity < 0 ? '↘ ' : ''}
                  {memory.velocity.toFixed(3)}
                </span>
              }
              mono
            />
            <PropRow label={t.memoryDetail.accessed} value={`${memory.access_count}×`} mono />
          </div>
        </Section>

        {/* Temporal info */}
        {(memory.valid_from || memory.valid_until || memory.superseded_by || memory.consolidated_into) && (
          <Section title={t.memoryDetail.temporal} icon="⏳" color={color} defaultOpen>
            <div className="space-y-1.5">
              {(memory.valid_from || memory.valid_until) && (
                <PropRow
                  label={t.memoryDetail.valid}
                  value={
                    <span className="font-mono text-gray-400">
                      {memory.valid_from
                        ? new Date(memory.valid_from).toLocaleDateString()
                        : '—'}
                      {' ~ '}
                      {memory.valid_until
                        ? new Date(memory.valid_until).toLocaleDateString()
                        : t.memoryDetail.present}
                    </span>
                  }
                />
              )}
              {memory.superseded_by && (
                <div
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          '6px',
                    padding:      '6px 8px',
                    background:   'rgba(245,158,11,0.08)',
                    border:       '1px solid rgba(245,158,11,0.25)',
                    borderRadius: '6px',
                    fontSize:     '10px',
                  }}
                >
                  <span style={{ color: '#f59e0b' }}>&#x26A0;</span>
                  <span style={{ color: '#9ca3af' }}>{t.memoryDetail.supersededBy}</span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color:      '#fbbf24',
                      fontSize:   '9px',
                      opacity:    0.8,
                    }}
                  >
                    {memory.superseded_by.slice(0, 12)}…
                  </span>
                </div>
              )}
              {memory.consolidated_into && (
                <div
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          '6px',
                    padding:      '6px 8px',
                    background:   'rgba(99,102,241,0.08)',
                    border:       '1px solid rgba(99,102,241,0.25)',
                    borderRadius: '6px',
                    fontSize:     '10px',
                    color:        '#a5b4fc',
                  }}
                >
                  <span>&#x1F4E6;</span>
                  <span style={{ color: '#9ca3af' }}>{t.memoryDetail.consolidatedInto}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '9px', opacity: 0.8 }}>
                    {memory.consolidated_into.slice(0, 12)}…
                  </span>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Conflict warnings */}
        {conflicts.length > 0 && (
          <Section title={`${t.memoryDetail.conflicts} (${conflicts.length})`} icon="⚡" color="#f59e0b" defaultOpen>
            <div className="space-y-2">
              {conflicts.map((c) => {
                const severityColor = c.severity === 'high' ? '#ef4444'
                  : c.severity === 'medium' ? '#f59e0b'
                  : '#6b7280';
                return (
                  <div
                    key={c.id}
                    style={{
                      padding:      '8px 10px',
                      background:   `${severityColor}0c`,
                      border:       `1px solid ${severityColor}33`,
                      borderRadius: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span
                        style={{
                          fontSize:    '9px',
                          fontWeight:  700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color:       severityColor,
                          background:  `${severityColor}22`,
                          border:      `1px solid ${severityColor}44`,
                          borderRadius: '999px',
                          padding:     '1px 5px',
                        }}
                      >
                        {c.severity}
                      </span>
                      <span style={{ fontSize: '10px', color: '#6b7280', fontFamily: 'monospace' }}>
                        {c.id.slice(0, 8)}
                      </span>
                    </div>
                    <p style={{ fontSize: '10px', color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.5 }}>
                      {c.description}
                    </p>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => void handleDismissConflict(c.id)}
                        style={{
                          fontSize:    '10px',
                          padding:     '2px 8px',
                          borderRadius: '4px',
                          border:      '1px solid rgba(255,255,255,0.1)',
                          background:  'rgba(255,255,255,0.04)',
                          color:       '#6b7280',
                          cursor:      'pointer',
                          transition:  'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.color = '#e5e7eb';
                          el.style.background = 'rgba(255,255,255,0.08)';
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.color = '#6b7280';
                          el.style.background = 'rgba(255,255,255,0.04)';
                        }}
                      >
                        {t.memoryDetail.dismiss}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Universal toggle */}
        <Section title={t.memoryDetail.universal} icon="&#x1F310;" color="#818cf8" defaultOpen={false}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, fontSize: '10px', color: '#6b7280', lineHeight: 1.6 }}>
              {t.memoryDetail.universalDesc}
            </div>
            <button
              onClick={() => void handleToggleUniversal()}
              disabled={togglingUniversal}
              style={{
                flexShrink:   0,
                padding:      '4px 10px',
                borderRadius: '6px',
                border:       isUniversal
                  ? '1px solid rgba(99,102,241,0.5)'
                  : '1px solid rgba(255,255,255,0.1)',
                background:   isUniversal
                  ? 'rgba(99,102,241,0.15)'
                  : 'rgba(255,255,255,0.04)',
                color:        isUniversal ? '#a5b4fc' : '#6b7280',
                fontSize:     '10px',
                cursor:       togglingUniversal ? 'not-allowed' : 'pointer',
                transition:   'all 0.2s ease',
                fontWeight:   isUniversal ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (togglingUniversal) return;
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'rgba(99,102,241,0.5)';
                el.style.color = '#c7d2fe';
              }}
              onMouseLeave={(e) => {
                if (togglingUniversal) return;
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = isUniversal ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)';
                el.style.color = isUniversal ? '#a5b4fc' : '#6b7280';
              }}
            >
              {togglingUniversal ? '...' : isUniversal ? t.memoryDetail.removeUniversal : t.memoryDetail.markUniversal}
            </button>
          </div>
        </Section>

        {/* Source */}
        {sourcePath && (
          <Section title={t.memoryDetail.source} icon="📁" color={color} defaultOpen>
            <div
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          '8px',
                background:   'rgba(0,0,0,0.35)',
                border:       '1px solid rgba(255,255,255,0.07)',
                borderRadius: '6px',
                padding:      '8px 10px',
              }}
            >
              <span style={{ fontSize: '12px', opacity: 0.5 }}>📄</span>
              <span
                style={{
                  flex:       1,
                  fontSize:   '10px',
                  fontFamily: 'monospace',
                  color:      '#9ca3af',
                  wordBreak:  'break-all',
                }}
              >
                {sourcePath}
              </span>
              <button
                onClick={() => handleOpenPath(sourcePath)}
                style={{
                  fontSize:     '10px',
                  padding:      '3px 8px',
                  border:       `1px solid ${color}44`,
                  borderRadius: '4px',
                  background:   `${color}12`,
                  color:        `${color}cc`,
                  cursor:       'pointer',
                  whiteSpace:   'nowrap',
                  transition:   'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background  = `${color}28`;
                  el.style.borderColor = `${color}88`;
                  el.style.color       = color;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background  = `${color}12`;
                  el.style.borderColor = `${color}44`;
                  el.style.color       = `${color}cc`;
                }}
              >
                {isElectron ? '📂 ' + t.memoryDetail.open : '📋 ' + t.memoryDetail.copy}
              </button>
            </div>
          </Section>
        )}

        {/* All tags */}
        {memory.tags.length > 6 && (
          <Section title={t.memoryDetail.allTags} icon="🏷️" color={color} defaultOpen={false}>
            <div className="flex flex-wrap gap-1.5">
              {memory.tags.map((tag) => (
                <TagChip key={tag} tag={tag} color={color} />
              ))}
            </div>
          </Section>
        )}

        {/* Timeline */}
        <Section title={t.memoryDetail.timeline} icon="🕐" color={color} defaultOpen={false}>
          <div className="space-y-0.5">
            <PropRow
              label={t.memoryDetail.created}
              value={
                <span title={formatDate(memory.created_at)} className="text-gray-400">
                  <span className="text-gray-500">{formatRel(memory.created_at)}</span>
                  {' · '}
                  {formatDate(memory.created_at)}
                </span>
              }
            />
            {memory.last_accessed_at && (
              <PropRow
                label={t.memoryDetail.lastAccess}
                value={
                  <span title={formatDate(memory.last_accessed_at)} className="text-gray-400">
                    <span className="text-gray-500">{formatRel(memory.last_accessed_at)}</span>
                    {' · '}
                    {formatDate(memory.last_accessed_at)}
                  </span>
                }
              />
            )}
            <PropRow label={t.memoryDetail.updated} value={formatDate(memory.updated_at)} />
          </div>
        </Section>

        {/* Metadata */}
        {Object.keys(memory.metadata).length > 0 && (
          <Section title={t.memoryDetail.metadata} icon="📋" color={color} defaultOpen={false}>
            <div
              style={{
                background:   'rgba(0,0,0,0.4)',
                border:       '1px solid rgba(255,255,255,0.06)',
                borderRadius: '6px',
                padding:      '8px 10px',
                overflow:     'auto',
              }}
            >
              <pre
                style={{
                  fontSize:   '10px',
                  fontFamily: 'monospace',
                  color:      '#6b7280',
                  whiteSpace: 'pre-wrap',
                  wordBreak:  'break-word',
                  margin:     0,
                }}
              >
                {JSON.stringify(memory.metadata, null, 2)}
              </pre>
            </div>
          </Section>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink:   0,
          padding:      '10px',
          borderTop:    `1px solid ${color}25`,
          background:   `linear-gradient(0deg, ${color}0c 0%, transparent 100%)`,
          display:      'flex',
          gap:          '8px',
        }}
      >
        <ActionButton onClick={() => handleCopy(memory.content)} title={t.memoryDetail.copyContent}>
          📋 {t.memoryDetail.copyContent}
        </ActionButton>
        {confirmingForget ? (
          <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
            <ActionButton onClick={() => onForget(memory.id)} variant="danger" title={t.memoryDetail.confirmDelete}>
              {t.memoryDetail.confirmDelete}
            </ActionButton>
            <button
              onClick={() => setConfirmingForget(false)}
              title={t.memoryDetail.cancel}
              style={{
                fontSize:     '11px',
                padding:      '6px 10px',
                borderRadius: '8px',
                border:       '1px solid rgba(255,255,255,0.1)',
                background:   'rgba(255,255,255,0.04)',
                color:        '#9ca3af',
                cursor:       'pointer',
                transition:   'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = 'rgba(255,255,255,0.08)';
                el.style.borderColor = 'rgba(255,255,255,0.2)';
                el.style.color       = '#e5e7eb';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background  = 'rgba(255,255,255,0.04)';
                el.style.borderColor = 'rgba(255,255,255,0.1)';
                el.style.color       = '#9ca3af';
              }}
            >
              {t.memoryDetail.cancel}
            </button>
          </div>
        ) : (
          <ActionButton onClick={() => setConfirmingForget(true)} variant="danger" title={t.memoryDetail.forget}>
            {t.memoryDetail.forget}
          </ActionButton>
        )}
      </div>
    </div>
  );
}
