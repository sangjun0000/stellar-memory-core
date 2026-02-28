import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { DataSource } from '../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const STATUS_DOT: Record<DataSource['status'], string> = {
  active:   'bg-green-500',
  inactive: 'bg-gray-500',
  error:    'bg-red-500',
};

const STATUS_LABEL: Record<DataSource['status'], string> = {
  active:   'Active',
  inactive: 'Inactive',
  error:    'Error',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DataSourcesProps {
  project: string;
}

export function DataSources({ project }: DataSourcesProps) {
  const [sources, setSources]   = useState<DataSource[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDataSources(project);
      setSources(res.data);
    } catch (e) {
      // If the endpoint doesn't exist yet, show a graceful empty state rather
      // than an error banner.
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg.includes('404') || msg.includes('HTTP 404')) {
        setSources([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel flex flex-col">
      {/* Header with collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="panel-header flex items-center justify-between w-full text-left"
        aria-expanded={!collapsed}
        aria-controls="data-sources-body"
      >
        <span>Data Sources</span>
        <span className="text-gray-500 text-xs ml-1" aria-hidden="true">
          {collapsed ? '+' : '-'}
        </span>
      </button>

      {!collapsed && (
        <div id="data-sources-body" className="p-3 space-y-2">
          {loading && (
            <p className="text-xs text-gray-600 text-center py-2">Loading...</p>
          )}

          {!loading && error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {!loading && !error && sources.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-2">
              No sources registered.
            </p>
          )}

          {!loading && !error && sources.map((src) => (
            <div
              key={src.id}
              className="rounded bg-space-950 border border-gray-700 px-2.5 py-2 space-y-1"
            >
              {/* Path + status */}
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[src.status]}`}
                  title={STATUS_LABEL[src.status]}
                />
                <span
                  className="text-xs text-gray-300 truncate"
                  title={src.path}
                >
                  {src.path}
                </span>
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <span>{src.file_count} file{src.file_count !== 1 ? 's' : ''}</span>
                <span>scanned {formatRelative(src.last_scanned_at)}</span>
                {src.status === 'error' && src.error && (
                  <span className="text-red-500 truncate">{src.error}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
