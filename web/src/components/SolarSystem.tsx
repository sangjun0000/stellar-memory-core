import {
  Suspense, useRef, useMemo, useState, useCallback,
  Component, type ReactNode, useEffect,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent, extend } from '@react-three/fiber';
import { OrbitControls, Text, Html, Stars, Sparkles, shaderMaterial } from '@react-three/drei';
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
          background: '#020810', color: '#ef4444', fontFamily: 'monospace', fontSize: 14, padding: 24,
          flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 18, marginBottom: 4 }}>3D Render Error</div>
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
  { zone: 'corona',    minAU: 0.1,  maxAU: 1.0,  label: 'CORONA',    color: '#fbbf24' },
  { zone: 'inner',     minAU: 1.0,  maxAU: 5.0,  label: 'INNER',     color: '#f97316' },
  { zone: 'habitable', minAU: 5.0,  maxAU: 15.0, label: 'HABITABLE', color: '#22c55e' },
  { zone: 'outer',     minAU: 15.0, maxAU: 40.0, label: 'OUTER',     color: '#60a5fa' },
  { zone: 'kuiper',    minAU: 40.0, maxAU: 70.0, label: 'KUIPER',    color: '#a78bfa' },
  { zone: 'oort',      minAU: 70.0, maxAU: 100.0,label: 'OORT',      color: '#9ca3af' },
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
  const phi = (h2 % 1800) / 1800 * (Math.PI / 4) - Math.PI / 8;
  return { theta, phi };
}

// Planet size from importance
function planetSize(importance: number): number {
  return 0.12 + importance * 0.28;
}

// ---------------------------------------------------------------------------
// Custom Shader Materials (via drei shaderMaterial helper)
// ---------------------------------------------------------------------------

// Fresnel/halo glow shader — soft additive glow on sphere edges
const GlowMaterialImpl = shaderMaterial(
  { glowColor: new THREE.Color('#fbbf24'), intensity: 1.0, power: 2.5 },
  // vertex
  `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  // fragment
  `
    uniform vec3 glowColor;
    uniform float intensity;
    uniform float power;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = dot(normal, viewDir);
      fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
      fresnel = pow(fresnel, power);
      gl_FragColor = vec4(glowColor * fresnel * intensity, fresnel * 0.85);
    }
  `,
);
extend({ GlowMaterialImpl });

// Sun corona shader — radial animated pulse with multiple wave layers
const SunCoraMaterialImpl = shaderMaterial(
  { time: 0, sunColor: new THREE.Color('#fbbf24') },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform float time;
    uniform vec3 sunColor;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      float dist = length(uv);
      float pulse1 = sin(dist * 8.0 - time * 2.5) * 0.5 + 0.5;
      float pulse2 = sin(dist * 12.0 - time * 1.8 + 1.2) * 0.5 + 0.5;
      float corona = (pulse1 * 0.6 + pulse2 * 0.4) * smoothstep(1.0, 0.3, dist);
      float edge = smoothstep(1.0, 0.5, dist) * (1.0 - smoothstep(0.5, 0.1, dist));
      float alpha = corona * 0.35 + edge * 0.12;
      vec3 col = mix(sunColor * 1.4, vec3(1.0, 0.7, 0.2), pulse1 * 0.4);
      gl_FragColor = vec4(col, alpha * smoothstep(1.0, 0.2, dist));
    }
  `,
);
extend({ SunCoraMaterialImpl });

// Declare module augmentation for R3F JSX types
declare module '@react-three/fiber' {
  interface ThreeElements {
    glowMaterialImpl: any;
    sunCoraMaterialImpl: any;
  }
}

// ---------------------------------------------------------------------------
// Sun Mesh — premium pulsating star with corona
// ---------------------------------------------------------------------------

