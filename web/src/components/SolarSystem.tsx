import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { Memory, SunState, OrbitZone } from '../api/client';
import { Sun } from './Sun';
import { Planet } from './Planet';
import { OrbitRing } from './OrbitRing';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORBIT_ZONES_DEF = [
  { zone: 'corona'    as OrbitZone, minAU: 0.1,  maxAU: 1.0,  label: 'Corona' },
  { zone: 'inner'     as OrbitZone, minAU: 1.0,  maxAU: 5.0,  label: 'Inner' },
  { zone: 'habitable' as OrbitZone, minAU: 5.0,  maxAU: 15.0, label: 'Habitable' },
  { zone: 'outer'     as OrbitZone, minAU: 15.0, maxAU: 40.0, label: 'Outer' },
  { zone: 'kuiper'    as OrbitZone, minAU: 40.0, maxAU: 70.0, label: 'Kuiper' },
  { zone: 'oort'      as OrbitZone, minAU: 70.0, maxAU: 100.0,label: 'Oort' },
] as const;

const ZONE_FILL_COLORS: Record<OrbitZone, string> = {
  corona:    'rgba(255, 200, 0, 0.12)',
  inner:     'rgba(249, 115, 22, 0.08)',
  habitable: 'rgba(34, 197, 94, 0.06)',
  outer:     'rgba(96, 165, 250, 0.05)',
  kuiper:    'rgba(167, 139, 250, 0.04)',
  oort:      'rgba(156, 163, 175, 0.02)',
};

// Log-scale: maps 0.1–100 AU → 20–minDim/2 px
function auToPixels(au: number, maxRadius: number): number {
  const minAU = 0.1;
  const maxAU = 100;
  // Use sqrt scale so inner zones get reasonable space
  const t = (Math.log(au) - Math.log(minAU)) / (Math.log(maxAU) - Math.log(minAU));
  return 20 + t * (maxRadius - 24);
}

// Deterministic angle from memory id so planets don't jump on re-render
function idToAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 3600) / 3600 * Math.PI * 2;
}

function planetRadius(importance: number): number {
  return 4 + importance * 8;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SolarSystemProps {
  memories: Memory[];
  sun: SunState | null;
  selectedId: string | null;
  onSelectMemory: (memory: Memory | null) => void;
  onSelectSun: () => void;
}

export function SolarSystem({
  memories,
  sun,
  selectedId,
  onSelectMemory,
  onSelectSun,
}: SolarSystemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Apply D3 zoom behaviour
  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const g = svg.querySelector<SVGGElement>('#zoom-group');
        if (g) {
          g.setAttribute('transform', event.transform.toString());
        }
      });

    d3.select(svg).call(zoom);

    return () => {
      d3.select(svg).on('.zoom', null);
    };
  }, []);

  const handleBackgroundClick = useCallback(() => {
    onSelectMemory(null);
  }, [onSelectMemory]);

  // Compute layout
  const size = 700; // SVG logical size (square, viewBox)
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size / 2 - 16;

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        className="w-full h-full"
        style={{ maxHeight: '100%' }}
        aria-label="Solar system memory visualization"
      >
        <rect
          x={0} y={0}
          width={size} height={size}
          fill="transparent"
          onClick={handleBackgroundClick}
        />

        <g id="zoom-group">
          {/* Orbit zone rings — rendered back-to-front (oort first) */}
          {[...ORBIT_ZONES_DEF].reverse().map((z) => {
            const outerR = auToPixels(z.maxAU, maxRadius);
            return (
              <OrbitRing
                key={z.zone}
                zone={z.zone}
                radius={outerR}
                color={ZONE_FILL_COLORS[z.zone]}
                label={z.label}
                cx={cx}
                cy={cy}
              />
            );
          })}

          {/* Memory planets */}
          {memories.map((m) => {
            const r = auToPixels(m.distance, maxRadius);
            const angle = idToAngle(m.id);
            const px = cx + r * Math.cos(angle);
            const py = cy + r * Math.sin(angle);
            const pRadius = planetRadius(m.importance);

            return (
              <Planet
                key={m.id}
                memory={m}
                cx={px}
                cy={py}
                radius={pRadius}
                isSelected={m.id === selectedId}
                onSelect={onSelectMemory}
              />
            );
          })}

          {/* Sun — always on top */}
          <Sun sun={sun} cx={cx} cy={cy} onClick={onSelectSun} />
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex gap-3 flex-wrap pointer-events-none">
        {[
          { type: 'decision',    color: '#2563eb', label: 'Decision' },
          { type: 'error',       color: '#dc2626', label: 'Error' },
          { type: 'task',        color: '#16a34a', label: 'Task' },
          { type: 'observation', color: '#6b7280', label: 'Observation' },
          { type: 'milestone',   color: '#eab308', label: 'Milestone' },
          { type: 'context',     color: '#7c3aed', label: 'Context' },
        ].map((item) => (
          <div key={item.type} className="flex items-center gap-1 text-xs text-gray-400">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
