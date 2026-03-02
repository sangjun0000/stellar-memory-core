// Percentage ring/donut chart — inline SVG, no external library

interface RingChartProps {
  value: number;      // 0–1 (ratio) or 0–100 (if max not 1)
  max?: number;       // default 1
  color: string;
  size?: number;      // px, default 64
  label?: string;
}

export function RingChart({ value, max = 1, color, size = 64, label }: RingChartProps) {
  const pct = Math.min(1, Math.max(0, value / max));
  const displayPct = Math.round(pct * 100);

  const r = (size / 2) * 0.72;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = pct * circumference;
  const gap = circumference - dash;

  const trackColor = 'rgba(255,255,255,0.06)';
  const strokeWidth = size * 0.1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc — starts at top (rotate -90deg) */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ filter: `drop-shadow(0 0 ${size * 0.08}px ${color}88)`, transition: 'stroke-dasharray 0.5s ease' }}
        />
        {/* Center text */}
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#f3f4f6"
          fontSize={size * 0.22}
          fontWeight={700}
          fontFamily="monospace"
        >
          {displayPct}%
        </text>
      </svg>
      {label && (
        <span style={{ fontSize: 10, color: '#6b7280', textAlign: 'center', lineHeight: 1.3, maxWidth: size }}>
          {label}
        </span>
      )}
    </div>
  );
}
