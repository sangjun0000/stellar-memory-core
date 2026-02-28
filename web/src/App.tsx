import { useState, useEffect, useCallback } from 'react';
import { api } from './api/client';
import type { Memory, SunState, ZoneStat, OrbitZone } from './api/client';
import { Layout } from './components/Layout';
import { SolarSystem } from './components/SolarSystem';
import { MemoryDetail } from './components/MemoryDetail';
import { ZoneStats } from './components/ZoneStats';
import { SearchBar } from './components/SearchBar';

// ---------------------------------------------------------------------------
// Sun detail panel
// ---------------------------------------------------------------------------

function SunDetail({ sun, onClose }: { sun: SunState | null; onClose: () => void }) {
  if (!sun) {
    return (
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <span>Sun State</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <div className="p-4 text-sm text-gray-500">No sun state committed yet.</div>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header flex items-center justify-between">
        <span>Sun State — {sun.project}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">✕</button>
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
          Tokens: {sun.token_count} · Committed:{' '}
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
  const [memories, setMemories] = useState<Memory[]>([]);
  const [sun, setSun] = useState<SunState | null>(null);
  const [zones, setZones] = useState<ZoneStat[]>([]);
  const [activeZone, setActiveZone] = useState<OrbitZone | undefined>(undefined);
  const [project, setProject] = useState('default');
  const [detail, setDetail] = useState<DetailPanel>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResultCount, setSearchResultCount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Initial load
  const loadAll = useCallback(async (proj: string) => {
    setLoading(true);
    setError(null);
    try {
      const [memRes, sunRes, zoneRes] = await Promise.all([
        api.getMemories({ project: proj }),
        api.getSun(proj),
        api.getZoneStats(proj),
      ]);
      setMemories(memRes.data);
      setSun(sunRes.data);
      setZones(zoneRes.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(project);
  }, [loadAll, project]);

  // Zone filter
  const handleZoneClick = useCallback(async (zone: OrbitZone | undefined) => {
    setActiveZone(zone);
    setSearchResultCount(undefined);
    try {
      const res = await api.getMemories({ project, zone });
      setMemories(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memories');
    }
  }, [project]);

  // Search
  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      setSearchResultCount(undefined);
      setActiveZone(undefined);
      void loadAll(project);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.searchMemories(query, project);
      setMemories(res.data);
      setSearchResultCount(res.total);
      setActiveZone(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [project, loadAll]);

  // Forget
  const handleForget = useCallback(async (id: string) => {
    try {
      await api.forgetMemory(id);
      setDetail(null);
      void loadAll(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to forget memory');
    }
  }, [project, loadAll]);

  // Orbit recalc
  const handleOrbitRecalc = useCallback(async () => {
    try {
      await api.triggerOrbit(project);
      void loadAll(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Orbit recalculation failed');
    }
  }, [project, loadAll]);

  const selectedId = detail?.type === 'memory' ? detail.memory.id : null;

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
        total={memories.length + (zones.reduce((s, z) => s + z.count, 0) === 0 ? 0 : 0)}
        onZoneClick={handleZoneClick}
        activeZone={activeZone}
      />

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
          <button
            onClick={() => loadAll(project)}
            className="w-full text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded px-2 py-1.5 text-left transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Memory count */}
      <div className="text-center text-xs text-gray-600 py-1">
        {memories.length} memories
      </div>
    </div>
  );

  // Main panel
  const main = (
    <div className="flex flex-col h-full">
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
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 ml-2">✕</button>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            Loading...
          </div>
        ) : (
          <SolarSystem
            memories={memories}
            sun={sun}
            selectedId={selectedId}
            onSelectMemory={(m) => setDetail(m ? { type: 'memory', memory: m } : null)}
            onSelectSun={() => setDetail({ type: 'sun' })}
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
