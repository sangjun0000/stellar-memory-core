import { useState, useEffect, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  speed: number;
  angle: number;
}

interface OrbitalRing {
  a: number;         // semi-major axis
  b: number;         // semi-minor axis
  tilt: number;      // rotation angle of ellipse
  tiltZ: number;     // z-axis tilt (3D projection factor)
  speed: number;     // angular speed
  offset: number;    // phase offset
  color: string;
  glowColor: string;
  particleCount: number;
  dotSize: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NPM_PACKAGE = 'https://www.npmjs.com/package/stellar-memory';
const INSTALL_CMD = 'npx stellar-memory init';

const FEATURES = [
  {
    icon: '⬡',
    color: '#60a5fa',
    glow: 'rgba(59,130,246,0.35)',
    title: 'Natural Forgetting',
    description:
      'Important memories stay close. Stale ones gradually drift away — just like real human memory. No manual cleanup needed.',
  },
  {
    icon: '◎',
    color: '#a78bfa',
    glow: 'rgba(139,92,246,0.35)',
    title: 'Smart Search',
    description:
      'Find memories by meaning, not just keywords. Ask naturally and get the most relevant results — all processed locally on your machine.',
  },
  {
    icon: '☀',
    color: '#fbbf24',
    glow: 'rgba(251,191,36,0.35)',
    title: 'Visual Dashboard',
    description:
      'See your memories as orbiting planets in an interactive 3D solar system. Drag them closer or let them drift — you\'re in control.',
  },
  {
    icon: '⬡',
    color: '#34d399',
    glow: 'rgba(52,211,153,0.35)',
    title: 'Multi-Project',
    description:
      'Each project has its own memory space. Share common preferences across all projects, or keep everything isolated.',
  },
] as const;

const STATS = [
  { value: '100%', label: 'Local' },
  { value: '0', label: 'API keys' },
  { value: '18', label: 'MCP tools' },
  { value: '<1ms', label: 'Recall speed' },
] as const;

const COMPARISONS = [
  {
    label: 'Context retained across sessions',
    without: { value: 0, display: '0%' },
    withSTM: { value: 95, display: '95%' },
  },
  {
    label: 'Repeated instructions per week',
    without: { value: 85, display: '~15x' },
    withSTM: { value: 12, display: '~2x' },
  },
  {
    label: 'Time to first useful response',
    without: { value: 75, display: '~3 min' },
    withSTM: { value: 8, display: '~10 sec' },
  },
  {
    label: 'Decision consistency',
    without: { value: 40, display: '~40%' },
    withSTM: { value: 92, display: '92%' },
  },
] as const;

// ─── Orbital rings definition ─────────────────────────────────────────────────

const ORBITAL_RINGS: OrbitalRing[] = [
  {
    a: 180, b: 55, tilt: 0.3, tiltZ: 0.55,
    speed: 0.00035, offset: 0,
    color: '#34d399', glowColor: 'rgba(52,211,153,0.8)',
    particleCount: 100, dotSize: 2.2,
  },
  {
    a: 160, b: 45, tilt: 2.1, tiltZ: 0.4,
    speed: 0.00048, offset: Math.PI * 0.7,
    color: '#f59e0b', glowColor: 'rgba(245,158,11,0.8)',
    particleCount: 90, dotSize: 2.0,
  },
  {
    a: 200, b: 60, tilt: 1.2, tiltZ: 0.65,
    speed: 0.00028, offset: Math.PI * 1.3,
    color: '#c084fc', glowColor: 'rgba(192,132,252,0.8)',
    particleCount: 110, dotSize: 2.4,
  },
  {
    a: 140, b: 38, tilt: 3.5, tiltZ: 0.3,
    speed: 0.00060, offset: Math.PI * 0.4,
    color: '#22d3ee', glowColor: 'rgba(34,211,238,0.8)',
    particleCount: 80, dotSize: 1.8,
  },
];

// ─── StarField ────────────────────────────────────────────────────────────────

function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef  = useRef<Star[]>([]);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    starsRef.current = Array.from({ length: 220 }, () => ({
      x:       Math.random() * window.innerWidth,
      y:       Math.random() * window.innerHeight,
      r:       Math.random() * 1.1 + 0.2,
      opacity: Math.random() * 0.5 + 0.1,
      speed:   Math.random() * 0.012 + 0.004,
      angle:   Math.random() * Math.PI * 2,
    }));

    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      for (const s of starsRef.current) {
        const twinkle = Math.sin(frame * s.speed + s.angle) * 0.25 + 0.75;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.opacity * twinkle})`;
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      'fixed',
        inset:         0,
        zIndex:        0,
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── OrbitalAnimation ─────────────────────────────────────────────────────────

function OrbitalAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const timeRef   = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 460;
    canvas.width  = SIZE;
    canvas.height = SIZE;
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    const draw = (ts: number) => {
      timeRef.current = ts;
      ctx.clearRect(0, 0, SIZE, SIZE);

      for (const ring of ORBITAL_RINGS) {
        const { a, b, tilt, tiltZ, speed, offset, color, glowColor, particleCount, dotSize } = ring;

        // Draw faint ellipse guide line
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.scale(1, tiltZ);
        ctx.beginPath();
        ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
        ctx.strokeStyle = color.replace(')', ', 0.08)').replace('rgb', 'rgba').replace('#', 'rgba(').replace('rgba(', '');
        // Simpler: just use a semi-transparent stroke
        ctx.strokeStyle = `${color}14`;
        ctx.lineWidth   = 1 / tiltZ;
        ctx.stroke();
        ctx.restore();

        // Draw particles along the ellipse
        for (let i = 0; i < particleCount; i++) {
          const theta = (i / particleCount) * Math.PI * 2;
          const t     = theta + offset + ts * speed;

          // Parametric ellipse in 3D tilted projection
          const cosT  = Math.cos(t);
          const sinT  = Math.sin(t);
          const cosTilt = Math.cos(tilt);
          const sinTilt = Math.sin(tilt);

          const px = a * cosT * cosTilt - b * sinT * sinTilt;
          const py = (a * cosT * sinTilt + b * sinT * cosTilt) * tiltZ;

          const x = cx + px;
          const y = cy + py;

          // Depth-based opacity (simulate 3D — dots "behind" are dimmer)
          // y position as proxy for depth: lower y = closer to viewer
          const depthFactor = 0.4 + 0.6 * ((py / (b * tiltZ) + 1) / 2);
          const alpha = Math.max(0.15, depthFactor);

          // Vary size by depth slightly
          const sz = dotSize * (0.7 + 0.5 * depthFactor);

          ctx.save();
          ctx.shadowBlur  = 8;
          ctx.shadowColor = glowColor;
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
          ctx.restore();
        }
      }

      // Central glow (sun)
      const sunGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
      sunGrad.addColorStop(0,   'rgba(253,230,138,1)');
      sunGrad.addColorStop(0.4, 'rgba(251,191,36,0.9)');
      sunGrad.addColorStop(0.8, 'rgba(245,158,11,0.4)');
      sunGrad.addColorStop(1,   'rgba(217,119,6,0)');

      ctx.save();
      ctx.shadowBlur  = 40;
      ctx.shadowColor = 'rgba(251,191,36,0.7)';
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fillStyle = sunGrad;
      ctx.fill();
      ctx.restore();

      // Outer corona pulse
      const pulse = Math.sin(ts * 0.001) * 0.5 + 0.5;
      const coronaGrad = ctx.createRadialGradient(cx, cy, 14, cx, cy, 50);
      coronaGrad.addColorStop(0,   `rgba(251,191,36,${0.12 + pulse * 0.08})`);
      coronaGrad.addColorStop(1,   'rgba(251,191,36,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, 50, 0, Math.PI * 2);
      ctx.fillStyle = coronaGrad;
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      'absolute',
        top:           '50%',
        left:          '50%',
        transform:     'translate(-50%, -50%)',
        pointerEvents: 'none',
        opacity:       0.92,
      }}
    />
  );
}

// ─── CopyButton ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing
    }
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        flexShrink:   0,
        display:      'flex',
        alignItems:   'center',
        gap:          '6px',
        padding:      '6px 14px',
        borderRadius: '6px',
        border:       '1px solid rgba(96,165,250,0.3)',
        background:   copied ? 'rgba(52,211,153,0.12)' : 'rgba(59,130,246,0.1)',
        color:        copied ? '#34d399' : '#93c5fd',
        fontSize:     '12px',
        fontWeight:   600,
        cursor:       'pointer',
        transition:   'all 0.2s ease',
        whiteSpace:   'nowrap',
      }}
      aria-label="Copy install command"
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ─── ComparisonSection ───────────────────────────────────────────────────────

function ComparisonSection() {
  const [animated, setAnimated] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setAnimated(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="comparison"
      ref={sectionRef}
      style={{
        padding:  'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
        maxWidth: '900px',
        margin:   '0 auto',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '56px' }}>
        <p style={{
          fontSize:      '11px',
          fontWeight:    700,
          color:         '#60a5fa',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          marginBottom:  '12px',
        }}>
          Comparison
        </p>
        <h2 style={{
          fontSize:      'clamp(26px, 4vw, 40px)',
          fontWeight:    800,
          letterSpacing: '-0.02em',
          color:         '#f1f5f9',
          margin:        '0 0 14px',
        }}>
          Why Stellar Memory?
        </h2>
        <p style={{
          fontSize:   '15px',
          color:      '#64748b',
          lineHeight: 1.7,
          maxWidth:   '480px',
          margin:     '0 auto',
        }}>
          Without persistent memory, every session starts from zero. See the difference.
        </p>
      </div>

      {/* Comparison card */}
      <div style={{
        background:     'rgba(255,255,255,0.025)',
        border:         '1px solid rgba(255,255,255,0.08)',
        borderRadius:   '16px',
        padding:        'clamp(24px, 4vw, 40px)',
        backdropFilter: 'blur(12px)',
      }}>
        {/* Legend */}
        <div style={{
          display:       'flex',
          gap:           '24px',
          marginBottom:  '36px',
          flexWrap:      'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width:        '12px',
              height:       '12px',
              borderRadius: '3px',
              background:   '#334155',
              flexShrink:   0,
            }} />
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Without STM</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width:        '12px',
              height:       '12px',
              borderRadius: '3px',
              background:   'linear-gradient(90deg, #3b82f6, #34d399)',
              flexShrink:   0,
            }} />
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>With Stellar Memory</span>
          </div>
        </div>

        {/* Metric rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {COMPARISONS.map((metric, i) => (
            <div key={i}>
              {/* Metric label */}
              <div style={{
                fontSize:     '12px',
                fontWeight:   600,
                color:        '#94a3b8',
                marginBottom: '10px',
                letterSpacing: '0.01em',
              }}>
                {metric.label}
              </div>

              {/* Bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {/* Without bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    flex:     1,
                    height:   '22px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: '4px',
                    overflow:  'hidden',
                    position:  'relative',
                  }}>
                    <div style={{
                      position:   'absolute',
                      top:        0,
                      left:       0,
                      height:     '100%',
                      width:      animated ? `${metric.without.value}%` : '0%',
                      background: '#334155',
                      borderRadius: '4px',
                      transition: `width 1s ease-out ${i * 150}ms`,
                      minWidth:   animated && metric.without.value === 0 ? '0px' : undefined,
                    }} />
                  </div>
                  <span style={{
                    fontSize:   '11px',
                    fontWeight: 600,
                    color:      '#475569',
                    minWidth:   '52px',
                    textAlign:  'right',
                  }}>
                    {animated ? metric.without.display : '—'}
                  </span>
                </div>

                {/* With STM bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    flex:       1,
                    height:     '22px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: '4px',
                    overflow:   'hidden',
                    position:   'relative',
                  }}>
                    <div style={{
                      position:   'absolute',
                      top:        0,
                      left:       0,
                      height:     '100%',
                      width:      animated ? `${metric.withSTM.value}%` : '0%',
                      background: 'linear-gradient(90deg, #3b82f6 0%, #34d399 100%)',
                      borderRadius: '4px',
                      transition: `width 1s ease-out ${i * 150 + 80}ms`,
                      boxShadow:  animated ? '0 0 12px rgba(59,130,246,0.35)' : 'none',
                    }} />
                  </div>
                  <span style={{
                    fontSize:   '11px',
                    fontWeight: 700,
                    color:      '#34d399',
                    minWidth:   '52px',
                    textAlign:  'right',
                  }}>
                    {animated ? metric.withSTM.display : '—'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Main LandingPage ─────────────────────────────────────────────────────────

export function LandingPage({ onNavigateDashboard }: { onNavigateDashboard: () => void }) {

  return (
    <div
      style={{
        minHeight:  '100vh',
        background: '#080a0f',
        color:      '#e2e8f0',
        fontFamily: "'Inter', system-ui, sans-serif",
        position:   'relative',
        overflowX:  'hidden',
      }}
    >
      {/* Animated star background */}
      <StarField />

      {/* Ambient gradient overlays */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{
          position:     'absolute',
          top:          '-10%',
          left:         '50%',
          transform:    'translateX(-50%)',
          width:        '90vw',
          height:       '70vw',
          background:   'radial-gradient(ellipse at center, rgba(34,211,238,0.04) 0%, rgba(139,92,246,0.03) 40%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position:   'absolute',
          bottom:     0,
          left:       0,
          right:      0,
          height:     '200px',
          background: 'linear-gradient(to top, #080a0f, transparent)',
        }} />
      </div>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position:       'fixed',
        top:            0,
        left:           0,
        right:          0,
        zIndex:         100,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 clamp(20px, 5vw, 64px)',
        height:         '64px',
        background:     'rgba(8,10,15,0.75)',
        borderBottom:   '1px solid rgba(255,255,255,0.05)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width:        '30px',
            height:       '30px',
            borderRadius: '50%',
            background:   'radial-gradient(circle at 35% 35%, #fde68a 0%, #fbbf24 40%, #d97706 100%)',
            boxShadow:    '0 0 10px rgba(251,191,36,0.55), 0 0 20px rgba(251,191,36,0.2)',
            flexShrink:   0,
          }} />
          <span style={{
            fontSize:      '15px',
            fontWeight:    700,
            color:         '#f1f5f9',
            letterSpacing: '-0.015em',
          }}>
            Stellar Memory
          </span>
        </div>

        {/* Center nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <a
            href={NPM_PACKAGE}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding:        '6px 16px',
              borderRadius:   '6px',
              color:          '#94a3b8',
              fontSize:       '13px',
              fontWeight:     500,
              textDecoration: 'none',
              transition:     'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#e2e8f0';
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#94a3b8';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            npm
          </a>
          <a
            href="#install"
            style={{
              padding:        '6px 16px',
              borderRadius:   '6px',
              color:          '#94a3b8',
              fontSize:       '13px',
              fontWeight:     500,
              textDecoration: 'none',
              transition:     'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#e2e8f0';
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = '#94a3b8';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            Install
          </a>
        </div>

        {/* Right CTA — white pill like reference */}
        <button
          onClick={onNavigateDashboard}
          style={{
            padding:      '8px 20px',
            borderRadius: '999px',
            border:       'none',
            background:   '#ffffff',
            color:        '#0a0a0a',
            fontSize:     '13px',
            fontWeight:   700,
            cursor:       'pointer',
            transition:   'all 0.15s ease',
            letterSpacing: '-0.01em',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#e2e8f0';
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#ffffff';
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
          }}
        >
          Dashboard
        </button>
      </nav>

      {/* ── CONTENT ── */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ─ HERO ──────────────────────────────────────────────────────────── */}
        <section style={{
          minHeight:      '100vh',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          textAlign:      'center',
          padding:        'clamp(100px, 12vh, 160px) clamp(20px, 5vw, 60px) clamp(60px, 8vh, 100px)',
          position:       'relative',
        }}>
          {/* Orbital animation — centered, behind text */}
          <div style={{
            position:      'absolute',
            top:           '50%',
            left:          '50%',
            transform:     'translate(-50%, -50%)',
            width:         '460px',
            height:        '460px',
            pointerEvents: 'none',
            zIndex:        0,
          }}>
            <OrbitalAnimation />
          </div>

          {/* Hero text — on top of animation */}
          <div style={{ position: 'relative', zIndex: 2 }}>
            {/* Pre-headline badge */}
            <div style={{
              display:        'inline-flex',
              alignItems:     'center',
              gap:            '6px',
              padding:        '5px 14px',
              borderRadius:   '999px',
              border:         '1px solid rgba(251,191,36,0.25)',
              background:     'rgba(251,191,36,0.06)',
              marginBottom:   '32px',
              fontSize:       '11px',
              fontWeight:     700,
              color:          '#fbbf24',
              letterSpacing:  '0.12em',
              textTransform:  'uppercase',
            }}>
              <span style={{
                width:        '5px',
                height:       '5px',
                borderRadius: '50%',
                background:   '#fbbf24',
                boxShadow:    '0 0 6px rgba(251,191,36,0.8)',
                display:      'inline-block',
              }} />
              Claude Code & Desktop · Fully local · Zero API keys
            </div>

            {/* Main headline — three-word bold pattern */}
            <h1 style={{
              fontSize:      'clamp(52px, 8vw, 96px)',
              fontWeight:    900,
              lineHeight:    1.0,
              letterSpacing: '-0.04em',
              marginBottom:  '28px',
              color:         '#ffffff',
            }}>
              <span style={{ display: 'block' }}>Remember.</span>
              <span style={{
                display:              'block',
                background:           'linear-gradient(135deg, #34d399 0%, #22d3ee 50%, #818cf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor:  'transparent',
                backgroundClip:       'text',
              }}>
                Recall.
              </span>
              <span style={{ display: 'block' }}>Evolve.</span>
            </h1>

            {/* Subtitle */}
            <p style={{
              fontSize:     'clamp(15px, 2vw, 18px)',
              color:        '#64748b',
              maxWidth:     '480px',
              lineHeight:   1.7,
              marginBottom: '44px',
              margin:       '0 auto 44px',
            }}>
              Persistent memory for AI assistants using orbital mechanics.
              Important memories stay close. Forgotten ones drift away.
            </p>

            {/* CTA row */}
            <div style={{
              display:        'flex',
              flexWrap:       'wrap',
              gap:            '12px',
              justifyContent: 'center',
              marginBottom:   '72px',
            }}>
              {/* Primary: white pill — matches reference "Explore Our Work" */}
              <a
                href="#install"
                style={{
                  display:        'inline-flex',
                  alignItems:     'center',
                  gap:            '8px',
                  padding:        '14px 32px',
                  borderRadius:   '999px',
                  border:         'none',
                  background:     '#ffffff',
                  color:          '#0a0a0a',
                  fontSize:       '15px',
                  fontWeight:     700,
                  textDecoration: 'none',
                  transition:     'all 0.2s ease',
                  letterSpacing:  '-0.01em',
                  boxShadow:      '0 2px 20px rgba(255,255,255,0.15)',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.background   = '#f1f5f9';
                  el.style.transform    = 'translateY(-2px)';
                  el.style.boxShadow    = '0 6px 28px rgba(255,255,255,0.2)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.background   = '#ffffff';
                  el.style.transform    = 'none';
                  el.style.boxShadow    = '0 2px 20px rgba(255,255,255,0.15)';
                }}
              >
                Get Started
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </a>

              {/* Secondary: open dashboard */}
              <button
                onClick={onNavigateDashboard}
                style={{
                  display:      'inline-flex',
                  alignItems:   'center',
                  gap:          '8px',
                  padding:      '14px 28px',
                  borderRadius: '999px',
                  border:       '1px solid rgba(255,255,255,0.14)',
                  background:   'rgba(255,255,255,0.05)',
                  color:        '#e2e8f0',
                  fontSize:     '15px',
                  fontWeight:   600,
                  cursor:       'pointer',
                  transition:   'all 0.2s ease',
                  backdropFilter: 'blur(8px)',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.background   = 'rgba(255,255,255,0.1)';
                  el.style.borderColor  = 'rgba(255,255,255,0.24)';
                  el.style.transform    = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.background  = 'rgba(255,255,255,0.05)';
                  el.style.borderColor = 'rgba(255,255,255,0.14)';
                  el.style.transform   = 'none';
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
                </svg>
                Open Dashboard
              </button>
            </div>

            {/* Stats bar */}
            <div style={{
              display:        'flex',
              flexWrap:       'wrap',
              gap:            '0',
              background:     'rgba(255,255,255,0.025)',
              border:         '1px solid rgba(255,255,255,0.06)',
              borderRadius:   '14px',
              overflow:       'hidden',
              backdropFilter: 'blur(16px)',
            }}>
              {STATS.map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding:     '20px 36px',
                    textAlign:   'center',
                    borderRight: i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    minWidth:    '110px',
                  }}
                >
                  <div style={{
                    fontSize:      '22px',
                    fontWeight:    800,
                    color:         '#f1f5f9',
                    letterSpacing: '-0.02em',
                  }}>
                    {s.value}
                  </div>
                  <div style={{
                    fontSize:      '10px',
                    color:         '#475569',
                    marginTop:     '3px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontWeight:    600,
                  }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─ COMPARISON ────────────────────────────────────────────────────── */}
        <ComparisonSection />

        {/* ─ FEATURES ──────────────────────────────────────────────────────── */}
        <section style={{
          padding:  'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
          maxWidth: '1100px',
          margin:   '0 auto',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <p style={{
              fontSize:      '11px',
              fontWeight:    700,
              color:         '#60a5fa',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              marginBottom:  '12px',
            }}>
              What makes it different
            </p>
            <h2 style={{
              fontSize:      'clamp(26px, 4vw, 40px)',
              fontWeight:    800,
              letterSpacing: '-0.02em',
              color:         '#f1f5f9',
              margin:        0,
            }}>
              Memory with physics
            </h2>
          </div>

          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap:                 '20px',
          }}>
            {FEATURES.map((f, i) => (
              <FeatureCard key={i} feature={f} />
            ))}
          </div>
        </section>

        {/* ─ INSTALL ───────────────────────────────────────────────────────── */}
        <section
          id="install"
          style={{
            padding:   'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
            maxWidth:  '760px',
            margin:    '0 auto',
            textAlign: 'center',
          }}
        >
          <p style={{
            fontSize:      '11px',
            fontWeight:    700,
            color:         '#34d399',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginBottom:  '12px',
          }}>
            One-liner setup
          </p>
          <h2 style={{
            fontSize:      'clamp(26px, 4vw, 38px)',
            fontWeight:    800,
            letterSpacing: '-0.02em',
            color:         '#f1f5f9',
            margin:        '0 0 16px',
          }}>
            Up and running in seconds
          </h2>
          <p style={{ fontSize: '16px', color: '#64748b', lineHeight: 1.7, marginBottom: '16px' }}>
            One command sets up the MCP server, SQLite database, and downloads the embedding model.
            No API keys. No cloud account. No data leaves your machine.
          </p>

          {/* Prerequisite */}
          <p style={{
            fontSize:     '13px',
            color:        '#f59e0b',
            marginBottom: '36px',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            gap:          '6px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Requires Node.js 22 or higher
          </p>

          {/* Command boxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            {/* Claude Code */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', textAlign: 'left', letterSpacing: '0.05em' }}>
                Claude Code
              </div>
              <div style={{
                display:        'flex',
                alignItems:     'center',
                gap:            '12px',
                background:     'rgba(10,22,40,0.8)',
                border:         '1px solid rgba(96,165,250,0.2)',
                borderRadius:   '10px',
                padding:        '14px 18px',
                backdropFilter: 'blur(12px)',
                boxShadow:      '0 0 24px rgba(59,130,246,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
                textAlign:      'left',
              }}>
                <span style={{ color: '#34d399', fontFamily: 'monospace', fontSize: '12px', flexShrink: 0 }}>$</span>
                <code style={{
                  flex:          1,
                  fontFamily:    "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize:      'clamp(13px, 2vw, 16px)',
                  color:         '#e2e8f0',
                  letterSpacing: '-0.01em',
                }}>
                  {INSTALL_CMD}
                </code>
                <CopyButton text={INSTALL_CMD} />
              </div>
            </div>

            {/* Claude Desktop */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', textAlign: 'left', letterSpacing: '0.05em' }}>
                Claude Desktop
              </div>
              <div style={{
                display:        'flex',
                alignItems:     'center',
                gap:            '12px',
                background:     'rgba(10,22,40,0.8)',
                border:         '1px solid rgba(52,211,153,0.2)',
                borderRadius:   '10px',
                padding:        '14px 18px',
                backdropFilter: 'blur(12px)',
                boxShadow:      '0 0 24px rgba(52,211,153,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
                textAlign:      'left',
              }}>
                <span style={{ color: '#34d399', fontFamily: 'monospace', fontSize: '12px', flexShrink: 0 }}>$</span>
                <code style={{
                  flex:          1,
                  fontFamily:    "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize:      'clamp(13px, 2vw, 16px)',
                  color:         '#e2e8f0',
                  letterSpacing: '-0.01em',
                }}>
                  npx stellar-memory init --desktop
                </code>
                <CopyButton text="npx stellar-memory init --desktop" />
              </div>
            </div>
          </div>

          {/* Steps */}
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap:                 '16px',
            textAlign:           'left',
          }}>
            {[
              { step: '01', title: 'Run one command',      desc: 'Creates config, SQLite database, and downloads the embedding model (~90MB)' },
              { step: '02', title: 'Restart your client',   desc: 'Claude Code or Claude Desktop — both supported out of the box' },
              { step: '03', title: 'Start remembering',     desc: 'Claude automatically stores decisions, errors, and milestones across sessions' },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  padding:      '18px',
                  background:   'rgba(255,255,255,0.025)',
                  border:       '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '10px',
                }}
              >
                <div style={{
                  fontSize:     '10px',
                  fontWeight:   800,
                  color:        '#3b82f6',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                  fontFamily:   'monospace',
                }}>
                  {item.step}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '6px' }}>{item.title}</div>
                <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </section>


        {/* ─ FOOTER ────────────────────────────────────────────────────────── */}
        <footer style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          padding:   'clamp(32px, 5vw, 48px) clamp(20px, 5vw, 60px)',
          textAlign: 'center',
        }}>
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            '24px',
            flexWrap:       'wrap',
            marginBottom:   '20px',
          }}>
            <a
              href={NPM_PACKAGE}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#64748b'; }}
            >
              npm
            </a>
            <button
              onClick={onNavigateDashboard}
              style={{
                color:      '#64748b',
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                fontSize:   '13px',
                fontWeight: 500,
                padding:    0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#64748b'; }}
            >
              Dashboard
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#334155', margin: 0 }}>
            Stellar Memory v1.0 — Local-first AI memory. No cloud. No keys. Just physics.
          </p>
        </footer>
      </div>
    </div>
  );
}

// ─── FeatureCard ─────────────────────────────────────────────────────────────

function FeatureCard({ feature }: { feature: typeof FEATURES[number] }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:      '28px 24px',
        background:   hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.025)',
        border:       `1px solid ${hovered ? feature.color + '33' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '14px',
        transition:   'all 0.25s ease',
        transform:    hovered ? 'translateY(-3px)' : 'none',
        boxShadow:    hovered ? `0 8px 32px rgba(0,0,0,0.3), 0 0 20px ${feature.glow}` : '0 2px 12px rgba(0,0,0,0.2)',
        cursor:       'default',
      }}
    >
      <div style={{
        width:          '44px',
        height:         '44px',
        borderRadius:   '10px',
        background:     `${feature.color}18`,
        border:         `1px solid ${feature.color}33`,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       '20px',
        color:          feature.color,
        marginBottom:   '18px',
        flexShrink:     0,
      }}>
        {feature.icon}
      </div>

      <h3 style={{
        fontSize:      '15px',
        fontWeight:    700,
        color:         '#f1f5f9',
        margin:        '0 0 10px',
        letterSpacing: '-0.01em',
      }}>
        {feature.title}
      </h3>
      <p style={{
        fontSize:   '13px',
        color:      '#64748b',
        lineHeight: 1.7,
        margin:     0,
      }}>
        {feature.description}
      </p>
    </div>
  );
}
