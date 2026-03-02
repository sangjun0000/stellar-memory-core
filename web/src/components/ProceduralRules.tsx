import { useState, useEffect, useCallback } from 'react';
import type { Memory } from '../api/client';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';

interface ProceduralRulesProps {
  project?: string;
}

function ImportanceBar({ value }: { value: number }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 60);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div
      style={{
        height: '2px', borderRadius: '999px', overflow: 'hidden',
        background: 'rgba(255,255,255,0.06)', flexShrink: 0,
      }}
    >
      <div
        style={{
          width: animated ? `${(value * 100).toFixed(0)}%` : '0%',
          height: '100%',
          background: 'linear-gradient(90deg, #06b6d4, #22d3ee)',
          boxShadow: '0 0 4px #06b6d466',
          borderRadius: '999px',
          transition: 'width 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
    </div>
  );
}

export function ProceduralRules({ project }: ProceduralRulesProps) {
  const { t } = useTranslation();
  const [rules, setRules]         = useState<Memory[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMemories({ project });
      const procedural = (res.data ?? []).filter((m) => m.type === 'procedural');
      setRules(procedural);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  const handleForget = useCallback(async (id: string) => {
    setForgetting(id);
    try {
      await api.forgetMemory(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // Silently ignore
    } finally {
      setForgetting(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div
          style={{
            width: '24px', height: '24px', borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.08)',
            borderTopColor: '#06b6d4',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
            {t.rules.retry}
          </button>
        </div>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8">
        <div
          style={{
            width: '44px', height: '44px',
            borderRadius: '50%',
            border: '2px solid rgba(6,182,212,0.25)',
            background: 'rgba(6,182,212,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', opacity: 0.7,
          }}
        >
          🧭
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e5e7eb', marginBottom: '6px' }}>
            {t.rules.noRules}
          </div>
          <div style={{ fontSize: '11px', color: '#4b5563', lineHeight: 1.6 }}>
            {t.rules.noRulesDesc.split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
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
          flexShrink: 0, padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#e5e7eb', letterSpacing: '0.05em' }}>
          {t.rules.header}
        </span>
        <span
          style={{
            fontSize: '10px', fontFamily: 'monospace',
            background: 'rgba(6,182,212,0.1)',
            border: '1px solid rgba(6,182,212,0.25)',
            borderRadius: '999px', padding: '1px 8px',
            color: '#67e8f9',
          }}
        >
          {rules.length}
        </span>
      </div>

      {/* Rules list */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: '8px 12px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {rules.map((rule, idx) => {
            const busy = forgetting === rule.id;
            // Extract "Rule: ..." pattern if present, otherwise use summary/content
            const ruleText = (() => {
              const match = /Rule:\s*(.+)/i.exec(rule.content);
              if (match) return match[1].trim();
              return rule.summary || rule.content.slice(0, 120);
            })();

            return (
              <div
                key={rule.id}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  opacity: busy ? 0.5 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                {/* Number + text row */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
                  <span
                    style={{
                      flexShrink: 0, width: '20px', height: '20px',
                      borderRadius: '50%',
                      border: '1px solid rgba(6,182,212,0.35)',
                      background: 'rgba(6,182,212,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '9px', fontWeight: 700, fontFamily: 'monospace',
                      color: '#22d3ee',
                    }}
                  >
                    {idx + 1}
                  </span>
                  <p
                    style={{
                      flex: 1, margin: 0,
                      fontSize: '12px', color: '#d1d5db', lineHeight: 1.55,
                    }}
                  >
                    {ruleText}
                  </p>
                </div>

                {/* Importance bar */}
                <div style={{ paddingLeft: '30px', marginBottom: '6px' }}>
                  <ImportanceBar value={rule.importance} />
                </div>

                {/* Tags + forget */}
                <div style={{ paddingLeft: '30px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {rule.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '9px', padding: '1px 6px',
                        borderRadius: '999px',
                        background: 'rgba(6,182,212,0.08)',
                        border: '1px solid rgba(6,182,212,0.2)',
                        color: '#67e8f9',
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button
                    disabled={busy}
                    onClick={() => void handleForget(rule.id)}
                    style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                      border: '1px solid rgba(239,68,68,0.25)',
                      background: 'rgba(239,68,68,0.06)',
                      color: '#f87171',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (busy) return;
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(239,68,68,0.15)';
                      el.style.borderColor = 'rgba(239,68,68,0.45)';
                    }}
                    onMouseLeave={(e) => {
                      if (busy) return;
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(239,68,68,0.06)';
                      el.style.borderColor = 'rgba(239,68,68,0.25)';
                    }}
                  >
                    {t.rules.forget}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer note */}
      <div
        style={{
          flexShrink: 0, padding: '8px 14px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          fontSize: '10px', color: '#374151', lineHeight: 1.5,
        }}
      >
        {t.rules.footer}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
