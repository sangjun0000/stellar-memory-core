import { useState, useEffect, useCallback } from 'react';
import type { Memory } from '../api/client';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';

interface TemporalTimelineProps {
  memoryId?: string;
  project?: string;
}

const TYPE_COLORS: Record<string, string> = {
  decision:    '#facc15',
  error:       '#ef4444',
  task:        '#60a5fa',
  observation: '#34d399',
  milestone:   '#f97316',
  context:     '#a78bfa',
  procedural:  '#22d3ee',
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function MemoryNode({
  memory,
  isActive,
  onClick,
}: {
  memory: Memory;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const color = TYPE_COLORS[memory.type] ?? '#6b7280';
  const isSuperseded = !!memory.superseded_by || !!memory.valid_until;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: '8px',
        border: isActive
          ? `1px solid ${color}60`
          : '1px solid rgba(255,255,255,0.06)',
        background: isActive
          ? `${color}0e`
          : 'rgba(0,0,0,0.2)',
        cursor: 'pointer',
        opacity: isSuperseded ? 0.55 : 1,
        transition: 'all 0.15s ease',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = `${color}50`;
        el.style.background = `${color}0c`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = isActive ? `${color}60` : 'rgba(255,255,255,0.06)';
        el.style.background = isActive ? `${color}0e` : 'rgba(0,0,0,0.2)';
      }}
    >
      {/* Type badge + superseded indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span
          style={{
            fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', padding: '1px 6px', borderRadius: '999px',
            color, background: `${color}18`, border: `1px solid ${color}30`,
          }}
        >
          {memory.type}
        </span>
        {isSuperseded && (
          <span
            style={{
              fontSize: '9px', color: '#6b7280',
              background: 'rgba(107,114,128,0.12)',
              border: '1px solid rgba(107,114,128,0.2)',
              borderRadius: '999px', padding: '1px 6px',
            }}
          >
            {t.temporal.superseded}
          </span>
        )}
        <span style={{ flex: 1, fontSize: '9px', fontFamily: 'monospace', color: '#374151', textAlign: 'right' }}>
          {memory.id.slice(0, 8)}
        </span>
      </div>

      {/* Summary */}
      <p
        style={{
          margin: '0 0 5px', fontSize: '11px',
          color: isSuperseded ? '#6b7280' : '#d1d5db',
          lineHeight: 1.5,
        }}
      >
        {memory.summary || memory.content.slice(0, 80)}
      </p>

      {/* Date range */}
      {(memory.valid_from || memory.valid_until) && (
        <div style={{ fontSize: '10px', color: '#4b5563', fontFamily: 'monospace' }}>
          {formatDate(memory.valid_from) ?? '—'}
          {' → '}
          {formatDate(memory.valid_until) ?? 'present'}
        </div>
      )}
    </div>
  );
}

