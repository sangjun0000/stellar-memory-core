import type { Memory, MemoryType } from '../api/client';

// Color palette — accessible (blue-orange family + distinct hues)
export const MEMORY_COLORS: Record<MemoryType, string> = {
  decision:    '#2563eb',
  error:       '#dc2626',
  task:        '#16a34a',
  observation: '#6b7280',
  milestone:   '#eab308',
  context:     '#7c3aed',
};

interface PlanetProps {
  memory: Memory;
  cx: number;
  cy: number;
  radius: number;
  isSelected: boolean;
  onSelect: (memory: Memory) => void;
}

export function Planet({ memory, cx, cy, radius, isSelected, onSelect }: PlanetProps) {
  const color = MEMORY_COLORS[memory.type];

  return (
    <g
      onClick={() => onSelect(memory)}
      role="button"
      aria-label={`Memory: ${memory.summary}`}
      style={{ cursor: 'pointer' }}
    >
      {/* Selection ring */}
      {isSelected && (
        <circle
          cx={cx}
          cy={cy}
          r={radius + 4}
          fill="none"
          stroke="white"
          strokeWidth={1.5}
          opacity={0.7}
        />
      )}

      {/* Planet body */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        opacity={0.85}
        className="planet-dot"
      />

      {/* Type indicator dot for small planets */}
      {radius > 6 && (
        <circle
          cx={cx}
          cy={cy}
          r={radius * 0.35}
          fill="rgba(255,255,255,0.25)"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}
