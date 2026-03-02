import { useState, useEffect, useCallback } from 'react';
import type { MemoryConflict } from '../api/client';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';

interface ConflictsPanelProps {
  project?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#60a5fa',
};

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function ConflictsPanel({ project }: ConflictsPanelProps) {
  const { t } = useTranslation();
  const [conflicts, setConflicts]   = useState<MemoryConflict[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [resolving, setResolving]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getConflicts(project);
      // Only show open conflicts
      const open = (res.data ?? []).filter((c) => c.status === 'open');
      const sorted = open.sort((a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
      );
      setConflicts(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conflicts');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  const handleAction = useCallback(async (
    id: string,
    action: 'supersede' | 'keep_both' | 'dismiss',
  ) => {
    setResolving(id);
    try {
      if (action === 'dismiss') {
        await api.dismissConflict(id);
      } else {
        await api.resolveConflict(id, action, action);
      }
      await load();
    } catch {
      // Silently ignore — keep conflict in list
    } finally {
      setResolving(null);
    }
  }, [load]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div
          style={{
            width: '24px', height: '24px', borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.08)',
            borderTopColor: '#60a5fa',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#f87171', marginBottom: '8px' }}>{error}</div>
          <button
            onClick={() => void load()}
            style={{
              fontSize: '11px', padding: '4px 12px', borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: '#9ca3af', cursor: 'pointer',
            }}
          >
            {t.conflictsPanel.retry}
          </button>
        </div>
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '44px', height: '44px', margin: '0 auto 12px',
              borderRadius: '50%',
              border: '2px solid rgba(34,197,94,0.3)',
              background: 'rgba(34,197,94,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px',
            }}
          >
            ✓
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>
            {t.conflictsPanel.noConflicts}
          </div>
          <div style={{ fontSize: '11px', color: '#4b5563' }}>
            {t.conflictsPanel.allConsistent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#e5e7eb', letterSpacing: '0.05em' }}>
          {t.conflictsPanel.unresolvedConflicts}
        </span>
        <span
          style={{
            fontSize: '10px', fontFamily: 'monospace',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '999px', padding: '1px 8px',
            color: '#f87171',
          }}
        >
          {conflicts.length}
        </span>
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: '10px 12px', gap: '8px', display: 'flex', flexDirection: 'column', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
      >
        {conflicts.map((c) => {
          const color = SEVERITY_COLOR[c.severity] ?? '#6b7280';
          const busy  = resolving === c.id;
          return (
            <div
              key={c.id}
              style={{
                borderRadius: '8px',
                border: `1px solid ${color}28`,
                borderLeft: `3px solid ${color}`,
                background: `${color}08`,
                padding: '10px 12px',
                opacity: busy ? 0.6 : 1,
                transition: 'opacity 0.2s ease',
              }}
            >
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span
                  style={{
                    fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color,
                    background: `${color}22`,
                    border: `1px solid ${color}40`,
                    borderRadius: '999px', padding: '1px 6px',
                  }}
                >
                  {c.severity}
                </span>
                <span style={{ fontSize: '10px', color: '#4b5563', fontFamily: 'monospace', flex: 1 }}>
                  {c.id.slice(0, 8)}
                </span>
                <span style={{ fontSize: '10px', color: '#4b5563' }}>
                  {formatDate(c.created_at)}
                </span>
              </div>

              {/* Description */}
              <p style={{ fontSize: '11px', color: '#9ca3af', margin: '0 0 10px', lineHeight: 1.6 }}>
                {c.description}
              </p>

              {/* Memory pair */}
              <div
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px',
                  marginBottom: '10px',
                }}
              >
                {(['memory_id', 'conflicting_memory_id'] as const).map((field, i) => (
                  <div
                    key={field}
                    style={{
                      padding: '6px 8px',
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '5px',
                    }}
                  >
                    <div style={{ fontSize: '9px', color: '#4b5563', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {t.conflictsPanel.memory} {i + 1}
                    </div>
                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#6b7280' }}>
                      {c[field].slice(0, 14)}…
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['supersede', 'keep_both', 'dismiss'] as const).map((action) => (
                  <button
                    key={action}
                    disabled={busy}
                    onClick={() => void handleAction(c.id, action)}
                    style={{
                      flex: 1,
                      fontSize: '10px', padding: '4px 6px', borderRadius: '5px',
                      border: action === 'supersede'
                        ? `1px solid ${color}44`
                        : '1px solid rgba(255,255,255,0.1)',
                      background: action === 'supersede'
                        ? `${color}14`
                        : 'rgba(255,255,255,0.03)',
                      color: action === 'supersede' ? color : '#6b7280',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                      textTransform: 'capitalize',
                    }}
                    onMouseEnter={(e) => {
                      if (busy) return;
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = action === 'supersede' ? `${color}28` : 'rgba(255,255,255,0.07)';
                      el.style.color = action === 'supersede' ? color : '#d1d5db';
                    }}
                    onMouseLeave={(e) => {
                      if (busy) return;
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = action === 'supersede' ? `${color}14` : 'rgba(255,255,255,0.03)';
                      el.style.color = action === 'supersede' ? color : '#6b7280';
                    }}
                  >
                    {action === 'supersede' ? t.conflictsPanel.supersede : action === 'keep_both' ? t.conflictsPanel.keepBoth : t.conflictsPanel.dismiss}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