export function TemporalTimeline({ memoryId, project }: TemporalTimelineProps) {
  const { t } = useTranslation();
  const [chain, setChain]               = useState<Memory[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Memory | null>(null);

  // Time Travel
  const [timeDate, setTimeDate]         = useState('');
  const [traveling, setTraveling]       = useState(false);
  const [timeTravelResult, setTimeTravelResult] = useState<Memory[] | null>(null);
  const [timeTravelError, setTimeTravelError]   = useState<string | null>(null);

  const loadChain = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setChain([]);
    setSelectedNode(null);
    try {
      const res = await api.getEvolutionChain(id);
      setChain(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load evolution chain');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (memoryId) void loadChain(memoryId);
    else { setChain([]); setLoading(false); }
  }, [memoryId, loadChain]);

  const handleTimeTravel = useCallback(async () => {
    if (!timeDate) return;
    setTraveling(true);
    setTimeTravelResult(null);
    setTimeTravelError(null);
    try {
      const res = await api.getContextAtTime(new Date(timeDate).toISOString(), project);
      setTimeTravelResult(res.data ?? []);
    } catch (e) {
      setTimeTravelError(e instanceof Error ? e.message : 'Time travel failed');
    } finally {
      setTraveling(false);
    }
  }, [timeDate, project]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        style={{
          flexShrink: 0, padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#e5e7eb', letterSpacing: '0.05em' }}>
          {t.temporal.header}
        </span>
        {memoryId && (
          <span
            style={{
              fontSize: '9px', fontFamily: 'monospace', color: '#4b5563',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '4px', padding: '1px 6px',
            }}
          >
            {memoryId.slice(0, 12)}…
          </span>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '12px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
      >
        {/* Evolution chain */}
        {!memoryId ? (
          <div style={{ textAlign: 'center', paddingTop: '20px' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.3 }}>⏳</div>
            <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.6 }}>
              {t.temporal.selectMemory.split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
            </div>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '24px' }}>
            <div
              style={{
                width: '20px', height: '20px', borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.08)',
                borderTopColor: '#a78bfa',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', color: '#f87171' }}>{error}</div>
          </div>
        ) : chain.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              {t.temporal.noHistory}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '10px', color: '#4b5563', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t.temporal.evolutionChain} — {chain.length} {chain.length !== 1 ? t.temporal.nodes : t.temporal.node}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {chain.map((mem, i) => (
                <div key={mem.id}>
                  <MemoryNode
                    memory={mem}
                    isActive={selectedNode?.id === mem.id}
                    onClick={() => setSelectedNode(selectedNode?.id === mem.id ? null : mem)}
                  />
                  {i < chain.length - 1 && (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '3px 0 3px 20px',
                      }}
                    >
                      <div
                        style={{
                          width: '1px', height: '16px',
                          background: 'rgba(167,139,250,0.2)',
                          marginLeft: '5px',
                        }}
                      />
                      <span style={{ fontSize: '9px', color: '#4b5563' }}>{t.temporal.supersededBy}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Selected node detail */}
            {selectedNode && (
              <div
                style={{
                  marginTop: '10px', padding: '10px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t.temporal.fullContent}
                </div>
                <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selectedNode.content}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            {t.temporal.timeTravel}
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <input
              type="date"
              value={timeDate}
              onChange={(e) => setTimeDate(e.target.value)}
              style={{
                flex: 1, fontSize: '11px', padding: '5px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(0,0,0,0.4)',
                color: '#d1d5db',
                colorScheme: 'dark',
                outline: 'none',
              }}
            />
            <button
              disabled={!timeDate || traveling}
              onClick={() => void handleTimeTravel()}
              style={{
                fontSize: '10px', padding: '5px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(167,139,250,0.35)',
                background: traveling ? 'rgba(167,139,250,0.05)' : 'rgba(167,139,250,0.1)',
                color: '#c4b5fd',
                cursor: !timeDate || traveling ? 'not-allowed' : 'pointer',
                opacity: !timeDate ? 0.5 : 1,
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!timeDate || traveling) return;
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'rgba(167,139,250,0.2)';
                el.style.color = '#ddd6fe';
              }}
              onMouseLeave={(e) => {
                if (!timeDate || traveling) return;
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'rgba(167,139,250,0.1)';
                el.style.color = '#c4b5fd';
              }}
            >
              {traveling ? t.temporal.traveling : t.temporal.viewContext}
            </button>
          </div>

          {timeTravelError && (
            <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '8px' }}>
              {timeTravelError}
            </div>
          )}

          {timeTravelResult !== null && (
            <div>
              <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '6px' }}>
                {timeTravelResult.length === 0
                  ? t.temporal.noMemoriesAtTime
                  : `${timeTravelResult.length} ${t.temporal.memoriesActiveOn} ${new Date(timeDate).toLocaleDateString()}`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {timeTravelResult.map((m) => {
                  const color = TYPE_COLORS[m.type] ?? '#6b7280';
                  return (
                    <div
                      key={m.id}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: `1px solid ${color}20`,
                        background: `${color}06`,
                      }}
                    >
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '9px', color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {m.type}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
                        {m.summary || m.content.slice(0, 80)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
