import { Suspense, useRef, useMemo, useState, useCallback, Component, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text, Html, Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { Memory, SunState, OrbitZone } from '../api/client';
import { MEMORY_COLORS } from './Planet';

// Minimum pointer distance (px) before a press becomes a drag
const DRAG_THRESHOLD = 6;

// ---------------------------------------------------------------------------
// Error Boundary for Canvas crashes
// ---------------------------------------------------------------------------

class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#050a14', color: '#ef4444', fontFamily: 'monospace', fontSize: 14, padding: 24,
          flexDirection: 'column', gap: 8,
        }}>
          <div>⚠️ 3D Render Error</div>
          <div style={{ color: '#9ca3af', fontSize: 12 }}>{this.state.error}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_AU = 0.1;
const MAX_AU = 100;

const ZONE_DEFS: { zone: OrbitZone; minAU: number; maxAU: number; label: string; color: string }[] = [
  { zone: 'corona',    minAU: 0.1,  maxAU: 1.0,  label: 'Corona',    color: '#fbbf24' },
  { zone: 'inner',     minAU: 1.0,  maxAU: 5.0,  label: 'Inner',     color: '#f97316' },
  { zone: 'habitable', minAU: 5.0,  maxAU: 15.0, label: 'Habitable', color: '#22c55e' },
  { zone: 'outer',     minAU: 15.0, maxAU: 40.0, label: 'Outer',     color: '#60a5fa' },
  { zone: 'kuiper',    minAU: 40.0, maxAU: 70.0, label: 'Kuiper',    color: '#a78bfa' },
  { zone: 'oort',      minAU: 70.0, maxAU: 100.0,label: 'Oort',      color: '#9ca3af' },
];

// Log-scale AU → 3D units (1..20)
function auTo3D(au: number): number {
  const t = (Math.log(Math.max(MIN_AU, Math.min(MAX_AU, au))) - Math.log(MIN_AU))
          / (Math.log(MAX_AU) - Math.log(MIN_AU));
  return 1.0 + t * 19.0;
}

// Inverse: 3D radius → AU
function threeDToAU(r: number): number {
  const t = Math.max(0, Math.min(1, (r - 1.0) / 19.0));
  return Math.exp(t * (Math.log(MAX_AU) - Math.log(MIN_AU)) + Math.log(MIN_AU));
}

// Deterministic angle from memory id
function idToAngles(id: string): { theta: number; phi: number } {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < id.length; i++) {
    h1 = ((h1 << 5) - h1 + id.charCodeAt(i)) >>> 0;
    h2 = ((h2 << 7) + h1 + id.charCodeAt(i)) >>> 0;
  }
  const theta = (h1 % 3600) / 3600 * Math.PI * 2;
  const phi = (h2 % 1800) / 1800 * Math.PI - Math.PI / 2;
  return { theta, phi };
}

// Planet size from importance
function planetSize(importance: number): number {
  return 0.12 + importance * 0.28;
}

// ---------------------------------------------------------------------------
// Sun Mesh
// ---------------------------------------------------------------------------

