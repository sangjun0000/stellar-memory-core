import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';
import type {
  AnalyticsOverview,
  MemoryHealth,
  SurvivalPoint,
  TopicCluster,
  OrbitZone,
  MemoryType,
} from '../api/client';
import { RingChart } from './charts/RingChart';
import { BarChart } from './charts/BarChart';
import { LineChart } from './charts/LineChart';

// ── Color palettes ─────────────────────────────────────────────────────────

const ZONE_COLORS: Record<string, string> = {
  core:      '#f97316',
  near:      '#eab308',
  active:    '#22c55e',
  archive:   '#3b82f6',
  fading:    '#8b5cf6',
  forgotten: '#6b7280',
};

const MEMORY_COLORS: Record<string, string> = {
  decision:    '#3b82f6',
  error:       '#ef4444',
  task:        '#22c55e',
  observation: '#94a3b8',
  milestone:   '#f59e0b',
  context:     '#8b5cf6',
  procedural:  '#06b6d4',
};

const ZONE_ORDER: OrbitZone[] = ['core', 'near', 'active', 'archive', 'fading', 'forgotten'];
const TYPE_ORDER: MemoryType[] = ['decision', 'error', 'task', 'milestone', 'context', 'observation', 'procedural'];

// ── Skeleton loader ────────────────────────────────────────────────────────

function Skeleton({ w, h, className }: { w?: string | number; h?: string | number; className?: string }) {
  return (
    <div
      className={className}
      style={{
        width:        w ?? '100%',
        height:       h ?? 16,
        borderRadius: 6,
        background:   'rgba(255,255,255,0.05)',
        animation:    'analytics-pulse 1.4s ease-in-out infinite',
      }}
    />
  );
}

