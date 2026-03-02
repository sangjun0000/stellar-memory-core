// Simple line chart — inline SVG, no external library

interface Point {
  x: number;
  y: number;
}

interface LineChartProps {
  data: Point[];
  data2?: Point[];
  color?: string;
  color2?: string;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}

const PAD = { top: 10, right: 16, bottom: 28, left: 36 };
const GRID_LINES = 4;

function scalePoints(
  points: Point[],
  xMin: number, xMax: number,
  yMin: number, yMax: number,
  w: number, h: number,
): string {
  if (points.length === 0) return '';
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  return points
    .map((p) => {
      const px = PAD.left + ((p.x - xMin) / xRange) * w;
      const py = PAD.top  + h - ((p.y - yMin) / yRange) * h;
      return `${px},${py}`;
    })
    .join(' ');
}

export function LineChart({
  data,
  data2,
  color  = '#22c55e',
  color2 = '#ef4444',
  height = 160,
  xLabel,
  yLabel,
}: LineChartProps) {
  const allPoints = [...data, ...(data2 ?? [])];
  if (allPoints.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: '#4b5563' }}>No data</span>
      </div>
    );
  }

  const xMin = Math.min(...allPoints.map((p) => p.x));
  const xMax = Math.max(...allPoints.map((p) => p.x));
  const yMin = 0;
  const yMax = Math.max(...allPoints.map((p) => p.y), 1);

  // SVG uses a fixed viewBox width for consistent bar widths; responsive via width="100%"
  const VW = 420;
  const VH = height;
  const plotW = VW - PAD.left - PAD.right;
  const plotH = VH - PAD.top  - PAD.bottom;

  const polyline1 = scalePoints(data, xMin, xMax, yMin, yMax, plotW, plotH);
  const polyline2 = data2 ? scalePoints(data2, xMin, xMax, yMin, yMax, plotW, plotH) : '';

  // Horizontal grid lines
  const gridLines = Array.from({ length: GRID_LINES + 1 }, (_, i) => {
    const ratio = i / GRID_LINES;
    const y = PAD.top + plotH - ratio * plotH;
    const val = Math.round(yMin + ratio * (yMax - yMin));
    return { y, val };
  });

  // X-axis ticks — show ~4 labels
  const xTicks = (() => {
    if (data.length === 0) return [];
    const step = Math.max(1, Math.floor(data.length / 4));
    const sample: Point[] = [];
    for (let i = 0; i < data.length; i += step) sample.push(data[i]);
    if (sample[sample.length - 1] !== data[data.length - 1]) sample.push(data[data.length - 1]);
    const xRange = xMax - xMin || 1;
    return sample.map((p) => ({
      x: PAD.left + ((p.x - xMin) / xRange) * plotW,
      label: String(p.x),
    }));
  })();

  return (
    <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Grid lines */}
      {gridLines.map(({ y, val }, i) => (
        <g key={i}>
          <line
            x1={PAD.left} y1={y}
            x2={PAD.left + plotW} y2={y}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 4} y={y}
            textAnchor="end"
            dominantBaseline="middle"
            fill="#4b5563"
            fontSize={9}
            fontFamily="monospace"
          >
            {val}
          </text>
        </g>
      ))}

      {/* X-axis ticks */}
      {xTicks.map(({ x, label }, i) => (
        <text
          key={i}
          x={x} y={PAD.top + plotH + 12}
          textAnchor="middle"
          fill="#4b5563"
          fontSize={9}
          fontFamily="monospace"
        >
          {label}
        </text>
      ))}

      {/* X axis label */}
      {xLabel && (
        <text
          x={PAD.left + plotW / 2}
          y={VH - 2}
          textAnchor="middle"
          fill="#374151"
          fontSize={9}
          fontFamily="system-ui"
        >
          {xLabel}
        </text>
      )}

      {/* Y axis label */}
      {yLabel && (
        <text
          x={8}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#374151"
          fontSize={9}
          fontFamily="system-ui"
          transform={`rotate(-90, 8, ${PAD.top + plotH / 2})`}
        >
          {yLabel}
        </text>
      )}

      {/* Area fill line 2 */}
      {data2 && polyline2 && (
        <polyline
          points={polyline2}
          fill="none"
          stroke={color2}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${color2}88)` }}
          opacity={0.85}
        />
      )}

      {/* Line 1 */}
      {polyline1 && (
        <polyline
          points={polyline1}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${color}88)` }}
          opacity={0.9}
        />
      )}

      {/* Dot endpoints — line 1 */}
      {data.slice(-1).map((p, i) => {
        const xRange = xMax - xMin || 1;
        const yRange = yMax - yMin || 1;
        const px = PAD.left + ((p.x - xMin) / xRange) * plotW;
        const py = PAD.top  + plotH - ((p.y - yMin) / yRange) * plotH;
        return (
          <circle key={i} cx={px} cy={py} r={3} fill={color}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        );
      })}

      {/* Dot endpoints — line 2 */}
      {data2?.slice(-1).map((p, i) => {
        const xRange = xMax - xMin || 1;
        const yRange = yMax - yMin || 1;
        const px = PAD.left + ((p.x - xMin) / xRange) * plotW;
        const py = PAD.top  + plotH - ((p.y - yMin) / yRange) * plotH;
        return (
          <circle key={i} cx={px} cy={py} r={3} fill={color2}
            style={{ filter: `drop-shadow(0 0 4px ${color2})` }} />
        );
      })}
    </svg>
  );
}
