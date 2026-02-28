import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from './api/client';
import type { Memory, SunState, ZoneStat, OrbitZone } from './api/client';
import { Layout } from './components/Layout';
import { SolarSystem } from './components/SolarSystem';
import { MemoryDetail } from './components/MemoryDetail';
import { ZoneStats } from './components/ZoneStats';
import { SearchBar } from './components/SearchBar';
import type { SearchFilters } from './components/SearchBar';
import { DataSources } from './components/DataSources';
import { StatsBar } from './components/StatsBar';

// ---------------------------------------------------------------------------
// Polling intervals (ms)
// ---------------------------------------------------------------------------

const POLL_MEMORIES_MS = 30_000;  // 30 s
const POLL_SUN_MS      = 60_000;  // 60 s

// ---------------------------------------------------------------------------
// Sun detail panel
// ---------------------------------------------------------------------------

function SunDetail({ sun, onClose }: { sun: SunState | null; onClose: () => void }) {
  if (!sun) {
    return (
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>Sun State</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white">&#x2715;</button>
        </div>
        <div className="p-4 text-sm text-gray-500">No sun state committed yet.</div>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header flex items-center justify-between">
        <span>Sun State &mdash; {sun.project}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
          &#x2715;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {sun.current_work && (
          <div>
            <div className="text-gray-500 mb-1">Current Work</div>
            <p className="text-gray-300 leading-relaxed">{sun.current_work}</p>
          </div>
        )}
        {sun.recent_decisions.length > 0 && (
          <div>
            <div className="text-gray-500 mb-1">Recent Decisions</div>
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
            <div className="text-gray-500 mb-1">Next Steps</div>
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
            <div className="text-gray-500 mb-1">Active Errors</div>
            <ul className="space-y-1">
              {sun.active_errors.map((e, i) => (
                <li key={i} className="text-red-400">{e}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-gray-600 pt-1">
          Tokens: {sun.token_count} &middot; Committed:{' '}
          {sun.last_commit_at
            ? new Date(sun.last_commit_at).toLocaleString()
            : 'never'}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

type DetailPanel = { type: 'memory'; memory: Memory } | { type: 'sun' } | null;

export default function App() {
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

  // Track active search so polling doesn't overwrite search results
  const activeSearchRef = useRef<SearchFilters | null>(null);

  // ---------------------------------------------------------------------------
  // Data loaders
  // ---------------------------------------------------------------------------

  const refreshMemories = useCallback(async (proj: string) => {
    // Don't overwrite an active search with the polling refresh
    if (activeSearchRef.current) return;
    try {
      const res = await api.getMemories({ project: proj, zone: activeZone });
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
        api.getMemories({ project: proj }),
        api.getSun(proj),
        api.getZoneStats(proj),
      ]);
      setMemories(memRes.data);
      setSun(sunRes.data);
      setZones(zoneRes.data);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Polling — set up after initial load completes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    void loadAll(project);
  }, [loadAll, project]);

  // Memories poll (30 s)
  useEffect(() => {
    const id = setInterval(() => void refreshMemories(project), POLL_MEMORIES_MS);
    return () => clearInterval(id);
  }, [refreshMemories, project]);

  // Sun poll (60 s)
  useEffect(() => {
    const id = setInterval(() => void refreshSun(project), POLL_SUN_MS);
    return () => clearInterval(id);
  }, [refreshSun, project]);

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
      const res = await api.getMemories({ project, zone });
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
    () => memories.filter((m) => m.content && m.content.trim().length > 0),
    [memories],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Sidebar
  const sidebar = (
    <div className="space-y-2">
      {/* Project selector */}
      <div className="panel">
        <div className="panel-header">Project</div>
        <div className="p-2">
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            onBlur={() => loadAll(project)}
            className="w-full bg-space-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
            aria-label="Project name"
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
        <div className="panel-header">Actions</div>
        <div className="p-2 space-y-1">
          <button
            onClick={handleOrbitRecalc}
            className="w-full text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded px-2 py-1.5 text-left transition-colors"
          >
            Recalculate orbits
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
      />

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
            Loading...
          </div>
        ) : (
          <SolarSystem
            memories={visibleMemories}
            sun={sun}
            selectedId={selectedId}
            onSelectMemory={(m) => setDetail(m ? { type: 'memory', memory: m } : null)}
            onSelectSun={() => setDetail({ type: 'sun' })}
            onDragEnd={handleDragEnd}
            totalCount={memories.length}
          />
        )}
      </div>
    </div>
  );

  // Detail panel
  const detailPanel =
    detail?.type === 'memory' ? (
      <MemoryDetail
        memory={detail.memory}
        onClose={() => setDetail(null)}
        onForget={handleForget}
      />
    ) : detail?.type === 'sun' ? (
      <SunDetail sun={sun} onClose={() => setDetail(null)} />
    ) : null;

  return <Layout sidebar={sidebar} main={main} detail={detailPanel} />;
}
