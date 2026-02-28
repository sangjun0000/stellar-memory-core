import { useState, useCallback } from 'react';
import type { MemoryType, OrbitZone } from '../api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_TYPES: { value: MemoryType; label: string }[] = [
  { value: 'decision',    label: 'Decision' },
  { value: 'error',       label: 'Error' },
  { value: 'task',        label: 'Task' },
  { value: 'observation', label: 'Observation' },
  { value: 'milestone',   label: 'Milestone' },
  { value: 'context',     label: 'Context' },
];

const ORBIT_ZONES: { value: OrbitZone; label: string }[] = [
  { value: 'corona',    label: 'Corona' },
  { value: 'inner',     label: 'Inner' },
  { value: 'habitable', label: 'Habitable' },
  { value: 'outer',     label: 'Outer' },
  { value: 'kuiper',    label: 'Kuiper' },
  { value: 'oort',      label: 'Oort' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SearchFilters {
  query: string;
  type?: MemoryType;
  zone?: OrbitZone;
}

interface SearchBarProps {
  onSearch: (filters: SearchFilters) => void;
  isSearching: boolean;
  resultCount?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchBar({ onSearch, isSearching, resultCount }: SearchBarProps) {
  const [query, setQuery]   = useState('');
  const [type, setType]     = useState<MemoryType | ''>('');
  const [zone, setZone]     = useState<OrbitZone | ''>('');

  const buildFilters = useCallback(
    (q: string, t: MemoryType | '', z: OrbitZone | ''): SearchFilters => ({
      query: q,
      type:  t || undefined,
      zone:  z || undefined,
    }),
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSearch(buildFilters(query.trim(), type, zone));
    },
    [query, type, zone, onSearch, buildFilters],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setType('');
    setZone('');
    onSearch({ query: '' });
  }, [onSearch]);

  // Fire search immediately when a filter dropdown changes (if there is already
  // a query or a prior filter is active) so the user doesn't have to click
  // Search again after changing the dropdown.
  const handleFilterChange = useCallback(
    (newType: MemoryType | '', newZone: OrbitZone | '') => {
      if (query.trim() || newType || newZone) {
        onSearch(buildFilters(query.trim(), newType, newZone));
      }
    },
    [query, onSearch, buildFilters],
  );

  const selectClass =
    'bg-space-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1.5 focus:outline-none focus:border-gray-500 cursor-pointer';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {/* Query row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-space-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 pr-8"
            aria-label="Search memories"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              aria-label="Clear search"
            >
              &#x2715;
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={(!query.trim() && !type && !zone) || isSearching}
          className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
        >
          {isSearching ? '...' : 'Search'}
        </button>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={type}
          onChange={(e) => {
            const v = e.target.value as MemoryType | '';
            setType(v);
            handleFilterChange(v, zone);
          }}
          className={selectClass}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <select
          value={zone}
          onChange={(e) => {
            const v = e.target.value as OrbitZone | '';
            setZone(v);
            handleFilterChange(type, v);
          }}
          className={selectClass}
          aria-label="Filter by zone"
        >
          <option value="">All zones</option>
          {ORBIT_ZONES.map((z) => (
            <option key={z.value} value={z.value}>{z.label}</option>
          ))}
        </select>

        {resultCount !== undefined && (
          <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">
            {resultCount} {resultCount === 1 ? 'result' : 'results'}
          </span>
        )}
      </div>
    </form>
  );
}
