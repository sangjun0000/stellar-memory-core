import type { Memory } from '../api/client';
import { MEMORY_COLORS } from './Planet';

interface MemoryDetailProps {
  memory: Memory;
  onClose: () => void;
  onForget: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision',
  error: 'Error',
  task: 'Task',
  observation: 'Observation',
  milestone: 'Milestone',
  context: 'Context',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MemoryDetail({ memory, onClose, onForget }: MemoryDetailProps) {
  const color = MEMORY_COLORS[memory.type];

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header flex items-center justify-between">
        <span>Memory Detail</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Type badge */}
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
            {TYPE_LABELS[memory.type] ?? memory.type}
          </span>
          <span className="ml-auto text-xs text-gray-500">
            {memory.distance.toFixed(2)} AU
          </span>
        </div>

        {/* Summary */}
        <div>
          <div className="text-xs text-gray-500 mb-1">Summary</div>
          <p className="text-sm text-gray-200 leading-relaxed">{memory.summary}</p>
        </div>

        {/* Content */}
        <div>
          <div className="text-xs text-gray-500 mb-1">Content</div>
          <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap break-words">
            {memory.content}
          </p>
        </div>

        {/* Tags */}
        {memory.tags.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-1">Tags</div>
            <div className="flex flex-wrap gap-1">
              {memory.tags.map((tag) => (
                <span key={tag} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-space-900 rounded p-2">
            <div className="text-xs text-gray-500">Importance</div>
            <div className="text-sm font-mono text-gray-200">
              {(memory.importance * 100).toFixed(0)}%
            </div>
            <div className="mt-1 h-1 bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${memory.importance * 100}%`, backgroundColor: color }}
              />
            </div>
          </div>
          <div className="bg-space-900 rounded p-2">
            <div className="text-xs text-gray-500">Impact</div>
            <div className="text-sm font-mono text-gray-200">
              {(memory.impact * 100).toFixed(0)}%
            </div>
            <div className="mt-1 h-1 bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${memory.impact * 100}%`, backgroundColor: color }}
              />
            </div>
          </div>
          <div className="bg-space-900 rounded p-2">
            <div className="text-xs text-gray-500">Access Count</div>
            <div className="text-sm font-mono text-gray-200">{memory.access_count}</div>
          </div>
          <div className="bg-space-900 rounded p-2">
            <div className="text-xs text-gray-500">Zone</div>
            <div className="text-sm text-gray-200">
              {memory.distance < 1
                ? 'Corona'
                : memory.distance < 5
                ? 'Inner'
                : memory.distance < 15
                ? 'Habitable'
                : memory.distance < 40
                ? 'Outer'
                : memory.distance < 70
                ? 'Kuiper'
                : 'Oort'}
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="text-xs text-gray-600 space-y-0.5">
          <div>Created: {formatDate(memory.created_at)}</div>
          {memory.last_accessed_at && (
            <div>Last accessed: {formatDate(memory.last_accessed_at)}</div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 border-t border-gray-700">
        <button
          onClick={() => onForget(memory.id)}
          className="w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800 rounded px-3 py-1.5 transition-colors"
        >
          Forget this memory
        </button>
      </div>
    </div>
  );
}
