import { useState, useEffect, useCallback } from 'react';
import type { Memory } from '../api/client';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';

interface ConsolidationPanelProps {
  project?: string;
}

interface CandidateGroup {
  memories: Memory[];
  similarity: number;
}

interface RunResult {
  groupsFound: number;
  memoriesConsolidated: number;
  newMemoriesCreated: number;
}

export function ConsolidationPanel({ project }: ConsolidationPanelProps) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<CandidateGroup[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [running, setRunning]       = useState(false);
  const [result, setResult]         = useState<RunResult | null>(null);
  const [mergingIdx, setMergingIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getConsolidationCandidates(project);
      setCandidates(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  const handleAutoConsolidate = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await api.runConsolidation(project);
      setResult(res.data);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Consolidation failed');
    } finally {
      setRunning(false);
    }
  }, [project, load]);

  const handleMergeGroup = useCallback(async (idx: number) => {
    setMergingIdx(idx);
    try {
      await api.runConsolidation(project);
      await load();
    } catch {
      // Silently ignore
    } finally {
      setMergingIdx(null);
    }
  }, [project, load]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#e5e7eb', flex: 1, letterSpacing: '0.05em' }}>
          {t.consolidation.header}
        </span>
        <button
          onClick={() => void handleAutoConsolidate()}
          disabled={running || loading}
          style={{
            fontSize: '10px', padding: '4px 10px', borderRadius: '6px',
            border: '1px solid rgba(99,102,241,0.4)',
            background: running ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.12)',
            color: '#a5b4fc',
            cursor: running || loading ? 'not-allowed' : 'pointer',
            opacity: running || loading ? 0.6 : 1,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (running || loading) return;
            const el = e.currentTarget as HTMLElement;
            el.style.background = 'rgba(99,102,241,0.2)';
            el.style.color = '#c7d2fe';
          }}
          onMouseLeave={(e) => {
            if (running || loading) return;
            const el = e.currentTarget as HTMLElement;
            el.style.background = 'rgba(99,102,241,0.12)';
            el.style.color = '#a5b4fc';
          }}
        >
          {running ? t.consolidation.running : t.consolidation.runAuto}
        </button>
      </div>

      {/* Result banner */}
      {result && (
        <div
          style={{
            flexShrink: 0, margin: '8px 12px 0',
            padding: '8px 10px', borderRadius: '7px',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.25)',
            fontSize: '11px', color: '#86efac',
            display: 'flex', gap: '16px',
          }}
        >
          <span>{t.consolidation.groupsFound}: <strong>{result.groupsFound}</strong></span>
          <span>{t.consolidation.consolidated}: <strong>{result.memoriesConsolidated}</strong></span>
          <span>{t.consolidation.newMemories}: <strong>{result.newMemoriesCreated}</strong></span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            flexShrink: 0, margin: '8px 12px 0',
            padding: '7px 10px', borderRadius: '7px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            fontSize: '11px', color: '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '12px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '40px' }}>
            <div
              style={{
                width: '20px', height: '20px', borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.08)',
                borderTopColor: '#818cf8',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '40px' }}>
            <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.3 }}>⬡</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>
              {t.consolidation.noCandidates}
            </div>
            <div style={{ fontSize: '11px', color: '#4b5563' }}>
              {t.consolidation.allDistinct}
            </div>
          </div>
        ) : (
          candidates.map((group, idx) => {
            const busy = mergingIdx === idx;
            const simPct = (group.similarity * 100).toFixed(0);
            return (
              <div
                key={idx}
                style={{
                  borderRadius: '8px',
                  border: '1px dashed rgba(99,102,241,0.25)',
                  background: 'rgba(99,102,241,0.04)',
                  padding: '10px 12px',
                  opacity: busy ? 0.6 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                {/* Group header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontSize: '10px', fontWeight: 600, color: '#818cf8',
                      background: 'rgba(99,102,241,0.12)',
                      border: '1px solid rgba(99,102,241,0.25)',
                      borderRadius: '999px', padding: '1px 7px',
                    }}
                  >
                    {group.memories.length} {t.consolidation.memories}
                  </span>
                  <span
                    style={{
                      fontSize: '10px', color: '#6b7280', fontFamily: 'monospace',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '4px', padding: '1px 5px',
                    }}
                  >
                    {simPct}% {t.consolidation.similar}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    disabled={busy}
                    onClick={() => void handleMergeGroup(idx)}
                    style={{
                      fontSize: '10px', padding: '3px 10px', borderRadius: '5px',
                      border: '1px solid rgba(99,102,241,0.4)',
                      background: busy ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.12)',
                      color: '#a5b4fc',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (busy) return;
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(99,102,241,0.22)';
                      el.style.color = '#c7d2fe';
                    }}
                    onMouseLeave={(e) => {
                      if (busy) return;
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(99,102,241,0.12)';
                      el.style.color = '#a5b4fc';
                    }}
                  >
                    {busy ? t.consolidation.merging : t.consolidation.merge}
                  </button>
                </div>

                {/* Memory pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {group.memories.map((m) => (
                    <span
                      key={m.id}
                      title={m.content.slice(0, 100)}
                      style={{
                        fontSize: '10px', padding: '2px 8px',
                        borderRadius: '999px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.09)',
                        color: '#9ca3af',
                        maxWidth: '180px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {m.summary || m.content.slice(0, 40)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
