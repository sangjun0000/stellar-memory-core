import { useState, useCallback } from 'react';
import type { Memory } from '../api/client';
import { MEMORY_COLORS } from './Planet';

interface MemoryDetailProps {
  memory: Memory;
  onClose: () => void;
  onForget: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, string> = {
  decision:    '💡',
  error:       '🔴',
  task:        '📋',
  observation: '👁️',
  milestone:   '🏆',
  context:     '📎',
};

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision',
  error: 'Error',
  task: 'Task',
  observation: 'Observation',
  milestone: 'Milestone',
  context: 'Context',
};

const ZONE_INFO: { max: number; label: string; color: string }[] = [
  { max: 1,   label: 'Corona',    color: '#fbbf24' },
  { max: 5,   label: 'Inner',     color: '#f97316' },
  { max: 15,  label: 'Habitable', color: '#22c55e' },
  { max: 40,  label: 'Outer',     color: '#60a5fa' },
  { max: 70,  label: 'Kuiper',    color: '#a78bfa' },
  { max: 101, label: 'Oort',      color: '#9ca3af' },
];

function getZone(distance: number) {
  return ZONE_INFO.find((z) => distance < z.max) ?? ZONE_INFO[5];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-gray-600 text-[10px] font-mono w-3">
          {open ? '▾' : '▸'}
        </span>
        <span>{icon}</span>
        <span className="font-medium uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property Row (key-value like file explorer properties)
// ---------------------------------------------------------------------------

function PropRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1 text-xs">
      <span className="text-gray-500 w-20 flex-shrink-0 text-right">{label}</span>
      <span className={`text-gray-200 flex-1 break-words ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MemoryDetail({ memory, onClose, onForget }: MemoryDetailProps) {
  const color = MEMORY_COLORS[memory.type];
  const zone = getZone(memory.distance);
  const [contentExpanded, setContentExpanded] = useState(false);
  const maxPreview = 200;
  const isLong = memory.content.length > maxPreview;

  const sourcePath = memory.source_path
    ?? (memory.metadata?.source_path as string | undefined)
    ?? null;

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const handleOpenPath = useCallback((path: string) => {
    const w = window as { electronAPI?: { openPath: (p: string) => void } };
    if (w.electronAPI?.openPath) {
      w.electronAPI.openPath(path);
    } else {
      void navigator.clipboard.writeText(path);
    }
  }, []);

  const isElectron = !!(window as { electronAPI?: unknown }).electronAPI;

  return (
    <div className="panel flex flex-col h-full">
      {/* Header — prominent summary + key stats */}
      <div className="px-3 py-3 border-b border-gray-700 bg-space-900/50">
        <div className="flex items-start gap-2">
          <span className="text-lg mt-0.5">{TYPE_ICONS[memory.type] ?? '📄'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-100 font-semibold leading-snug">
              {memory.summary || 'Untitled Memory'}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span
                className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ color, backgroundColor: `${color}20` }}
              >
                {TYPE_LABELS[memory.type] ?? memory.type}
              </span>
              <span className="text-[10px] font-mono" style={{ color: zone.color }}>
                {zone.label} · {memory.distance.toFixed(1)} AU
              </span>
              <span className="text-[10px] font-mono text-gray-500">
                {(memory.importance * 100).toFixed(0)}% imp
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700 flex-shrink-0"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Quick stat bars — visible at a glance */}
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500 w-12">Imp.</span>
            <div className="flex-1 h-1.5 bg-gray-700/50 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${memory.importance * 100}%`, backgroundColor: color }} />
            </div>
            <span className="text-[10px] font-mono text-gray-400 w-6 text-right">{(memory.importance * 100).toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500 w-12">Impact</span>
            <div className="flex-1 h-1.5 bg-gray-700/50 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${memory.impact * 100}%`, backgroundColor: color }} />
            </div>
            <span className="text-[10px] font-mono text-gray-400 w-6 text-right">{(memory.impact * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Tags — right in the header for quick context */}
        {memory.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {memory.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="text-[10px] bg-gray-800/70 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700/50"
              >
                {tag}
              </span>
            ))}
            {memory.tags.length > 5 && (
              <span className="text-[10px] text-gray-600">+{memory.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Scrollable body — file-explorer style sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Content Section */}
        <Section title="Content" icon="📝" defaultOpen={true}>
          <div className="bg-space-950 border border-gray-800 rounded p-2.5 text-xs text-gray-300 leading-relaxed whitespace-pre-wrap break-words font-mono">
            {isLong && !contentExpanded
              ? memory.content.slice(0, maxPreview) + '…'
              : memory.content}
          </div>
          {isLong && (
            <button
              onClick={() => setContentExpanded(!contentExpanded)}
              className="text-[11px] text-blue-400 hover:text-blue-300 mt-1.5 transition-colors"
            >
              {contentExpanded ? '▲ Show less' : `▼ Show all (${memory.content.length} chars)`}
            </button>
          )}
        </Section>

        {/* Properties Section — like file properties */}
        <Section title="Properties" icon="📊" defaultOpen={false}>
          <div className="space-y-0.5">
            <PropRow label="Type" value={TYPE_LABELS[memory.type] ?? memory.type} />
            <PropRow
              label="Zone"
              value={
                <span style={{ color: zone.color }}>{zone.label}</span>
              }
            />
            <PropRow label="Distance" value={`${memory.distance.toFixed(2)} AU`} mono />
            <PropRow
              label="Importance"
              value={
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded overflow-hidden max-w-20">
                    <div
                      className="h-full rounded"
                      style={{ width: `${memory.importance * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="font-mono text-gray-400">{(memory.importance * 100).toFixed(0)}%</span>
                </div>
              }
            />
            <PropRow
              label="Impact"
              value={
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded overflow-hidden max-w-20">
                    <div
                      className="h-full rounded"
                      style={{ width: `${memory.impact * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="font-mono text-gray-400">{(memory.impact * 100).toFixed(0)}%</span>
                </div>
              }
            />
            <PropRow
              label="Velocity"
              value={
                <span className={memory.velocity > 0 ? 'text-green-400' : memory.velocity < 0 ? 'text-red-400' : 'text-gray-400'}>
                  {memory.velocity > 0 ? '↗ +' : memory.velocity < 0 ? '↘ ' : ''}{memory.velocity.toFixed(2)}
                </span>
              }
              mono
            />
            <PropRow label="Accessed" value={`${memory.access_count} times`} mono />
          </div>
        </Section>

        {/* Source File */}
        {sourcePath && (
          <Section title="Source" icon="📁" defaultOpen={true}>
            <div className="flex items-center gap-2 bg-space-950 border border-gray-800 rounded p-2">
              <span className="text-gray-600 text-xs">📄</span>
              <span className="flex-1 text-xs text-gray-400 font-mono break-all">{sourcePath}</span>
              <button
                onClick={() => handleOpenPath(sourcePath)}
                className="text-[10px] text-blue-400 hover:text-blue-300 whitespace-nowrap px-2 py-0.5 border border-blue-800/50 rounded hover:bg-blue-900/20 transition-colors"
              >
                {isElectron ? '📂 Open' : '📋 Copy'}
              </button>
            </div>
          </Section>
        )}

        {/* Tags — only show as a section if there are more than 5 (rest hidden in header) */}
        {memory.tags.length > 5 && (
          <Section title="All Tags" icon="🏷️" defaultOpen={false}>
            <div className="flex flex-wrap gap-1.5">
              {memory.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] bg-gray-800 text-gray-300 px-2 py-0.5 rounded border border-gray-700 hover:bg-gray-700 transition-colors cursor-default"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Timestamps */}
        <Section title="Timeline" icon="🕐" defaultOpen={false}>
          <div className="space-y-0.5">
            <PropRow
              label="Created"
              value={
                <span title={formatDate(memory.created_at)}>
                  {formatRelative(memory.created_at)} · {formatDate(memory.created_at)}
                </span>
              }
            />
            {memory.last_accessed_at && (
              <PropRow
                label="Accessed"
                value={
                  <span title={formatDate(memory.last_accessed_at)}>
                    {formatRelative(memory.last_accessed_at)} · {formatDate(memory.last_accessed_at)}
                  </span>
                }
              />
            )}
            <PropRow label="Updated" value={formatDate(memory.updated_at)} />
          </div>
        </Section>

        {/* Metadata (if any extra keys) */}
        {Object.keys(memory.metadata).length > 0 && (
          <Section title="Metadata" icon="📋" defaultOpen={false}>
            <div className="bg-space-950 border border-gray-800 rounded p-2">
              <pre className="text-[10px] text-gray-500 font-mono overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(memory.metadata, null, 2)}
              </pre>
            </div>
          </Section>
        )}
      </div>

      {/* Footer — actions */}
      <div className="flex-shrink-0 p-2 border-t border-gray-700 flex gap-2">
        <button
          onClick={() => handleCopy(memory.content)}
          className="flex-1 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1.5 transition-colors"
        >
          📋 Copy content
        </button>
        <button
          onClick={() => onForget(memory.id)}
          className="flex-1 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 rounded px-2 py-1.5 transition-colors"
        >
          🗑️ Forget
        </button>
      </div>
    </div>
  );
}
