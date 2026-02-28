import type { OrbitZone } from '../api/client';

interface OrbitRingProps {
  zone: OrbitZone;
  radius: number;
  color: string;
  label: string;
  cx: number;
  cy: number;
}

export function OrbitRing({ zone: _zone, radius, color, label, cx, cy }: OrbitRingProps) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1}
        className="orbit-ring"
      />
      {/* Zone label at top */}
      <text
        x={cx}
        y={cy - radius + 14}
        textAnchor="middle"
        fontSize={9}
        fill="rgba(255,255,255,0.25)"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {label}
      </text>
    </g>
  );
}