function SunMesh({ sun, onClick }: { sun: SunState | null; onClick: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.2;
    if (glowRef.current) {
      const scale = 1.0 + Math.sin(Date.now() * 0.002) * 0.08;
      glowRef.current.scale.setScalar(scale);
    }
  });

  const color = sun ? '#fbbf24' : '#6b7280';

  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }} >
      {/* Outer glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.85, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} />
      </mesh>
      {/* Inner glow */}
      <mesh>
        <sphereGeometry args={[0.65, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
      {/* Sun body */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.5, 48, 48]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.5}
          roughness={0.3}
        />
      </mesh>
      {/* Label */}
      <Text
        position={[0, -0.9, 0]}
        fontSize={0.25}
        color={sun ? '#fbbf24' : '#9ca3af'}
        fillOpacity={sun ? 0.8 : 0.6}
        anchorX="center"
        anchorY="top"
      >
        {sun ? sun.project : 'no state'}
      </Text>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Orbit Rings (torus = 3D ring)
// ---------------------------------------------------------------------------

function OrbitRings() {
  return (
    <group>
      {ZONE_DEFS.map((z) => {
        const r = auTo3D(z.maxAU);
        const zoneColor = new THREE.Color(z.color);
        return (
          <group key={z.zone}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r, 0.02, 8, 128]} />
              <meshBasicMaterial color={zoneColor} transparent opacity={0.15} />
            </mesh>
            <Text
              position={[0, 0.3, -r]}
              fontSize={0.3}
              color={z.color}
              anchorX="center"
              anchorY="bottom"
              fillOpacity={0.35}
            >
              {z.label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Memory Planet
// ---------------------------------------------------------------------------

interface PlanetMeshProps {
  memory: Memory;
  isSelected: boolean;
  isDragging: boolean;
  onSelect: (memory: Memory) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, distance: number) => void;
  dragPos: THREE.Vector3 | null;
}

function PlanetMesh({
  memory, isSelected, isDragging, onSelect,
  onDragStart, onDragEnd, dragPos,
}: PlanetMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const reallyDragging = useRef(false);
  const color = MEMORY_COLORS[memory.type] ?? '#6b7280';
  const radius3D = auTo3D(memory.distance);
  const { theta, phi } = useMemo(() => idToAngles(memory.id), [memory.id]);
  const size = planetSize(memory.importance);

  // Compute position
  const position = useMemo(() => {
    if (isDragging && dragPos) return dragPos;
    return new THREE.Vector3(
      radius3D * Math.cos(phi) * Math.cos(theta),
      radius3D * Math.sin(phi),
      radius3D * Math.cos(phi) * Math.sin(theta),
    );
  }, [radius3D, theta, phi, isDragging, dragPos]);

  // Hover/select pulse
  useFrame(() => {
    if (!meshRef.current) return;
    if (isSelected) {
      const s = 1.0 + Math.sin(Date.now() * 0.005) * 0.15;
      meshRef.current.scale.setScalar(s);
    } else if (hovered) {
      meshRef.current.scale.setScalar(1.15);
    } else {
      meshRef.current.scale.setScalar(1);
    }
  });

  // Truncate text for tooltip
  const tooltipText = memory.summary || memory.content.slice(0, 60);
  const tooltipLabel = tooltipText.length > 50 ? tooltipText.slice(0, 50) + '...' : tooltipText;

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    pointerDownPos.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    reallyDragging.current = false;
  }, []);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!pointerDownPos.current) return;
    const dx = e.nativeEvent.clientX - pointerDownPos.current.x;
    const dy = e.nativeEvent.clientY - pointerDownPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD && !reallyDragging.current) {
      reallyDragging.current = true;
      onDragStart(memory.id);
    }
  }, [memory.id, onDragStart]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (reallyDragging.current && isDragging && dragPos) {
      const dist = dragPos.length();
      const au = threeDToAU(dist);
      onDragEnd(memory.id, Math.min(100, Math.max(0.1, au)));
    } else {
      // This was a click (no meaningful pointer movement)
      onSelect(memory);
    }
    pointerDownPos.current = null;
    reallyDragging.current = false;
  }, [memory, isDragging, dragPos, onDragEnd, onSelect]);

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'pointer';
  }, []);

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    document.body.style.cursor = 'auto';
  }, []);

  return (
    <group position={position}>
      {/* Selection ring + label */}
      {isSelected && !isDragging && (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[size + 0.08, 0.02, 8, 32]} />
            <meshBasicMaterial color="white" transparent opacity={0.7} />
          </mesh>
          {/* Selected label — persistent, shows below the planet */}
          <Html
            position={[0, -(size + 0.25), 0]}
            center
            style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
            zIndexRange={[50, 0]}
          >
            <div style={{
              fontSize: 10,
              color: color,
              fontWeight: 600,
              textShadow: '0 0 6px rgba(0,0,0,0.8)',
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'center',
            }}>
              {(memory.summary || memory.content.slice(0, 30)).slice(0, 40)}
            </div>
          </Html>
        </>
      )}

      {/* Drag glow */}
      {isDragging && (
        <mesh>
          <sphereGeometry args={[size + 0.12, 16, 16]} />
          <meshBasicMaterial color="white" transparent opacity={0.2} wireframe />
        </mesh>
      )}

      {/* Hover tooltip — HTML overlay */}
      {hovered && !isDragging && (
        <Html
          position={[0, size + 0.2, 0]}
          center
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
          zIndexRange={[100, 0]}
        >
          <div style={{
            background: 'rgba(10, 15, 30, 0.92)',
            border: `1px solid ${color}55`,
            borderRadius: 6,
            padding: '6px 10px',
            maxWidth: 240,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: color,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 3,
            }}>
              {memory.type} · {memory.distance.toFixed(1)} AU
            </div>
            <div style={{
              fontSize: 12,
              color: '#e5e7eb',
              lineHeight: 1.4,
            }}>
              {tooltipLabel}
            </div>
          </div>
        </Html>
      )}

      {/* Planet body — enlarged hit area */}
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isDragging ? 0.8 : hovered ? 0.6 : 0.3}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* Invisible larger hit area for easier clicking */}
      <mesh
        visible={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[Math.max(size * 1.8, 0.25), 16, 16]} />
        <meshBasicMaterial />
      </mesh>

      {/* Inner dot */}
      {size > 0.2 && (
        <mesh>
          <sphereGeometry args={[size * 0.35, 12, 12]} />
          <meshBasicMaterial color="white" transparent opacity={0.2} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Drag Plane (invisible plane for raycasting during drag)
// ---------------------------------------------------------------------------

function DragPlane({
  isDragging,
  onDragMove,
}: {
  isDragging: boolean;
  onDragMove: (pos: THREE.Vector3) => void;
}) {
  const { camera, raycaster, pointer } = useThree();
  const planeRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!isDragging || !planeRef.current) return;

    // Keep plane facing camera
    planeRef.current.quaternion.copy(camera.quaternion);

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(planeRef.current);
    if (intersects.length > 0) {
      onDragMove(intersects[0].point.clone());
    }
  });

  if (!isDragging) return null;

  return (
    <mesh ref={planeRef} visible={false}>
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Drag Guide Ring (shows target orbit while dragging)
// ---------------------------------------------------------------------------

function DragGuide({ dragPos }: { dragPos: THREE.Vector3 | null }) {
  if (!dragPos) return null;
  const dist = dragPos.length();
  const au = threeDToAU(dist);
  const clampedAU = Math.min(100, Math.max(0.1, au));

  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[dist, 0.015, 8, 128]} />
        <meshBasicMaterial color="white" transparent opacity={0.3} />
      </mesh>
      <Text
        position={[dist + 0.4, 0.3, 0]}
        fontSize={0.25}
        color="white"
        fillOpacity={0.6}
        anchorX="left"
      >
        {clampedAU.toFixed(1)} AU
      </Text>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main Scene
// ---------------------------------------------------------------------------

interface SceneProps {
  memories: Memory[];
  sun: SunState | null;
  selectedId: string | null;
  onSelectMemory: (memory: Memory | null) => void;
  onSelectSun: () => void;
  onDragEnd?: (memoryId: string, newDistanceAU: number) => void;
}

function Scene({ memories, sun, selectedId, onSelectMemory, onSelectSun, onDragEnd }: SceneProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<THREE.Vector3 | null>(null);
  const controlsRef = useRef<any>(null);

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, []);

  const handleDragMove = useCallback((pos: THREE.Vector3) => {
    setDragPos(pos);
  }, []);

  const handleDragEnd = useCallback((id: string, au: number) => {
    setDraggingId(null);
    setDragPos(null);
    if (controlsRef.current) controlsRef.current.enabled = true;
    onDragEnd?.(id, au);
  }, [onDragEnd]);

  const handleBgClick = useCallback(() => {
    if (!draggingId) onSelectMemory(null);
  }, [draggingId, onSelectMemory]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 0, 0]} intensity={2} color="#fbbf24" distance={30} />

      {/* Stars background */}
      <Stars radius={80} depth={60} count={3000} factor={3} fade speed={0.5} />

      {/* Camera controls — rotate like a globe */}
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableDamping
        dampingFactor={0.1}
        minDistance={3}
        maxDistance={45}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
        // Disable keyboard controls to prevent 'q' and other key errors
        // propagating through OrbitControls to the page
        keys={{
          LEFT: '',
          UP: '',
          RIGHT: '',
          BOTTOM: '',
        }}
        makeDefault
      />

      {/* Background click catcher */}
      <mesh onClick={handleBgClick} visible={false}>
        <sphereGeometry args={[100, 8, 8]} />
        <meshBasicMaterial side={THREE.BackSide} />
      </mesh>

      {/* Orbit zones */}
      <OrbitRings />

      {/* Drag plane */}
      <DragPlane isDragging={!!draggingId} onDragMove={handleDragMove} />

      {/* Drag guide */}
      {draggingId && <DragGuide dragPos={dragPos} />}

      {/* Planets */}
      {memories.map((m) => (
        <PlanetMesh
          key={m.id}
          memory={m}
          isSelected={m.id === selectedId}
          isDragging={m.id === draggingId}
          onSelect={onSelectMemory}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          dragPos={m.id === draggingId ? dragPos : null}
        />
      ))}

      {/* Sun */}
      <SunMesh sun={sun} onClick={onSelectSun} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported Component
