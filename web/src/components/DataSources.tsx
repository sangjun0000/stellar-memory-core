import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { DataSource } from '../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Status dot colors (raw values for inline styles so we can add glow)
const STATUS_COLOR: Record<DataSource['status'], string> = {
  active:   '#22c55e',
  inactive: '#6b7280',
  error:    '#ef4444',
};

const STATUS_LABEL: Record<DataSource['status'], string> = {
  active:   'Active',
  inactive: 'Inactive',
  error:    'Error',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: DataSource['status'] }) {
  const color = STATUS_COLOR[status];
  const isActive = status === 'active';
  return (
    <span
      title={STATUS_LABEL[status]}
      style={{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        flexShrink: 0,
        backgroundColor: color,
        boxShadow: isActive ? `0 0 6px ${color}cc` : 'none',
        animation: isActive ? 'statusDotPulse 2.5s ease-in-out infinite' : 'none',
      }}
    />
  );
}

function SourceCard({ src }: { src: DataSource }) {
  const [hovered, setHovered] = useState(false);
  const isError = src.status === 'error';
  const borderColor = isError
    ? 'rgba(239,68,68,0.25)'
    : hovered
      ? 'rgba(96,165,250,0.25)'
      : 'rgba(255,255,255,0.06)';
  const boxShadow = hovered
    ? isError
      ? '0 0 16px rgba(239,68,68,0.08)'
      : '0 0 16px rgba(96,165,250,0.08)'
    : 'none';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: '8px',
        border: `1px solid ${borderColor}`,
        background: hovered
          ? 'rgba(255,255,255,0.025)'
          : 'rgba(2,4,8,0.6)',
        padding: '9px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
        boxShadow,
        animation: 'sourceCardIn 0.25s ease-out',
      }}
    >
      {/* Path + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <StatusDot status={src.status} />
        <span
          title={src.path}
          style={{
            fontSize: '11px',
            color: '#cbd5e1',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            letterSpacing: '0.01em',
          }}
        >
          {src.path}
        </span>
      </div>

      {/* Metadata row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '10px',
          color: 'rgba(148,163,184,0.45)',
          letterSpacing: '0.02em',
        }}
      >
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {src.file_count}&nbsp;file{src.file_count !== 1 ? 's' : ''}
        </span>
        <span>scanned {formatRelative(src.last_scanned_at)}</span>
        {isError && src.error && (
          <span
            style={{
              color: '#f87171',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={src.error}
          >
            {src.error}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DataSourcesProps {
  project: string;
}

export function DataSources({ project }: DataSourcesProps) {
  const [sources, setSources]     = useState<DataSource[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDataSources(project);
      setSources(res.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg.includes('404') || msg.includes('HTTP 404')) {
        setSources([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel flex flex-col" style={{ overflow: 'hidden' }}>
      {/* ── Collapse toggle header ── */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="panel-header flex items-center justify-between w-full text-left"
        aria-expanded={!collapsed}
        aria-controls="data-sources-body"
        style={{
          cursor: 'pointer',
          transition: 'color 0.15s ease',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '';
        }}
      >
        <span>Data Sources</span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            borderRadius: '4px',
            border: '1px solid rgba(148,163,184,0.2)',
            fontSize: '10px',
            color: 'rgba(148,163,184,0.5)',
            transition: 'transform 0.25s ease, border-color 0.2s ease',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </button>

      {/* ── Body ── */}
      <div
        id="data-sources-body"
        style={{
          overflow: 'hidden',
          maxHeight: collapsed ? '0px' : '600px',
          transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Loading skeleton */}
          {loading && (
            <div style={{ padding: '12px 0', textAlign: 'center' }}>
              <span
                style={{
                  fontSize: '11px',
                  color: 'rgba(148,163,184,0.35)',
                  letterSpacing: '0.1em',
                  animation: 'statusDotPulse 1.5s ease-in-out infinite',
                }}
              >
                SCANNING...
              </span>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div
              style={{
                borderRadius: '7px',
                border: '1px solid rgba(239,68,68,0.25)',
                background: 'rgba(239,68,68,0.06)',
                padding: '8px 10px',
                fontSize: '11px',
                color: '#f87171',
              }}
            >
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && sources.length === 0 && (
            <div
              style={{
                padding: '20px 10px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Decorative empty-state icon */}
              <svg width="28" height="28" viewBox="0 0 28 28" style={{ opacity: 0.25 }}>
                <circle cx="14" cy="14" r="11" fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="3 3" />
                <circle cx="14" cy="14" r="2" fill="#94a3b8" opacity="0.5" />
              </svg>
              <span style={{ fontSize: '11px', color: 'rgba(148,163,184,0.35)', letterSpacing: '0.05em' }}>
                No sources registered
              </span>
            </div>
          )}

          {/* Source cards */}
          {!loading && !error && sources.map((src) => (
            <SourceCard key={src.id} src={src} />
          ))}
        </div>
      </div>

      {/* Keyframes specific to this component */}
      <style>{`
        @keyframes statusDotPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes sourceCardIn {
          from { opacity: 0; transform: translateY(-3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