// ── Card wrapper ───────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background:   'rgba(10,22,40,0.7)',
        border:       '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        padding:      '16px 18px',
      }}
    >
      <div
        style={{
          fontSize:      11,
          fontWeight:    600,
          color:         '#4b5563',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom:  14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  accentColor,
  ring,
}: {
  label:        string;
  value:        string | number;
  sub?:         React.ReactNode;
  accentColor?: string;
  ring?:        { value: number; max?: number; color: string };
}) {
  return (
    <div
      style={{
        background:   'rgba(10,22,40,0.7)',
        border:       '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        padding:      '14px 16px',
        display:      'flex',
        alignItems:   'center',
        gap:          12,
      }}
    >
      {ring && (
        <RingChart value={ring.value} max={ring.max ?? 1} color={ring.color} size={52} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          {label}
        </div>
        <div
          style={{
            fontSize:   22,
            fontWeight: 800,
            fontFamily: 'monospace',
            color:      accentColor ?? '#f3f4f6',
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recommendations ────────────────────────────────────────────────────────

function Recommendations({ items }: { items: string[] }) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#374151', textAlign: 'center', padding: '20px 0' }}>
        {t.analytics.allHealthy}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((rec, i) => (
        <div
          key={i}
          style={{
            display:      'flex',
            alignItems:   'flex-start',
            gap:          10,
            padding:      '10px 12px',
            background:   'rgba(251,191,36,0.06)',
            border:       '1px solid rgba(251,191,36,0.18)',
            borderRadius: 8,
          }}
        >
          <span style={{ fontSize: 13, opacity: 0.7, flexShrink: 0, marginTop: 1 }}>&#x1F4A1;</span>
          <span style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.55 }}>{rec}</span>
        </div>
      ))}
    </div>
  );
}

// ── Top Tags ───────────────────────────────────────────────────────────────

function TopTags({ tags }: { tags: Array<{ tag: string; count: number }> }) {
  const { t } = useTranslation();
  if (tags.length === 0) {
    return <div style={{ fontSize: 12, color: '#374151' }}>{t.analytics.noTags}</div>;
  }
  const maxCount = Math.max(...tags.map((t) => t.count), 1);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {tags.slice(0, 15).map((t) => {
        const opacity = 0.4 + 0.6 * (t.count / maxCount);
        return (
          <div
            key={t.tag}
            style={{
              display:      'inline-flex',
              alignItems:   'center',
              gap:          5,
              padding:      '3px 9px',
              borderRadius: 999,
              background:   `rgba(96,165,250,${(opacity * 0.15).toFixed(2)})`,
              border:       `1px solid rgba(96,165,250,${(opacity * 0.4).toFixed(2)})`,
              fontSize:     11,
              color:        `rgba(147,197,253,${opacity.toFixed(2)})`,
            }}
          >
            <span>{t.tag}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.7 }}>{t.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Topic Clusters Table ───────────────────────────────────────────────────

function TopicClustersTable({ clusters }: { clusters: TopicCluster[] }) {
  const { t } = useTranslation();
  if (clusters.length === 0) {
    return <div style={{ fontSize: 12, color: '#374151' }}>{t.analytics.noTopicClusters}</div>;
  }

  const sorted = [...clusters].sort((a, b) => b.recentActivity - a.recentActivity);
  const maxImportance = Math.max(...clusters.map((c) => c.avgImportance), 1);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {[t.analytics.topic, t.analytics.count, t.analytics.avgImportanceCol, t.analytics.activity7d].map((h) => (
              <th
                key={h}
                style={{
                  textAlign:     'left',
                  padding:       '4px 8px',
                  color:         '#374151',
                  fontSize:      10,
                  fontWeight:    600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  borderBottom:  '1px solid rgba(255,255,255,0.05)',
                  whiteSpace:    'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const impPct = (c.avgImportance / maxImportance) * 100;
            return (
              <tr
                key={i}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
              >
                <td style={{ padding: '7px 8px', color: '#d1d5db', maxWidth: 160 }}>
                  <span style={{
                    display:    'inline-block',
                    maxWidth:   '100%',
                    overflow:   'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {c.topic}
                  </span>
                </td>
                <td style={{ padding: '7px 8px', color: '#9ca3af', fontFamily: 'monospace' }}>
                  {c.memoryCount}
                </td>
                <td style={{ padding: '7px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        width:        60,
                        height:       5,
                        borderRadius: 999,
                        background:   'rgba(255,255,255,0.06)',
                        overflow:     'hidden',
                        flexShrink:   0,
                      }}
                    >
                      <div
                        style={{
                          width:        `${impPct}%`,
                          height:       '100%',
                          borderRadius: 999,
                          background:   '#60a5fa',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>
                      {(c.avgImportance * 100).toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: c.recentActivity > 0 ? '#22c55e' : '#374151' }}>
                  {c.recentActivity}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface AnalyticsDashboardProps {
  project?: string;
}

interface DashData {
  overview:  AnalyticsOverview;
  health:    MemoryHealth;
  survival:  SurvivalPoint[];
  clusters:  TopicCluster[];
}

export function AnalyticsDashboard({ project }: AnalyticsDashboardProps) {
  const { t } = useTranslation();
  const [data,    setData]    = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.getAnalyticsOverview(project),
      api.getMemoryHealth(project),
      api.getSurvivalCurve(project),
      api.getTopicClusters(project),
    ])
      .then(([ovRes, hRes, svRes, clRes]) => {
        if (cancelled) return;
        setData({
          overview: ovRes.data,
          health:   hRes.data,
          survival: svRes.data,
          clusters: clRes.data,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [project]);

  // CSS animation injection
  useEffect(() => {
    if (document.getElementById('analytics-css')) return;
    const el = document.createElement('style');
    el.id = 'analytics-css';
    el.textContent = `
      @keyframes analytics-pulse {
        0%, 100% { opacity: 0.5; }
        50%       { opacity: 0.15; }
      }
    `;
    document.head.appendChild(el);
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Stat tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ background: 'rgba(10,22,40,0.7)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 16px' }}>
              <Skeleton h={10} w={80} className="mb-2" />
              <Skeleton h={28} w={60} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: 'rgba(10,22,40,0.7)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px', height: 180 }}>
            <Skeleton h={10} w={120} />
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={10} />)}
            </div>
          </div>
          <div style={{ background: 'rgba(10,22,40,0.7)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px', height: 180 }}>
            <Skeleton h={10} w={120} />
          </div>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#f87171', marginBottom: 8 }}>{t.analytics.failedToLoad}</div>
        <div style={{ fontSize: 11, color: '#4b5563' }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { overview, health, survival, clusters } = data;

  // ── Prepare chart data ───────────────────────────────────────────────────

  const zoneBarData = ZONE_ORDER
    .filter((z) => (overview.zone_distribution[z] ?? 0) > 0)
    .map((z) => ({
      label: z,
      value: overview.zone_distribution[z] ?? 0,
      color: ZONE_COLORS[z] ?? '#6b7280',
    }));

  const typeBarData = TYPE_ORDER
    .filter((t) => (overview.type_distribution[t] ?? 0) > 0)
    .map((t) => ({
      label: t,
      value: overview.type_distribution[t] ?? 0,
      color: MEMORY_COLORS[t] ?? '#94a3b8',
    }));

  const survivalLine1 = survival.map((s) => ({ x: s.ageInDays, y: s.survivingCount }));
  const survivalLine2 = survival.map((s) => ({ x: s.ageInDays, y: s.forgottenCount }));

  // Stale = memories with staleRatio implied count
  const staleCount = Math.round(health.staleRatio * health.totalMemories);
  const activeRatioColor =
    health.activeRatio >= 0.6 ? '#22c55e' :
    health.activeRatio >= 0.3 ? '#f59e0b' : '#ef4444';
  const qualityColor =
    health.qualityAvg >= 0.7 ? '#22c55e' :
    health.qualityAvg >= 0.4 ? '#f59e0b' : '#ef4444';
  const conflictCount = Math.round(health.conflictRatio * health.totalMemories);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        height:    '100%',
        overflowY: 'auto',
        padding:   '20px 24px',
        display:   'flex',
        flexDirection: 'column',
        gap:       16,
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}
    >
      {/* Section 1 — Health overview tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
        <StatTile
          label={t.analytics.totalMemories}
          value={overview.total_memories}
          accentColor="#f3f4f6"
        />
        <StatTile
          label={t.analytics.activeRatio}
          value={`${(health.activeRatio * 100).toFixed(0)}%`}
          accentColor={activeRatioColor}
          sub={t.analytics.accessedRecently}
          ring={{ value: health.activeRatio, max: 1, color: activeRatioColor }}
        />
        <StatTile
          label={t.analytics.avgQuality}
          value={`${(health.qualityAvg * 100).toFixed(0)}%`}
          accentColor={qualityColor}
          sub={t.analytics.acrossAll}
          ring={{ value: health.qualityAvg, max: 1, color: qualityColor }}
        />
        <StatTile
          label={t.analytics.staleMemories}
          value={staleCount}
          accentColor={staleCount > 0 ? '#f59e0b' : '#374151'}
          sub={t.analytics.notAccessed30}
        />
        <StatTile
          label={t.analytics.conflicts}
          value={conflictCount}
          accentColor={conflictCount > 0 ? '#ef4444' : '#374151'}
          sub={conflictCount > 0 ? t.analytics.unresolved : t.analytics.noneDetected}
        />
      </div>

      {/* Section 2+3 — Zone and Type distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title={t.analytics.zoneDistribution}>
          {zoneBarData.length > 0
            ? <BarChart data={zoneBarData} showPercent />
            : <div style={{ fontSize: 12, color: '#374151' }}>{t.analytics.noZoneData}</div>
          }
        </Card>
        <Card title={t.analytics.memoryTypes}>
          {typeBarData.length > 0
            ? <BarChart data={typeBarData} />
            : <div style={{ fontSize: 12, color: '#374151' }}>{t.analytics.noTypeData}</div>
          }
        </Card>
      </div>

      {/* Section 4 — Survival curve */}
      <Card title={t.analytics.survivalCurve}>
        {survival.length > 0 ? (
          <>
            <LineChart
              data={survivalLine1}
              data2={survivalLine2}
              color="#22c55e"
              color2="#ef4444"
              height={160}
              xLabel="Age (days)"
              yLabel="Count"
            />
            <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
              {[
                { label: t.analytics.surviving, color: '#22c55e' },
                { label: t.analytics.forgotten, color: '#ef4444' },
              ].map(({ label, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
                  <span style={{ display: 'inline-block', width: 20, height: 2, background: color, borderRadius: 1 }} />
                  {label}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#374151', textAlign: 'center', padding: '24px 0' }}>
            {t.analytics.notEnoughData}
          </div>
        )}
      </Card>

      {/* Section 5 — Topic clusters */}
      <Card title={t.analytics.topicClusters}>
        <TopicClustersTable clusters={clusters} />
      </Card>

      {/* Section 6 — Recommendations */}
      <Card title={t.analytics.recommendations}>
        <Recommendations items={health.recommendations} />
      </Card>

      {/* Section 7 — Top tags */}
      <Card title={t.analytics.topTags}>
        <TopTags tags={overview.top_tags} />
      </Card>

      {/* Extra metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
        <StatTile
          label={t.analytics.recallSuccess}
          value={`${(overview.recall_success_rate * 100).toFixed(0)}%`}
          accentColor="#60a5fa"
        />
        <StatTile
          label={t.analytics.avgImportance}
          value={`${(overview.avg_importance * 100).toFixed(0)}%`}
          accentColor="#a78bfa"
        />
        <StatTile
          label={t.analytics.consolidations}
          value={overview.consolidation_count}
          accentColor="#f59e0b"
          sub={t.analytics.memoriesMerged}
        />
        <StatTile
          label={t.analytics.consolidationOps}
          value={health.consolidationOpportunities}
          accentColor={health.consolidationOpportunities > 0 ? '#f59e0b' : '#374151'}
          sub={t.analytics.similarFound}
        />
      </div>
    </div>
  );
}
