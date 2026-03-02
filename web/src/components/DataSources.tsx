import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import type { DataSource } from '../api/client';
import { useTranslation } from '../i18n/context';

// Status dot colors (raw values for inline styles so we can add glow)
const STATUS_COLOR: Record<DataSource['status'], string> = {
  active:   '#22c55e',
  inactive: '#6b7280',
  error:    '#ef4444',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: DataSource['status'] }) {
  const { t } = useTranslation();
  const color = STATUS_COLOR[status];
  const isActive = status === 'active';
  const statusLabel = status === 'active' ? t.dataSources.statusActive
    : status === 'inactive' ? t.dataSources.statusInactive
    : t.dataSources.statusError;
  return (
    <span
      title={statusLabel}
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
  const { t, formatRelative: formatRel } = useTranslation();
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
          {src.file_count}&nbsp;{src.file_count !== 1 ? t.dataSources.files : t.dataSources.file}
        </span>
        <span>{t.dataSources.scanned} {formatRel(src.last_scanned_at)}</span>
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
// Scan progress UI
// ---------------------------------------------------------------------------

interface ScanState {
  phase: 'idle' | 'scanning' | 'done' | 'error';
  scannedFiles: number;
  createdMemories: number;
  totalFiles: number;
  currentFile: string;
  percentComplete: number;
  errorMessage?: string;
}

const INITIAL_SCAN: ScanState = {
  phase: 'idle',
  scannedFiles: 0,
  createdMemories: 0,
  totalFiles: 0,
  currentFile: '',
  percentComplete: 0,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DataSourcesProps {
  project: string;
}

export function DataSources({ project }: DataSourcesProps) {
  const { t } = useTranslation();
  const [sources, setSources]     = useState<DataSource[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Scan UI state
  const [showAddForm, setShowAddForm] = useState(false);
  const [scanPath, setScanPath]       = useState('');
  const [scan, setScan]               = useState<ScanState>(INITIAL_SCAN);
  const inputRef                      = useRef<HTMLInputElement>(null);

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

  // Focus input when form opens
  useEffect(() => {
    if (showAddForm) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showAddForm]);

  // Start scan via SSE
  const startScan = useCallback(async () => {
    const path = scanPath.trim();
    if (!path) return;

    setScan({ ...INITIAL_SCAN, phase: 'scanning' });

    try {
      const res = await api.startFullScan({
        mode: 'folders',
        paths: [path],
        includeGit: true,
      });

      const reader = res.body?.getReader();
      if (!reader) {
        setScan(s => ({ ...s, phase: 'error', errorMessage: 'No response stream' }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());

            if (data.totalScannedFiles !== undefined) {
              // scan:complete or scan:cancelled
              setScan(s => ({
                ...s,
                phase: 'done',
                scannedFiles: data.totalScannedFiles ?? s.scannedFiles,
                createdMemories: data.totalCreatedMemories ?? s.createdMemories,
                percentComplete: 100,
              }));
            } else if (data.error) {
              setScan(s => ({ ...s, phase: 'error', errorMessage: data.error }));
            } else if (data.scannedFiles !== undefined) {
              setScan(s => ({
                ...s,
                scannedFiles: data.scannedFiles ?? s.scannedFiles,
                createdMemories: data.createdMemories ?? s.createdMemories,
                totalFiles: data.totalFiles ?? s.totalFiles,
                currentFile: data.currentFile ?? s.currentFile,
                percentComplete: data.percentComplete ?? s.percentComplete,
              }));
            } else if (data.totalFiles !== undefined) {
              // collected phase
              setScan(s => ({ ...s, totalFiles: data.totalFiles }));
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }

      // Reload sources after scan
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setScan(s => ({ ...s, phase: 'error', errorMessage: msg }));
    }
  }, [scanPath, load]);

  const cancelScan = useCallback(async () => {
    try { await api.cancelScan(); } catch { /* ignore */ }
  }, []);

  const resetScan = useCallback(() => {
    setScan(INITIAL_SCAN);
    setShowAddForm(false);
    setScanPath('');
  }, []);

  return (
    <div className="panel flex flex-col" style={{ overflow: 'hidden' }}>
      {/* ── Collapse toggle header ── */}
      <div
        className="panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{t.dataSources.header}</span>
          <span
            aria-hidden="true"
            style={{
              fontSize: '10px',
              color: 'rgba(148,163,184,0.5)',
              transition: 'transform 0.25s ease',
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
          >
            ▾
          </span>
        </button>

        {/* Add folder button */}
        {scan.phase === 'idle' && !showAddForm && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowAddForm(true); setCollapsed(false); }}
            title={t.dataSources.addSource}
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '4px',
              border: '1px solid rgba(96,165,250,0.25)',
              background: 'rgba(96,165,250,0.08)',
              color: '#60a5fa',
              fontSize: '14px',
              lineHeight: '1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.2)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.5)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.08)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.25)';
            }}
          >
            +
          </button>
        )}
      </div>

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

          {/* ── Add folder form ── */}
          {showAddForm && scan.phase === 'idle' && (
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid rgba(96,165,250,0.25)',
                background: 'rgba(96,165,250,0.04)',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                animation: 'sourceCardIn 0.2s ease-out',
              }}
            >
              <input
                ref={inputRef}
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
                placeholder={t.dataSources.pathPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && scanPath.trim()) void startScan();
                  if (e.key === 'Escape') { setShowAddForm(false); setScanPath(''); }
                }}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(96,165,250,0.2)',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '11px',
                  color: '#e5e7eb',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => void startScan()}
                  disabled={!scanPath.trim()}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(96,165,250,0.4)',
                    background: 'rgba(96,165,250,0.12)',
                    color: '#93c5fd',
                    fontSize: '11px',
                    cursor: scanPath.trim() ? 'pointer' : 'not-allowed',
                    opacity: scanPath.trim() ? 1 : 0.5,
                  }}
                >
                  {t.dataSources.scan}
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setScanPath(''); }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent',
                    color: '#6b7280',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  {t.dataSources.cancel}
                </button>
              </div>
            </div>
          )}

          {/* ── Scan progress ── */}
          {scan.phase === 'scanning' && (
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid rgba(96,165,250,0.2)',
                background: 'rgba(96,165,250,0.04)',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                animation: 'sourceCardIn 0.2s ease-out',
              }}
            >
              {/* Progress bar */}
              <div style={{ height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, scan.percentComplete)}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                    boxShadow: '0 0 8px rgba(96,165,250,0.4)',
                  }}
                />
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8' }}>
                <span>{t.dataSources.scanProgress} {scan.percentComplete.toFixed(1)}%</span>
                <span>{scan.scannedFiles} / {scan.totalFiles || '?'}</span>
              </div>

              {/* Current file */}
              {scan.currentFile && (
                <div
                  style={{
                    fontSize: '9px',
                    color: 'rgba(148,163,184,0.4)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl',
                    textAlign: 'left',
                  }}
                >
                  {scan.currentFile}
                </div>
              )}

              {/* Created count + cancel */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#22c55e' }}>
                  +{scan.createdMemories} {t.dataSources.memories}
                </span>
                <button
                  onClick={() => void cancelScan()}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid rgba(239,68,68,0.3)',
                    background: 'rgba(239,68,68,0.08)',
                    color: '#f87171',
                    fontSize: '10px',
                    cursor: 'pointer',
                  }}
                >
                  {t.dataSources.cancel}
                </button>
              </div>
            </div>
          )}

          {/* ── Scan complete ── */}
          {scan.phase === 'done' && (
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid rgba(34,197,94,0.25)',
                background: 'rgba(34,197,94,0.04)',
                padding: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                animation: 'sourceCardIn 0.2s ease-out',
              }}
            >
              <span style={{ fontSize: '11px', color: '#22c55e' }}>
                {t.dataSources.scanComplete} — {scan.scannedFiles} {t.dataSources.files}, +{scan.createdMemories} {t.dataSources.memories}
              </span>
              <button
                onClick={resetScan}
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: '#9ca3af',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          )}

          {/* ── Scan error ── */}
          {scan.phase === 'error' && (
            <div
              style={{
                borderRadius: '8px',
                border: '1px solid rgba(239,68,68,0.25)',
                background: 'rgba(239,68,68,0.04)',
                padding: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                animation: 'sourceCardIn 0.2s ease-out',
              }}
            >
              <span style={{ fontSize: '11px', color: '#f87171' }}>
                {t.dataSources.scanError}: {scan.errorMessage}
              </span>
              <button
                onClick={resetScan}
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: '#9ca3af',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          )}

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
                {t.dataSources.scanning}
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
          {!loading && !error && sources.length === 0 && scan.phase === 'idle' && !showAddForm && (
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
                {t.dataSources.noSources}
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
