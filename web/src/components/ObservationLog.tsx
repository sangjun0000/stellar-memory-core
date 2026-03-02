import { useState, useEffect, useCallback } from 'react';
import type { ObservationEntry } from '../api/client';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';

interface ObservationLogProps {
  project?: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function ObservationLog({ project }: ObservationLogProps) {
  const { t, formatRelative: formatRel } = useTranslation();
  const [entries, setEntries]     = useState<ObservationEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getObservations(project, 50);
      setEntries(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load observations');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '24px' }}>
        <div
          style={{
            width: '18px', height: '18px', borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.08)',
            borderTopColor: '#34d399',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '12px', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '8px' }}>{error}</div>
        <button
          onClick={() => void load()}
          style={{
            fontSize: '10px', padding: '3px 10px', borderRadius: '5px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            color: '#9ca3af', cursor: 'pointer',
          }}
        >
          {t.observation.retry}
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.3 }}>👁️</div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>
          {t.observation.noObservations}
        </div>
        <div style={{ fontSize: '11px', color: '#4b5563', lineHeight: 1.6 }}>
          {t.observation.useObserve}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {entries.map((entry, i) => {
        const isExpanded = expanded.has(entry.id);
        const preview = entry.content.slice(0, 100);
        const isLong  = entry.content.length > 100;
        const isEven  = i % 2 === 0;

        return (
          <div
            key={entry.id}
            style={{
              display: 'flex', gap: '10px',
              padding: '8px 6px',
              background: isEven ? 'transparent' : 'rgba(255,255,255,0.015)',
              borderRadius: '5px',
            }}
          >
            {/* Timeline dot */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
              <div
                style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: entry.source === 'reflection' ? '#f59e0b' : '#34d399',
                  boxShadow: `0 0 5px ${entry.source === 'reflection' ? '#f59e0b66' : '#34d39966'}`,
                  marginTop: '3px',
                }}
              />
              {i < entries.length - 1 && (
                <div style={{ width: '1px', flex: 1, background: 'rgba(255,255,255,0.05)', minHeight: '12px' }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Meta row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span
                  style={{ fontSize: '9px', color: '#9ca3af', fontFamily: 'monospace' }}
                  title={entry.created_at}
                >
                  {formatRel(entry.created_at)} · {formatDate(entry.created_at)}
                </span>
                <span
                  style={{
                    fontSize: '9px', padding: '0 5px',
                    borderRadius: '999px',
                    background: entry.source === 'reflection' ? 'rgba(245,158,11,0.1)' : 'rgba(52,211,153,0.1)',
                    border: `1px solid ${entry.source === 'reflection' ? 'rgba(245,158,11,0.25)' : 'rgba(52,211,153,0.25)'}`,
                    color: entry.source === 'reflection' ? '#fcd34d' : '#6ee7b7',
                    textTransform: 'capitalize',
                  }}
                >
                  {entry.source}
                </span>
                {entry.extracted_memories.length > 0 && (
                  <span
                    style={{
                      fontSize: '9px', padding: '0 5px',
                      borderRadius: '999px',
                      background: 'rgba(96,165,250,0.1)',
                      border: '1px solid rgba(96,165,250,0.2)',
                      color: '#93c5fd',
                    }}
                  >
                    {entry.extracted_memories.length} {t.observation.memoriesExtracted}
                  </span>
                )}
              </div>

              {/* Content text */}
              <p
                style={{
                  margin: 0, fontSize: '11px', color: '#9ca3af', lineHeight: 1.55,
                  cursor: isLong ? 'pointer' : 'default',
                }}
                onClick={() => { if (isLong) toggleExpand(entry.id); }}
              >
                {isExpanded ? entry.content : preview}
                {isLong && !isExpanded && (
                  <span style={{ color: '#60a5fa', marginLeft: '4px', fontSize: '10px' }}>
                    {t.observation.showMore}
                  </span>
                )}
                {isExpanded && (
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleExpand(entry.id); }}
                    style={{ color: '#60a5fa', marginLeft: '4px', fontSize: '10px', cursor: 'pointer' }}
                  >
                    {t.observation.showLess}
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