function SunMesh({ sun, onClick }: { sun: SunState | null; onClick: () => void }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const coroRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const coraMat = useRef<any>(null);

  const color = sun ? '#fbbf24' : '#6b7280';
  const colorObj = useMemo(() => new THREE.Color(color), [color]);

  useFrame((_, delta) => {
    const t = Date.now() * 0.001;

    if (coreRef.current) {
      coreRef.current.rotation.y += delta * 0.18;
      coreRef.current.rotation.x += delta * 0.04;
      // Subtle breathe
      const breath = 1.0 + Math.sin(t * 1.1) * 0.04 + Math.sin(t * 0.7) * 0.025;
      coreRef.current.scale.setScalar(breath);
    }
    if (coroRef.current) {
      coroRef.current.rotation.y -= delta * 0.07;
      coroRef.current.rotation.z += delta * 0.03;
      const s = 1.0 + Math.sin(t * 0.9 + 1.0) * 0.06;
      coroRef.current.scale.setScalar(s);
    }
    if (haloRef.current) {
      const s = 1.0 + Math.sin(t * 0.5) * 0.09 + Math.sin(t * 1.3 + 0.5) * 0.04;
      haloRef.current.scale.setScalar(s);
    }
    if (outerRef.current) {
      const s = 1.0 + Math.sin(t * 0.3 + 2.0) * 0.12;
      outerRef.current.scale.setScalar(s);
    }
    if (coraMat.current) {
      coraMat.current.uniforms.time.value = t;
    }
  });

  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {/* Outermost diffuse halo */}
      <mesh ref={outerRef}>
        <sphereGeometry args={[1.6, 32, 32]} />
        <glowMaterialImpl
          ref={null}
          glowColor={colorObj}
          intensity={sun ? 0.5 : 0.2}
          power={1.2}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Corona animated billboard */}
      <mesh ref={coroRef}>
        <planeGeometry args={[3.2, 3.2]} />
        <sunCoraMaterialImpl
          ref={coraMat}
          sunColor={colorObj}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Mid glow ring */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.82, 32, 32]} />
        <glowMaterialImpl
          ref={null}
          glowColor={colorObj}
          intensity={sun ? 1.1 : 0.4}
          power={2.0}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Inner shell */}
      <mesh>
        <sphereGeometry args={[0.57, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} />
      </mesh>

      {/* Sun core */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.5, 48, 48]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={sun ? 2.5 : 0.8}
          roughness={0.15}
          metalness={0.0}
        />
      </mesh>

      {/* Sparkles orbiting the sun */}
      {sun && (
        <Sparkles
          count={60}
          scale={[2.6, 2.6, 2.6]}
          size={3}
          speed={0.4}
          opacity={0.55}
          color={color}
          noise={0.5}
        />
      )}

      {/* Label */}
      <Text
        position={[0, -1.05, 0]}
        fontSize={0.22}
        color={sun ? '#fcd34d' : '#9ca3af'}
        fillOpacity={sun ? 0.9 : 0.5}
        anchorX="center"
        anchorY="top"
        letterSpacing={0.08}
      >
        {sun ? sun.project.toUpperCase() : 'NO STATE'}
      </Text>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Orbit Rings — premium dashed/gradient appearance
// ---------------------------------------------------------------------------

function OrbitRings() {
  const groupRef = useRef<THREE.Group>(null);
  const time = useRef(0);

  useFrame((_, delta) => {
    time.current += delta;
    if (groupRef.current) {
      // Very slow drift of the ring group to give life
      groupRef.current.rotation.y = Math.sin(time.current * 0.02) * 0.015;
    }
  });

  return (
    <group ref={groupRef}>
      {ZONE_DEFS.map((z, i) => {
        const r = auTo3D(z.maxAU);
        const rInner = auTo3D(z.minAU);
        const zoneColor = new THREE.Color(z.color);
        return (
          <group key={z.zone}>
            {/* Primary ring - thin bright */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r, 0.018, 6, 180]} />
              <meshBasicMaterial
                color={zoneColor}
                transparent
                opacity={0.22}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
            {/* Secondary ring - wider soft glow */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r, 0.06, 6, 120]} />
              <meshBasicMaterial
                color={zoneColor}
                transparent
                opacity={0.05}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
            {/* Inner boundary (minor) */}
            {i > 0 && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[rInner, 0.008, 4, 120]} />
                <meshBasicMaterial
                  color={zoneColor}
                  transparent
                  opacity={0.08}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
            )}
            {/* Zone label */}
            <Text
              position={[r * 0.707 + 0.1, 0.18, -r * 0.707]}
              fontSize={0.24}
              color={z.color}
              anchorX="left"
              anchorY="bottom"
              fillOpacity={0.45}
              letterSpacing={0.12}
            >
              {z.label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

// Type-specific visual configs
const TYPE_VISUAL: Record<string, { emissiveBoost: number; roughness: number; metalness: number; pulseSpeed: number }> = {
  decision:    { emissiveBoost: 0.1, roughness: 0.1, metalness: 0.7, pulseSpeed: 1.0 },  // crystalline metallic
  error:       { emissiveBoost: 0.25, roughness: 0.5, metalness: 0.1, pulseSpeed: 2.4 }, // red urgent pulse
  task:        { emissiveBoost: 0.05, roughness: 0.6, metalness: 0.3, pulseSpeed: 0.6 }, // green steady
  observation: { emissiveBoost: 0.0,  roughness: 0.8, metalness: 0.0, pulseSpeed: 0.4 }, // muted rock
  milestone:   { emissiveBoost: 0.2,  roughness: 0.2, metalness: 0.5, pulseSpeed: 1.5 }, // golden shine
  context:     { emissiveBoost: 0.1,  roughness: 0.3, metalness: 0.6, pulseSpeed: 0.8 }, // purple gem
};

// ---------------------------------------------------------------------------
// Orbit Trails rendered at scene level (correct positioning)
// ---------------------------------------------------------------------------

function OrbitTrailScene({ memories }: { memories: Memory[] }) {
  return (
    <>
      {memories.map((m) => {
        const r = auTo3D(m.distance);
        const color = MEMORY_COLORS[m.type] ?? '#6b7280';
        const colorObj = new THREE.Color(color);
        return (
          <mesh key={m.id} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r, 0.005, 4, 100]} />
            <meshBasicMaterial
              color={colorObj}
              transparent
              opacity={0.1}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </>
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
// Drag Guide Ring
// ---------------------------------------------------------------------------

function DragGuide({ dragPos }: { dragPos: THREE.Vector3 | null }) {
  if (!dragPos) return null;
  const dist = dragPos.length();
  const au = threeDToAU(dist);
  const clampedAU = Math.min(100, Math.max(0.1, au));

  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[dist, 0.016, 6, 140]} />
        <meshBasicMaterial
          color="white"
          transparent
          opacity={0.38}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Second guide ring slightly bigger */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[dist, 0.04, 6, 100]} />
        <meshBasicMaterial
          color="white"
          transparent
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <Text
        position={[dist + 0.45, 0.3, 0]}
        fontSize={0.24}
        color="white"
        fillOpacity={0.65}
        anchorX="left"
        letterSpacing={0.05}
      >
        {clampedAU.toFixed(1)} AU
      </Text>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Auto-rotate controller — slow idle camera spin
// ---------------------------------------------------------------------------

function AutoRotate({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  const angle = useRef(0);
  const initialRadius = useRef<number | null>(null);

  useFrame((_, delta) => {
    if (!enabled) return;
    if (initialRadius.current === null) {
      initialRadius.current = Math.sqrt(
        camera.position.x ** 2 + camera.position.z ** 2,
      );
    }
    angle.current += delta * 0.025; // very slow: ~1 rotation per 4 minutes
    const r = initialRadius.current;
    camera.position.x = Math.sin(angle.current) * r;
    camera.position.z = Math.cos(angle.current) * r;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Ambient dust particles floating through the scene
// ---------------------------------------------------------------------------

function AmbientDust() {
  return (
    <>
      {/* Large sparse dust */}
      <Sparkles
        count={80}
        scale={[45, 25, 45]}
        size={1.2}
        speed={0.05}
        opacity={0.18}
        color="#a0b8ff"
        noise={2}
      />
      {/* Small dense near dust */}
      <Sparkles
        count={120}
        scale={[20, 12, 20]}
        size={0.7}
        speed={0.08}
        opacity={0.12}
        color="#c8d8ff"
        noise={1}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Nebula background — large gradient sphere
// ---------------------------------------------------------------------------

function NebulaSphere() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.004;
      meshRef.current.rotation.x += delta * 0.002;
    }
  });

  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Deep space background gradient
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,   'rgba(20, 10, 60, 0.0)');
    grad.addColorStop(0.3, 'rgba(5, 3, 25, 0.5)');
    grad.addColorStop(0.6, 'rgba(2, 8, 35, 0.7)');
    grad.addColorStop(1,   'rgba(0, 2, 15, 0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Nebula wisps
    const addWisp = (x: number, y: number, r: number, rg: number, b: number, alpha: number, radius: number) => {
      const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, radius * size);
      g.addColorStop(0, `rgba(${r},${rg},${b},${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    };

    addWisp(0.2, 0.3, 60, 20, 120, 0.12, 0.3);   // purple nebula
    addWisp(0.8, 0.7, 20, 60, 110, 0.10, 0.25);   // blue nebula
    addWisp(0.5, 0.8, 80, 30, 60,  0.07, 0.2);    // warm deep
    addWisp(0.1, 0.9, 10, 80, 120, 0.08, 0.22);   // teal
    addWisp(0.9, 0.1, 50, 15, 80,  0.06, 0.18);   // violet

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[95, 32, 32]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.BackSide}
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Rich starfield with size variation
// ---------------------------------------------------------------------------

function RichStarfield() {
  return (
    <>
      {/* Base layer — many small dim stars */}
      <Stars radius={75} depth={55} count={4000} factor={2.5} fade speed={0.3} saturation={0.2} />
      {/* Mid layer — fewer brighter */}
      <Stars radius={65} depth={30} count={800}  factor={4.5} fade speed={0.5} saturation={0.3} />
      {/* Foreground — a few large bright */}
      <Stars radius={40} depth={15} count={120}  factor={7}   fade speed={0.8} saturation={0.5} />
    </>
  );
}

// ---------------------------------------------------------------------------
// InstancedPlanets — renders all planet bodies as ONE InstancedMesh
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

interface InstancedPlanetsProps {
  memories: Memory[];
  selectedId: string | null;
  hoveredId: string | null;
  draggingId: string | null;
  dragPos: THREE.Vector3 | null;
  onHover: (id: string | null) => void;
  onSelect: (memory: Memory) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, distance: number) => void;
}

function InstancedPlanets({
  memories, selectedId, hoveredId, draggingId, dragPos,
  onHover, onSelect, onDragStart, onDragEnd,
}: InstancedPlanetsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const pointerDownIdx = useRef<number>(-1);
  const reallyDragging = useRef(false);

  // Precompute positions and sizes per memory
  const planetData = useMemo(() => memories.map((m) => {
    const radius3D = auTo3D(m.distance);
    const { theta, phi } = idToAngles(m.id);
    const size = planetSize(m.importance);
    const pos = new THREE.Vector3(
      radius3D * Math.cos(phi) * Math.cos(theta),
      radius3D * Math.sin(phi),
      radius3D * Math.cos(phi) * Math.sin(theta),
    );
    const color = MEMORY_COLORS[m.type] ?? '#6b7280';
    return { pos, size, color };
  }), [memories]);

  // Update instance matrices and colors every frame
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || memories.length === 0) return;

    for (let i = 0; i < memories.length; i++) {
      const d = planetData[i];
      const m = memories[i];
      const isThisDragging = m.id === draggingId;

      // Position: use drag position if dragging this one
      if (isThisDragging && dragPos) {
        _dummy.position.copy(dragPos);
      } else {
        _dummy.position.copy(d.pos);
      }

      // Scale
      const baseScale = d.size;
      let scale = baseScale;
      if (m.id === selectedId) {
        const t = Date.now() * 0.001;
        scale = baseScale * (1.0 + Math.sin(t * 1.2) * 0.18);
      } else if (m.id === hoveredId) {
        scale = baseScale * 1.18;
      } else if (m.type === 'error') {
        const t = Date.now() * 0.001;
        scale = baseScale * (1.0 + Math.sin(t * 2.4) * 0.07);
      } else if (m.type === 'milestone') {
        const t = Date.now() * 0.001;
        scale = baseScale * (1.0 + Math.sin(t * 1.5 + Math.PI) * 0.04);
      }
      _dummy.scale.setScalar(scale);

      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      // Color
      const visual = TYPE_VISUAL[m.type] ?? TYPE_VISUAL.observation;
      const emissiveMix = isThisDragging ? 0.5
        : m.id === selectedId ? 0.35
        : m.id === hoveredId ? 0.28
        : 0.15 + visual.emissiveBoost * 0.5;
      _color.set(d.color);
      // Brighten by mixing with white for emissive-like effect
      _color.lerp(new THREE.Color('#ffffff'), emissiveMix);
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    pointerDownPos.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    pointerDownIdx.current = e.instanceId;
    reallyDragging.current = false;
  }, []);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    // Hover detection
    if (e.instanceId !== undefined && !pointerDownPos.current) {
      const m = memories[e.instanceId];
      if (m && hoveredId !== m.id) {
        onHover(m.id);
        document.body.style.cursor = 'pointer';
      }
    }
    // Drag detection
    if (!pointerDownPos.current) return;
    const dx = e.nativeEvent.clientX - pointerDownPos.current.x;
    const dy = e.nativeEvent.clientY - pointerDownPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD && !reallyDragging.current) {
      reallyDragging.current = true;
      const m = memories[pointerDownIdx.current];
      if (m) onDragStart(m.id);
    }
  }, [memories, hoveredId, onHover, onDragStart]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const idx = pointerDownIdx.current;
    if (idx >= 0 && idx < memories.length) {
      const m = memories[idx];
      if (reallyDragging.current && draggingId && dragPos) {
        const dist = dragPos.length();
        const au = threeDToAU(dist);
        onDragEnd(m.id, Math.min(100, Math.max(0.1, au)));
      } else {
        onSelect(m);
      }
    }
    pointerDownPos.current = null;
    pointerDownIdx.current = -1;
    reallyDragging.current = false;
  }, [memories, draggingId, dragPos, onDragEnd, onSelect]);

  const handlePointerOut = useCallback(() => {
    onHover(null);
    document.body.style.cursor = 'auto';
  }, [onHover]);

  if (memories.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, memories.length]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerOut={handlePointerOut}
    >
      <sphereGeometry args={[1, 20, 20]} />
      <meshStandardMaterial
        vertexColors
        roughness={0.4}
        metalness={0.3}
        emissive="#ffffff"
        emissiveIntensity={0.15}
      />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// DetailOverlay — glow, rings, tooltips for hovered/selected planet only
// ---------------------------------------------------------------------------

function DetailOverlay({ memory, isSelected, isDragging, dragPos }: {
  memory: Memory;
  isSelected: boolean;
  isDragging: boolean;
  dragPos: THREE.Vector3 | null;
}) {
  const glowMeshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const color = MEMORY_COLORS[memory.type] ?? '#6b7280';
  const colorObj = useMemo(() => new THREE.Color(color), [color]);
  const radius3D = auTo3D(memory.distance);
  const { theta, phi } = useMemo(() => idToAngles(memory.id), [memory.id]);
  const size = planetSize(memory.importance);
  const visual = TYPE_VISUAL[memory.type] ?? TYPE_VISUAL.observation;

  const staticPos = useMemo(() => new THREE.Vector3(
    radius3D * Math.cos(phi) * Math.cos(theta),
    radius3D * Math.sin(phi),
    radius3D * Math.cos(phi) * Math.sin(theta),
  ), [radius3D, theta, phi]);

  const position = isDragging && dragPos ? dragPos : staticPos;

  const tooltipText = memory.summary || memory.content.slice(0, 60);
  const tooltipLabel = tooltipText.length > 50 ? tooltipText.slice(0, 50) + '...' : tooltipText;

  useFrame(() => {
    const t = Date.now() * 0.001;
    if (glowMeshRef.current) {
      const baseIntensity = isSelected ? 1.0 : isDragging ? 1.2 : 0.75;
      const pulse = memory.type === 'error'
        ? Math.sin(t * visual.pulseSpeed) * 0.25
        : Math.sin(t * 0.8) * 0.08;
      const mat = glowMeshRef.current.material as THREE.ShaderMaterial;
      if (mat.uniforms?.intensity) {
        mat.uniforms.intensity.value = baseIntensity + pulse;
      }
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += 0.008;
    }
  });

  return (
    <group position={position}>
      {/* Glow halo */}
      <mesh ref={glowMeshRef}>
        <sphereGeometry args={[size * 1.65, 16, 16]} />
        <glowMaterialImpl
          ref={null}
          glowColor={colorObj}
          intensity={0.9}
          power={memory.type === 'error' ? 1.8 : 2.5}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Selection rings */}
      {isSelected && !isDragging && (
        <>
          <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[size + 0.11, 0.018, 8, 48]} />
            <meshBasicMaterial
              color="white"
              transparent
              opacity={0.75}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[Math.PI / 3, Math.PI / 6, 0]}>
            <torusGeometry args={[size + 0.16, 0.008, 6, 48]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.45}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <Html position={[0, -(size + 0.28), 0]} center zIndexRange={[50, 0]}>
            <div style={{
              pointerEvents: 'none', width: 'max-content', maxWidth: 170,
              fontSize: 9.5, color, fontWeight: 700, fontFamily: 'monospace',
              textShadow: `0 0 8px ${color}99, 0 0 16px ${color}44`,
              letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', textAlign: 'center', textTransform: 'uppercase',
            }}>
              {(memory.summary || memory.content.slice(0, 30)).slice(0, 42)}
            </div>
          </Html>
        </>
      )}

      {/* Drag mode effects */}
      {isDragging && (
        <>
          <mesh>
            <sphereGeometry args={[size + 0.14, 14, 14]} />
            <meshBasicMaterial color="white" transparent opacity={0.18} wireframe />
          </mesh>
          <Sparkles count={20} scale={size * 3} size={2.5} speed={0.8} color={color} opacity={0.6} />
        </>
      )}

      {/* Hover tooltip (show when not selected and not dragging) */}
      {!isSelected && !isDragging && (
        <Html position={[0, size + 0.25, 0]} center zIndexRange={[100, 0]}>
          <div style={{
            pointerEvents: 'none', width: 'max-content', maxWidth: 250, minWidth: 110,
            background: 'rgba(5, 10, 22, 0.93)', border: `1px solid ${color}66`,
            borderRadius: 8, padding: '7px 12px',
            boxShadow: `0 0 20px ${color}33, inset 0 1px 0 ${color}22`,
            backdropFilter: 'blur(6px)',
          }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, color, textTransform: 'uppercase',
              letterSpacing: '0.1em', fontFamily: 'monospace', marginBottom: 4,
              whiteSpace: 'nowrap', display: 'flex', justifyContent: 'space-between', gap: 12,
            }}>
              <span>{memory.type}</span>
              <span style={{ opacity: 0.7 }}>{memory.distance.toFixed(1)} AU</span>
            </div>
            <div style={{
              fontSize: 11.5, color: '#e5e7eb', lineHeight: 1.45,
              whiteSpace: 'normal', wordBreak: 'break-word',
            }}>
              {tooltipLabel}
            </div>
          </div>
        </Html>
      )}
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);
  const controlsRef = useRef<any>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track user interaction to toggle auto-rotate
  const resetIdleTimer = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 8000);
  }, []);

  useEffect(() => {
    resetIdleTimer();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [resetIdleTimer]);

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
    resetIdleTimer();
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, [resetIdleTimer]);

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
    if (!draggingId) {
      onSelectMemory(null);
      setHoveredId(null);
    }
    resetIdleTimer();
  }, [draggingId, onSelectMemory, resetIdleTimer]);

  // Find the memory objects for hovered/selected/dragging to render detail overlays
  const hoveredMemory = useMemo(
    () => hoveredId ? memories.find((m) => m.id === hoveredId) ?? null : null,
    [memories, hoveredId],
  );
  const selectedMemory = useMemo(
    () => selectedId ? memories.find((m) => m.id === selectedId) ?? null : null,
    [memories, selectedId],
  );
  const draggingMemory = useMemo(
    () => draggingId ? memories.find((m) => m.id === draggingId) ?? null : null,
    [memories, draggingId],
  );

  return (
    <>
      {/* Lighting — warm sun point + cool ambient + rim fill */}
      <ambientLight intensity={0.15} color="#1a2040" />
      <pointLight position={[0, 0, 0]} intensity={3.5} color="#fbbf24" distance={35} decay={1.5} />
      <pointLight position={[0, 0, 0]} intensity={1.2} color="#fde68a" distance={12} decay={2} />
      <hemisphereLight args={['#0d1a3a', '#000510', 0.4]} />

      {/* Rich starfield */}
      <RichStarfield />

      {/* Nebula background sphere */}
      <NebulaSphere />

      {/* Ambient dust particles */}
      <AmbientDust />

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={2.5}
        maxDistance={45}
        rotateSpeed={0.45}
        zoomSpeed={0.75}
        keys={{ LEFT: '', UP: '', RIGHT: '', BOTTOM: '' }}
        makeDefault
        onChange={resetIdleTimer}
      />

      {/* Auto-rotate when idle */}
      <AutoRotate enabled={idle && !draggingId} />

      {/* Background click catcher */}
      <mesh onClick={handleBgClick} visible={false}>
        <sphereGeometry args={[100, 8, 8]} />
        <meshBasicMaterial side={THREE.BackSide} />
      </mesh>

      {/* Orbit zone rings */}
      <OrbitRings />

      {/* Planet orbital trails at scene level */}
      <OrbitTrailScene memories={memories} />

      {/* Drag plane */}
      <DragPlane isDragging={!!draggingId} onDragMove={handleDragMove} />

      {/* Drag guide */}
      {draggingId && <DragGuide dragPos={dragPos} />}

      {/* Instanced planet bodies — single draw call for all planets */}
      <InstancedPlanets
        memories={memories}
        selectedId={selectedId}
        hoveredId={hoveredId}
        draggingId={draggingId}
        dragPos={dragPos}
        onHover={setHoveredId}
        onSelect={onSelectMemory}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />

      {/* Detail overlays for hovered planet (glow, tooltip) */}
      {hoveredMemory && hoveredMemory.id !== selectedId && hoveredMemory.id !== draggingId && (
        <DetailOverlay
          memory={hoveredMemory}
          isSelected={false}
          isDragging={false}
          dragPos={null}
        />
      )}

      {/* Detail overlay for selected planet (glow, rings, label) */}
      {selectedMemory && (
        <DetailOverlay
          memory={selectedMemory}
          isSelected
          isDragging={selectedMemory.id === draggingId}
          dragPos={selectedMemory.id === draggingId ? dragPos : null}
        />
      )}

      {/* Detail overlay for dragging planet (if not also selected) */}
      {draggingMemory && draggingMemory.id !== selectedId && (
        <DetailOverlay
          memory={draggingMemory}
          isSelected={false}
          isDragging
          dragPos={dragPos}
        />
      )}

      {/* Sun */}
      <SunMesh sun={sun} onClick={onSelectSun} />
    </>
  );
}

// ---------------------------------------------------------------------------
// HUD Overlays (React DOM — not 3D)
// ---------------------------------------------------------------------------

interface HUDProps {
  memories: Memory[];
  totalCount?: number;
}

function HUDPlanetCount({ memories, totalCount }: HUDProps) {
  const filteredOut = (totalCount ?? memories.length) - memories.length;

  return (
    <div style={{
      position: 'absolute',
      top: 14,
      left: 14,
      pointerEvents: 'none',
      fontFamily: 'monospace',
      userSelect: 'none',
    }}>
      <div style={{
        background: 'rgba(5, 12, 28, 0.72)',
        border: '1px solid rgba(96, 165, 250, 0.2)',
        borderRadius: 6,
        padding: '5px 10px',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 2,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 0 14px rgba(96, 165, 250, 0.08)',
      }}>
        <div style={{
          fontSize: 9,
          letterSpacing: '0.15em',
          color: 'rgba(96, 165, 250, 0.55)',
          textTransform: 'uppercase',
        }}>
          STELLAR MEMORY
        </div>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#93c5fd',
          letterSpacing: '0.05em',
          lineHeight: 1,
        }}>
          {memories.length}
          <span style={{ fontSize: 9, fontWeight: 400, color: 'rgba(147, 197, 253, 0.5)', marginLeft: 5 }}>
            PLANETS
          </span>
        </div>
        {filteredOut > 0 && (
          <div style={{ fontSize: 9, color: 'rgba(107, 114, 128, 0.7)', letterSpacing: '0.05em' }}>
            +{filteredOut} FILTERED
          </div>
        )}
      </div>
    </div>
  );
}

const LEGEND_ITEMS = [
  { type: 'decision',    color: '#2563eb', label: 'Decision' },
  { type: 'error',       color: '#dc2626', label: 'Error' },
  { type: 'task',        color: '#16a34a', label: 'Task' },
  { type: 'observation', color: '#6b7280', label: 'Observation' },
  { type: 'milestone',   color: '#eab308', label: 'Milestone' },
  { type: 'context',     color: '#7c3aed', label: 'Context' },
] as const;

function HUDLegend() {
  return (
    <div style={{
      position: 'absolute',
      bottom: 14,
      left: 14,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <div style={{
        background: 'rgba(5, 12, 28, 0.70)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: 8,
        padding: '7px 12px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 14px',
        maxWidth: 380,
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      }}>
        {LEGEND_ITEMS.map((item) => (
          <div key={item.type} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            color: 'rgba(209, 213, 219, 0.75)',
            fontFamily: 'monospace',
            letterSpacing: '0.05em',
          }}>
            <span style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: item.color,
              boxShadow: `0 0 5px ${item.color}99`,
              flexShrink: 0,
            }} />
            {item.label.toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}

function HUDControlsHint() {
  return (
    <div style={{
      position: 'absolute',
      bottom: 14,
      right: 14,
      pointerEvents: 'none',
      userSelect: 'none',
      fontFamily: 'monospace',
      fontSize: 9,
      color: 'rgba(107, 114, 128, 0.45)',
      textAlign: 'right',
      lineHeight: 1.7,
      letterSpacing: '0.04em',
    }}>
      <div>DRAG · ROTATE &nbsp; SCROLL · ZOOM</div>
      <div>HOVER · PREVIEW &nbsp; CLICK · DETAIL</div>
      <div>PLANET DRAG · CHANGE ORBIT</div>
    </div>
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
  totalCount?: number;
}

export function SolarSystem(props: SolarSystemProps) {
  const { memories, totalCount } = props;

  return (
    <div
      className="absolute inset-0"
      style={{ background: '#020810' }}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [0, 10, 22], fov: 52, near: 0.1, far: 250 }}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
          onCreated={({ scene }) => {
            scene.background = new THREE.Color('#020810');
            scene.fog = new THREE.FogExp2('#020810', 0.008);
          }}
        >
          <Suspense fallback={null}>
            <Scene {...props} />
          </Suspense>
        </Canvas>
      </CanvasErrorBoundary>

      {/* HUD overlays */}
      <HUDPlanetCount memories={memories} totalCount={totalCount} />
      <HUDLegend />
      <HUDControlsHint />
    </div>
  );
}
