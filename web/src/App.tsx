import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from './api/client';
import type { Memory, SunState, ZoneStat, OrbitZone, ConstellationEdge } from './api/client';
import { useTranslation } from './i18n/context';
import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/Layout';
import { SolarSystem } from './components/SolarSystem';
import { MemoryDetail } from './components/MemoryDetail';
import { ZoneStats } from './components/ZoneStats';
import { SearchBar } from './components/SearchBar';
import type { SearchFilters } from './components/SearchBar';
import { DataSources } from './components/DataSources';
import { StatsBar } from './components/StatsBar';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ConflictsPanel } from './components/ConflictsPanel';
import { ConsolidationPanel } from './components/ConsolidationPanel';
import { ObservationLog } from './components/ObservationLog';
import { ProceduralRules } from './components/ProceduralRules';
import { TemporalTimeline } from './components/TemporalTimeline';
import { OnboardingScreen } from './components/OnboardingScreen';

// ---------------------------------------------------------------------------
// Polling intervals (ms)
// ---------------------------------------------------------------------------

const POLL_MEMORIES_MS = 30_000;  // 30 s
const POLL_SUN_MS      = 60_000;  // 60 s

// ---------------------------------------------------------------------------
// Sun detail panel
// ---------------------------------------------------------------------------

function SunDetail({ sun, onClose }: { sun: SunState | null; onClose: () => void }) {
  const { t } = useTranslation();

  if (!sun) {
    return (
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>{t.sun.header}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white">&#x2715;</button>
        </div>
        <div className="p-4 text-sm text-gray-500">{t.sun.noState}</div>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header flex items-center justify-between">
        <span>{t.sun.header} &mdash; {sun.project}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label={t.common.close}>
          &#x2715;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {sun.current_work && (
          <div>
            <div className="text-gray-500 mb-1">{t.sun.currentWork}</div>
            <p className="text-gray-300 leading-relaxed">{sun.current_work}</p>
          </div>
        )}
        {sun.recent_decisions.length > 0 && (
          <div>
            <div className="text-gray-500 mb-1">{t.sun.recentDecisions}</div>
            <ul className="space-y-1">
              {sun.recent_decisions.map((d, i) => (
                <li key={i} className="text-gray-400 flex gap-1">
                  <span className="text-blue-400">{i + 1}.</span> {d}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sun.next_steps.length > 0 && (
          <div>
            <div className="text-gray-500 mb-1">{t.sun.nextSteps}</div>
            <ul className="space-y-1">
              {sun.next_steps.map((s, i) => (
                <li key={i} className="text-gray-400 flex gap-1">
                  <span className="text-green-400">{i + 1}.</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sun.active_errors.length > 0 && (
          <div>
            <div className="text-gray-500 mb-1">{t.sun.activeErrors}</div>
            <ul className="space-y-1">
              {sun.active_errors.map((e, i) => (
                <li key={i} className="text-red-400">{e}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-gray-600 pt-1">
          {t.sun.tokens}: {sun.token_count} &middot; {t.sun.committed}:{' '}
          {sun.last_commit_at
            ? new Date(sun.last_commit_at).toLocaleString()
            : t.sun.never}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

type DetailPanel = { type: 'memory'; memory: Memory } | { type: 'sun' } | null;
type AppTab = 'solar' | 'analytics' | 'conflicts' | 'rules';

const TAB_KEYS: AppTab[] = ['solar', 'analytics', 'conflicts', 'rules'];

export default function App() {
  const { t } = useTranslation();
  const [memories, setMemories]             = useState<Memory[]>([]);
  const [sun, setSun]                       = useState<SunState | null>(null);
  const [zones, setZones]                   = useState<ZoneStat[]>([]);
  const [activeZone, setActiveZone]         = useState<OrbitZone | undefined>(undefined);
  const [project, setProject]               = useState('default');
  const [detail, setDetail]                 = useState<DetailPanel>(null);
  const [isSearching, setIsSearching]       = useState(false);
  const [searchResultCount, setSearchResultCount] = useState<number | undefined>(undefined);
  const [error, setError]                   = useState<string | null>(null);
  const [loading, setLoading]               = useState(true);
  const [isRefreshing, setIsRefreshing]     = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt]   = useState<number | null>(null);
  const [constellationEdges, setConstellationEdges] = useState<ConstellationEdge[]>([]);
  const [activeTab, setActiveTab]           = useState<AppTab>('solar');
  // Analytics / health stats for StatsBar enrichment
  const [avgQuality, setAvgQuality]         = useState<number | null>(null);
  const [conflictCount, setConflictCount]   = useState<number>(0);
  const [proceduralCount, setProceduralCount] = useState<number>(0);
  const [universalCount, setUniversalCount] = useState<number>(0);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [resumeScanning, setResumeScanning] = useState(false);

  // Track active search so polling doesn't overwrite search results
  const activeSearchRef = useRef<SearchFilters | null>(null);

  // WebSocket real-time connection
  const { status: wsStatus, lastEvent } = useWebSocket();

  // ---------------------------------------------------------------------------
  // Data loaders
  // ---------------------------------------------------------------------------

  const refreshMemories = useCallback(async (proj: string) => {
    // Don't overwrite an active search with the polling refresh
    if (activeSearchRef.current) return;
    try {
      const res = await api.getMemories({ project: proj, zone: activeZone, summary_only: 'true' });
      setMemories(res.data);
      setLastUpdatedAt(Date.now());
    } catch {
      // Silently ignore background poll errors — the user already sees data
    }
  }, [activeZone]);

  const refreshSun = useCallback(async (proj: string) => {
    try {
      const res = await api.getSun(proj);
      setSun(res.data);
    } catch {
      // Silently ignore
    }
  }, []);

  const loadAll = useCallback(async (proj: string) => {
    setLoading(true);
    setError(null);
    activeSearchRef.current = null;
    try {
      const [memRes, sunRes, zoneRes] = await Promise.all([
        api.getMemories({ project: proj, summary_only: 'true' }),
        api.getSun(proj),
        api.getZoneStats(proj),
      ]);
      setMemories(memRes.data);
      setSun(sunRes.data);
      setZones(zoneRes.data);
      setLastUpdatedAt(Date.now());

      // Derive quick stats from memory list
      const mems = memRes.data;
      const procedural = mems.filter((m) => m.type === 'procedural').length;
      const universal  = mems.filter((m) => m.is_universal).length;
      setProceduralCount(procedural);
      setUniversalCount(universal);

      // Load health/conflict stats in background (non-blocking)
      Promise.all([
        api.getMemoryHealth(proj).catch(() => null),
        api.getConflicts(proj).catch(() => null),
      ]).then(([healthRes, conflictRes]) => {
        if (healthRes) setAvgQuality(healthRes.data.qualityAvg ?? null);
        if (conflictRes) setConflictCount(conflictRes.total ?? 0);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // WebSocket event handler — react to real-time events
  // ---------------------------------------------------------------------------

  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    if (!lastEvent) return;

    const { type, project: eventProject } = lastEvent;

    // Only handle events for the current project (or global events)
    if (eventProject && eventProject !== projectRef.current) return;

    switch (type) {
      case 'memory:created':
      case 'memory:deleted':
      case 'orbit:recalculated':
        // Refresh memories list and zones
        void refreshMemories(projectRef.current);
        api.getZoneStats(projectRef.current)
          .then((res) => setZones(res.data))
          .catch(() => undefined);
        setLastUpdatedAt(Date.now());
        break;

      case 'memory:updated':
        // Lightweight: just refresh memories
        void refreshMemories(projectRef.current);
        setLastUpdatedAt(Date.now());
        break;

      case 'sun:updated':
        // Update sun state directly from event data if available
        void refreshSun(projectRef.current);
        setLastUpdatedAt(Date.now());
        break;
    }
  }, [lastEvent, refreshMemories, refreshSun]);

  // ---------------------------------------------------------------------------
  // Polling — set up after initial load completes (fallback when WS unavailable)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const init = async () => {
      await loadAll(project);

      // Check if onboarding should be shown
      const skipped = localStorage.getItem('stellar-onboarding-skipped');
      if (skipped) return;

      // Check if a scan is already in progress
      try {
        const scanStatus = await api.getScanStatus();
        if (scanStatus.data.isScanning) {
          setResumeScanning(true);
          setShowOnboarding(true);
          return;
        }
      } catch {
        // ignore
      }
    };
    void init();
  }, [loadAll, project]);

  // Show onboarding when memories list is empty (after loading completes)
  useEffect(() => {
    if (loading) return;
    const skipped = localStorage.getItem('stellar-onboarding-skipped');
    if (!skipped && memories.length === 0 && !showOnboarding) {
      setShowOnboarding(true);
    }
  }, [loading, memories.length, showOnboarding]);

  // Memories poll — 30s normally, 5min when WebSocket is connected (fallback)
  useEffect(() => {
    const interval = wsStatus === 'connected' ? POLL_MEMORIES_MS * 10 : POLL_MEMORIES_MS;
    const id = setInterval(() => void refreshMemories(project), interval);
    return () => clearInterval(id);
  }, [refreshMemories, project, wsStatus]);

  // Sun poll — 60s normally, 5min when WebSocket is connected (fallback)
  useEffect(() => {
    const interval = wsStatus === 'connected' ? POLL_SUN_MS * 5 : POLL_SUN_MS;
    const id = setInterval(() => void refreshSun(project), interval);
    return () => clearInterval(id);
  }, [refreshSun, project, wsStatus]);

  // ---------------------------------------------------------------------------
  // Manual refresh handler
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // If a search is active, re-run it; otherwise do a full reload
      if (activeSearchRef.current) {
        const f = activeSearchRef.current;
        const res = await api.searchMemories(f.query, project, f.type, f.zone);
        setMemories(res.data);
        setSearchResultCount(res.total);
      } else {
        const [memRes, sunRes, zoneRes] = await Promise.all([
          api.getMemories({ project, zone: activeZone }),
          api.getSun(project),
          api.getZoneStats(project),
        ]);
        setMemories(memRes.data);
        setSun(sunRes.data);
        setZones(zoneRes.data);
      }
      setLastUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, project, activeZone]);

  // ---------------------------------------------------------------------------
  // Zone filter
  // ---------------------------------------------------------------------------

  const handleZoneClick = useCallback(async (zone: OrbitZone | undefined) => {
    setActiveZone(zone);
    setSearchResultCount(undefined);
    activeSearchRef.current = null;
    try {
      const res = await api.getMemories({ project, zone, summary_only: 'true' });
      setMemories(res.data);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memories');
    }
  }, [project]);

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const handleSearch = useCallback(async (filters: SearchFilters) => {
    const { query, type, zone } = filters;

    if (!query && !type && !zone) {
      activeSearchRef.current = null;
      setSearchResultCount(undefined);
      setActiveZone(undefined);
      void loadAll(project);
      return;
    }

    activeSearchRef.current = filters;
    setIsSearching(true);
    try {
      const res = await api.searchMemories(query, project, type, zone);
      setMemories(res.data);
      setSearchResultCount(res.total);
      setActiveZone(undefined);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [project, loadAll]);

  // ---------------------------------------------------------------------------
  // Constellation — load edges when a memory is selected
  // ---------------------------------------------------------------------------

  const loadConstellation = useCallback(async (memoryId: string) => {
    try {
      const res = await api.getConstellation(memoryId, project);
      setConstellationEdges(res.data.edges);
    } catch {
      // Constellation unavailable — show no lines
      setConstellationEdges([]);
    }
  }, [project]);

  // ---------------------------------------------------------------------------
  // Forget
  // ---------------------------------------------------------------------------

  const handleForget = useCallback(async (id: string) => {
    try {
      await api.forgetMemory(id);
      setDetail(null);
      void loadAll(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to forget memory');
    }
  }, [project, loadAll]);

  // ---------------------------------------------------------------------------
  // Drag — update orbit distance
  // ---------------------------------------------------------------------------

  const handleDragEnd = useCallback(async (memoryId: string, newDistance: number) => {
    try {
      await api.updateOrbit(memoryId, newDistance);
      void loadAll(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update orbit');
    }
  }, [project, loadAll]);

  // ---------------------------------------------------------------------------
  // Orbit recalc
  // ---------------------------------------------------------------------------

  const handleOrbitRecalc = useCallback(async () => {
    try {
      await api.triggerOrbit(project);
      void loadAll(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Orbit recalculation failed');
    }
  }, [project, loadAll]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const selectedId   = detail?.type === 'memory' ? detail.memory.id : null;
  const totalMemories = zones.reduce((sum, z) => sum + z.count, 0) || memories.length;

  // Filter out empty/contentless memories from the 3D view
  const visibleMemories = useMemo(
    () => memories.filter((m) => (m.summary || m.content) && (m.summary || m.content || '').trim().length > 0),
    [memories],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Sidebar
  const sidebar = (
    <div className="space-y-2">
      {/* Project switcher */}
      <div className="panel">
        <div className="panel-header">{t.sidebar.project}</div>
        <div className="p-2">
          <ProjectSwitcher
            currentProject={project}
            onProjectChange={(p) => {
              setProject(p);
              void loadAll(p);
            }}
          />
        </div>
      </div>

      {/* Zone stats */}
      <ZoneStats
        zones={zones}
        total={totalMemories}
        onZoneClick={handleZoneClick}
        activeZone={activeZone}
      />

      {/* Data sources */}
      <DataSources project={project} />

      {/* Actions */}
      <div className="panel">
        <div className="panel-header">{t.sidebar.actions}</div>
        <div className="p-2 space-y-1">
          <button
            onClick={handleOrbitRecalc}
            className="w-full text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded px-2 py-1.5 text-left transition-colors"
          >
            {t.sidebar.recalculateOrbits}
          </button>
        </div>
      </div>
    </div>
  );

  // Main panel
  const main = (
    <div className="absolute inset-0 flex flex-col">
      {/* Stats bar */}
      <StatsBar
        totalMemories={totalMemories}
        zones={zones}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        avgQuality={avgQuality}
        conflictCount={conflictCount}
        proceduralCount={proceduralCount}
        universalCount={universalCount}
        wsStatus={wsStatus}
      />

      {/* Tab bar */}
      <div
        style={{
          flexShrink:   0,
          display:      'flex',
          alignItems:   'center',
          gap:          '2px',
          padding:      '4px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background:   'rgba(5,10,20,0.6)',
        }}
      >
        {TAB_KEYS.map((tab) => {
          const isActive = activeTab === tab;
          const tabInfo = t.tabs[tab];
          // conflict tab gets red badge if there are unresolved conflicts
          const badge = tab === 'conflicts' && conflictCount > 0 ? conflictCount : null;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                display:      'flex',
                flexDirection: 'column',
                alignItems:   'flex-start',
                gap:          '1px',
                padding:      '4px 12px',
                borderRadius: '6px',
                border:       isActive
                  ? '1px solid rgba(96,165,250,0.3)'
                  : '1px solid transparent',
                background:   isActive ? 'rgba(96,165,250,0.1)' : 'transparent',
                color:        isActive ? '#93c5fd' : '#6b7280',
                fontSize:     '11px',
                cursor:       'pointer',
                fontWeight:   isActive ? 600 : 400,
                transition:   'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (isActive) return;
                const el = e.currentTarget as HTMLElement;
                el.style.color = '#9ca3af';
                el.style.background = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                if (isActive) return;
                const el = e.currentTarget as HTMLElement;
                el.style.color = '#6b7280';
                el.style.background = 'transparent';
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                {tabInfo.label}
                {badge != null && (
                  <span style={{
                    fontSize:    '9px',
                    fontFamily:  'monospace',
                    fontWeight:  700,
                    color:       '#f87171',
                    background:  'rgba(239,68,68,0.15)',
                    border:      '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '999px',
                    padding:     '0px 4px',
                    lineHeight:  '14px',
                  }}>
                    {badge}
                  </span>
                )}
              </span>
              <span style={{
                fontSize:  '9px',
                fontWeight: 400,
                color:     isActive ? 'rgba(147,197,253,0.6)' : 'rgba(107,114,128,0.6)',
                lineHeight: 1.2,
              }}>
                {tabInfo.description}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="flex-shrink-0 p-2 border-b border-gray-800">
        <SearchBar
          onSearch={handleSearch}
          isSearching={isSearching}
          resultCount={searchResultCount}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex-shrink-0 mx-2 mt-2 px-3 py-2 bg-red-900/40 border border-red-800 rounded text-xs text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-200 ml-2"
            aria-label="Dismiss error"
          >
            &#x2715;
          </button>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            {t.common.loading}
          </div>
        ) : activeTab === 'analytics' ? (
          /* Analytics Dashboard */
          <div className="absolute inset-0">
            <AnalyticsDashboard project={project} />
          </div>
        ) : activeTab === 'conflicts' ? (
          /* Conflicts tab — ConflictsPanel + sub-sections */
          <div className="absolute inset-0 flex overflow-hidden">
            {/* Main conflicts column */}
            <div
              style={{
                flex: '0 0 50%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                borderRight: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <ConflictsPanel project={project} />
            </div>
            {/* Side column — Consolidation + Observations */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div
                style={{
                  flex: '0 0 50%', overflow: 'hidden',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <ConsolidationPanel project={project} />
              </div>
              <div
                style={{
                  flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    flexShrink: 0, padding: '8px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '11px', fontWeight: 600, color: '#e5e7eb', letterSpacing: '0.05em',
                  }}
                >
                  {t.observation.header}
                </div>
                <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
                  <ObservationLog project={project} />
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'rules' ? (
          /* Rules tab */
          <div className="absolute inset-0 overflow-hidden">
            <ProceduralRules project={project} />
          </div>
        ) : (
          <>
            <SolarSystem
              memories={visibleMemories}
              sun={sun}
              selectedId={selectedId}
              onSelectMemory={(m) => {
                setDetail(m ? { type: 'memory', memory: m } : null);
                if (m) {
                  void loadConstellation(m.id);
                } else {
                  setConstellationEdges([]);
                }
              }}
              onSelectSun={() => {
                setDetail({ type: 'sun' });
                setConstellationEdges([]);
              }}
              onDragEnd={handleDragEnd}
              totalCount={memories.length}
              constellationEdges={constellationEdges}
            />
            {showOnboarding && memories.length === 0 && (
              <OnboardingScreen
                resumeScanning={resumeScanning}
                onSkip={() => {
                  localStorage.setItem('stellar-onboarding-skipped', 'true');
                  setShowOnboarding(false);
                }}
                onComplete={() => {
                  setShowOnboarding(false);
                  setResumeScanning(false);
                  void loadAll(project);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );

  // Detail panel
  const hasTemporal =
    detail?.type === 'memory' &&
    (detail.memory.valid_from != null ||
      detail.memory.valid_until != null ||
      detail.memory.superseded_by != null);

  const detailPanel =
    detail?.type === 'memory' ? (
      <div className="h-full flex flex-col overflow-hidden">
        <div style={{ flex: hasTemporal ? '0 0 60%' : '1 1 auto', overflow: 'hidden' }}>
          <MemoryDetail
            key={detail.memory.id}
            memory={detail.memory}
            onClose={() => setDetail(null)}
            onForget={handleForget}
          />
        </div>
        {hasTemporal && (
          <div
            style={{
              flex: '0 0 40%', overflow: 'hidden',
              borderTop: '1px solid rgba(167,139,250,0.15)',
            }}
          >
            <TemporalTimeline memoryId={detail.memory.id} project={project} />
          </div>
        )}
      </div>
    ) : detail?.type === 'sun' ? (
      <SunDetail sun={sun} onClose={() => setDetail(null)} />
    ) : null;

  return <Layout sidebar={sidebar} main={main} detail={detailPanel} />;
}
