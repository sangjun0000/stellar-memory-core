/**
 * GraphView.tsx — Obsidian-style 2D force-directed memory graph (Canvas)
 *
 * All rendering is done on a single <canvas> element for performance.
 * D3 force simulation handles physics; Canvas 2D draws pixels.
 * Supports thousands of nodes without DOM overhead.
 */

import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { Memory, ConstellationEdge } from '../api/client';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GraphViewProps {
  memories: Memory[];
  selectedMemory: Memory | null;
  onSelectMemory: (memory: Memory | null) => void;
  project: string;
  edges: ConstellationEdge[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  memory: Memory;
  r: number;
  color: string;
  alpha: number;
  label: string;
  showLabel: boolean; // always-visible label for high importance
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  weight: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  decision:    '#7c3aed',
  error:       '#ef4444',
  task:        '#22c55e',
  milestone:   '#f59e0b',
  context:     '#6366f1',
  observation: '#64748b',
  procedural:  '#06b6d4',
};

const BG_COLOR = '#1e1e2e';
const EDGE_COLOR_DEFAULT = 'rgba(255,255,255,0.06)';
const EDGE_COLOR_HOVER   = 'rgba(255,255,255,0.35)';
const EDGE_COLOR_DIM     = 'rgba(255,255,255,0.02)';
const LABEL_COLOR         = 'rgba(226,232,240,0.6)';
const LABEL_COLOR_HOVER   = 'rgba(226,232,240,0.9)';
const MAX_NODES = 300;
const NODE_MIN_R = 3;
const NODE_MAX_R = 14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeColor(type: string): string {
  return TYPE_COLORS[type] ?? '#64748b';
}

function nodeRadius(importance: number): number {
  const c = Math.min(1, Math.max(0, importance));
  return NODE_MIN_R + c * (NODE_MAX_R - NODE_MIN_R);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphView({
  memories,
  selectedMemory,
  onSelectMemory,
  edges,
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);

  // Mutable refs for simulation state (avoids re-running effect on hover etc.)
  const simRef     = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const nodesRef   = useRef<SimNode[]>([]);
  const linksRef   = useRef<SimLink[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const dprRef     = useRef(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);

  // Keep selectedRef in sync
  selectedRef.current = selectedMemory?.id ?? null;

  // ── Draw function ──────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const h = canvas.height / dpr;
    const t = transformRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const hovId = hoveredRef.current;
    const selId = selectedRef.current;

    // Clear
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Apply zoom transform
    ctx.save();
    ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr);

    // -- Edges --
    for (const link of links) {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (src.x == null || tgt.x == null) continue;

      if (hovId) {
        ctx.strokeStyle = (src.id === hovId || tgt.id === hovId) ? EDGE_COLOR_HOVER : EDGE_COLOR_DIM;
      } else {
        ctx.strokeStyle = EDGE_COLOR_DEFAULT;
      }
      ctx.lineWidth = Math.max(0.3, link.weight * 1.5) / t.k;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y!);
      ctx.lineTo(tgt.x, tgt.y!);
      ctx.stroke();
    }

    // -- Nodes --
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      const isHovered  = node.id === hovId;
      const isSelected = node.id === selId;
      const r = isHovered ? node.r * 1.3 : node.r;

      // Fill
      ctx.globalAlpha = isHovered ? 1 : node.alpha;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Stroke for selected
      if (isSelected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / t.k;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    // -- Labels --
    const fontSize = Math.max(8, 10 / t.k);
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';

    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      const isHovered = node.id === hovId;

      if (node.showLabel || isHovered) {
        ctx.fillStyle = isHovered ? LABEL_COLOR_HOVER : LABEL_COLOR;
        ctx.fillText(node.label, node.x, node.y + node.r + fontSize + 2);
      }
    }

    ctx.restore();

    // -- HUD (screen-space) --
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(148,163,184,0.35)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${nodes.length} nodes · ${links.length} edges`, 12, 20);

    // Legend
    const legendX = 12;
    let legendY = h - 10;
    ctx.font = '9px Inter, sans-serif';
    const types = Object.entries(TYPE_COLORS);
    for (let i = types.length - 1; i >= 0; i--) {
      const [type, color] = types[i];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(legendX + 4, legendY - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      ctx.fillText(type, legendX + 12, legendY);
      legendY -= 14;
    }

    ctx.restore();
  }, []);

  // ── Hit test: find node under mouse ────────────────────────────────────
  const hitTest = useCallback((mx: number, my: number): SimNode | null => {
    const t = transformRef.current;
    // Convert screen coords to simulation coords
    const sx = (mx - t.x) / t.k;
    const sy = (my - t.y) / t.k;

    // Check nodes in reverse order (top-most first)
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.x == null || n.y == null) continue;
      const hitR = n.r + 4; // generous hit area
      if (distSq(sx, sy, n.x, n.y) <= hitR * hitR) return n;
    }
    return null;
  }, []);

  // ── Main effect: setup simulation + canvas interactions ────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;

    const dpr = dprRef.current;
    const w = wrap.clientWidth || 800;
    const h = wrap.clientHeight || 600;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;

    // -- Build nodes (cap at MAX_NODES, sorted by importance desc) --
    const sorted = [...memories]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, MAX_NODES);

    const idSet = new Set(sorted.map(m => m.id));

    const simNodes: SimNode[] = sorted.map(m => ({
      id:        m.id,
      memory:    m,
      r:         nodeRadius(m.importance),
      color:     nodeColor(m.type),
      alpha:     0.3 + m.importance * 0.7,
      label:     truncate(m.summary || m.content || '', 30),
      showLabel: m.importance >= 0.7,
    }));

    const simLinks: SimLink[] = edges
      .filter(e => idSet.has(e.source_id) && idSet.has(e.target_id))
      .map(e => ({
        source: e.source_id,
        target: e.target_id,
        weight: e.weight,
      }));

    nodesRef.current = simNodes;
    linksRef.current = simLinks;

    // -- Force simulation --
    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        .distance(l => 60 + (1 - l.weight) * 50)
        .strength(0.3))
      .force('charge', d3.forceManyBody<SimNode>()
        .strength(d => -60 - d.r * 4)
        .distanceMax(300))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collision', d3.forceCollide<SimNode>().radius(d => d.r + 3))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    simRef.current = sim;

    // Run simulation to completion synchronously (no animation loop).
    // 300 ticks is enough for convergence; uses CPU once then stops.
    sim.stop();
    sim.tick(300);
    draw();

    // -- Zoom --
    const d3Canvas = d3.select(canvas);

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 6])
      .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform;
        draw();
      });

    d3Canvas.call(zoom);

    // Double-click reset
    d3Canvas.on('dblclick.zoom', null);
    d3Canvas.on('dblclick', () => {
      d3Canvas.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
    });

    // -- Mouse interactions --
    let dragNode: SimNode | null = null;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (dragNode) {
        const t = transformRef.current;
        dragNode.x = (mx - t.x) / t.k;
        dragNode.y = (my - t.y) / t.k;
        dragNode.fx = dragNode.x;
        dragNode.fy = dragNode.y;
        draw();
        return;
      }

      const hit = hitTest(mx, my);
      const prevHovered = hoveredRef.current;
      hoveredRef.current = hit?.id ?? null;
      canvas.style.cursor = hit ? 'pointer' : 'grab';

      if (prevHovered !== hoveredRef.current) {
        draw();
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) {
        e.stopPropagation();
        dragNode = hit;
        hit.fx = hit.x;
        hit.fy = hit.y;
        d3Canvas.on('.zoom', null);
      }
    });

    canvas.addEventListener('mouseup', () => {
      if (dragNode) {
        dragNode.fx = null;
        dragNode.fy = null;
        dragNode = null;
        draw();
        d3Canvas.call(zoom);
      }
    });

    canvas.addEventListener('click', (e) => {
      if (dragNode) return; // was dragging, not clicking
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      onSelectMemory(hit?.memory ?? null);
    });

    canvas.addEventListener('mouseleave', () => {
      hoveredRef.current = null;
      draw();
    });

    // -- Resize --
    const ro = new ResizeObserver(() => {
      const nw = wrap.clientWidth;
      const nh = wrap.clientHeight;
      canvas.width  = nw * dpr;
      canvas.height = nh * dpr;
      canvas.style.width  = `${nw}px`;
      canvas.style.height = `${nh}px`;
      sim.force('center', d3.forceCenter(nw / 2, nh / 2));
      draw();
    });
    ro.observe(wrap);

    // Cleanup
    return () => {
      sim.stop();
      simRef.current = null;
      ro.disconnect();
    };
  }, [memories, edges, onSelectMemory, draw, hitTest]);

  // Redraw when selection changes
  useEffect(() => { draw(); }, [selectedMemory, draw]);

  return (
    <div
      ref={wrapRef}
      style={{
        position:   'absolute',
        inset:      0,
        background: BG_COLOR,
        overflow:   'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
