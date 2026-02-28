import type { SunState } from '../api/client';

interface SunProps {
  sun: SunState | null;
  cx: number;
  cy: number;
  onClick: () => void;
}

export function Sun({ sun, cx, cy, onClick }: SunProps) {
  const hasData = sun !== null;

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }} role="button" aria-label="View sun state">
      {/* Outer glow ring */}
      <circle cx={cx} cy={cy} r={28} fill="rgba(251, 191, 36, 0.08)" />
      <circle cx={cx} cy={cy} r={20} fill="rgba(251, 191, 36, 0.15)" />

      {/* Sun body */}
      <circle
        cx={cx}
        cy={cy}
        r={14}
        fill={hasData ? '#fbbf24' : '#6b7280'}
        className="sun-glow"
      />

      {/* Label below */}
      <text
        x={cx}
        y={cy + 32}
        textAnchor="middle"
        fontSize={10}
        fill={hasData ? 'rgba(251,191,36,0.8)' : 'rgba(156,163,175,0.6)'}
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {hasData ? sun.project : 'no state'}
      </text>
    </g>
  );
}