// ---------------------------------------------------------------------------

export interface SolarSystemProps {
  memories: Memory[];
  sun: SunState | null;
  selectedId: string | null;
  onSelectMemory: (memory: Memory | null) => void;
  onSelectSun: () => void;
  onDragEnd?: (memoryId: string, newDistanceAU: number) => void;
  totalCount?: number; // total memories including filtered ones
}

export function SolarSystem(props: SolarSystemProps) {
  const { memories, totalCount } = props;
  const filteredOut = (totalCount ?? memories.length) - memories.length;

  return (
    <div
      className="absolute inset-0"
      style={{ background: '#050a14' }}
      // Prevent keyboard events from bubbling up (fixes 'q' etc errors)
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [0, 12, 25], fov: 50, near: 0.1, far: 200 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ scene }) => {
            scene.background = new THREE.Color('#050a14');
          }}
        >
          <Suspense fallback={null}>
            <Scene {...props} />
          </Suspense>
        </Canvas>
      </CanvasErrorBoundary>

      {/* Top-left: planet count */}
      <div className="absolute top-3 left-3 pointer-events-none">
        <div className="text-xs text-gray-500 font-mono">
          {memories.length} planets
          {filteredOut > 0 && (
            <span className="text-gray-600"> · {filteredOut} empty filtered</span>
          )}
        </div>
      </div>

      {/* Legend overlay */}
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

      {/* Controls hint */}
      <div className="absolute bottom-3 right-3 text-xs text-gray-600 pointer-events-none">
        드래그: 회전 · 스크롤: 줌 · 행성 호버: 미리보기 · 클릭: 상세 · 행성 드래그: 궤도 변경
      </div>
    </div>
  );
}
