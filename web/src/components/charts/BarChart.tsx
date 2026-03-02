// Simple horizontal bar chart — inline SVG, no external library

interface BarData {
  label: string;
  value: number;
  color: string;
}

interface BarChartProps {
  data: BarData[];
  showValues?: boolean;
  showPercent?: boolean;
}

const ROW_HEIGHT = 28;
const LABEL_W = 90;
const VALUE_W = 36;
const BAR_H = 8;
const PADDING = 12;

export function BarChart({ data, showValues = true, showPercent = false }: BarChartProps) {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const total  = data.reduce((s, d) => s + d.value, 0) || 1;
  const barW   = 240; // available bar width

  const svgWidth  = PADDING + LABEL_W + 8 + barW + 8 + VALUE_W + PADDING;
  const svgHeight = PADDING + data.length * ROW_HEIGHT + PADDING;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {data.map((d, i) => {
        const y       = PADDING + i * ROW_HEIGHT;
        const barY    = y + (ROW_HEIGHT - BAR_H) / 2;
        const barPct  = d.value / maxVal;
        const filledW = barPct * barW;
        const display = showPercent
          ? `${((d.value / total) * 100).toFixed(0)}%`
          : String(d.value);

        return (
          <g key={d.label}>
            {/* Label */}
            <text
              x={PADDING}
              y={y + ROW_HEIGHT / 2}
              dominantBaseline="middle"
              fill="#9ca3af"
              fontSize={11}
              fontFamily="system-ui, sans-serif"
              style={{ textTransform: 'capitalize' }}
            >
              {d.label}
            </text>

            {/* Bar track */}
            <rect
              x={PADDING + LABEL_W + 8}
              y={barY}
              width={barW}
              height={BAR_H}
              rx={BAR_H / 2}
              fill="rgba(255,255,255,0.05)"
            />

            {/* Bar fill */}
            {filledW > 0 && (
              <rect
                x={PADDING + LABEL_W + 8}
                y={barY}
                width={filledW}
                height={BAR_H}
                rx={BAR_H / 2}
                fill={d.color}
                style={{ filter: `drop-shadow(0 0 4px ${d.color}66)` }}
              />
            )}

            {/* Value */}
            {showValues && (
              <text
                x={PADDING + LABEL_W + 8 + barW + 8}
                y={y + ROW_HEIGHT / 2}
                dominantBaseline="middle"
                fill="#6b7280"
                fontSize={10}
                fontFamily="monospace"
                fontWeight={600}
              >
                {display}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
