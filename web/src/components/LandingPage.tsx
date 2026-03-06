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

// ─── Constants ───────────────────────────────────────────────────────────────

const GITHUB_RELEASES = 'https://github.com/sangjun0000/stellar-memory-core/releases/latest';
const GITHUB_REPO     = 'https://github.com/sangjun0000/stellar-memory-core';
const NPM_PACKAGE     = 'https://www.npmjs.com/package/stellar-memory';
const INSTALL_CMD     = 'npx stellar-memory init';

const FEATURES = [
  {
    icon: '⬡',
    color: '#60a5fa',
    glow: 'rgba(59,130,246,0.35)',
    title: 'Orbital Memory Decay',
    description:
      'Importance decays naturally. High-impact memories stay in tight orbit; forgotten ones drift to the Oort Cloud. Exponential decay with a 72-hour half-life mirrors real human forgetting curves.',
  },
  {
    icon: '◎',
    color: '#a78bfa',
    glow: 'rgba(139,92,246,0.35)',
    title: 'Hybrid Search',
    description:
      'FTS5 keyword search + sqlite-vec KNN vector search fused via Reciprocal Rank Fusion. Handles both exact matches and semantic understanding — all local, no API keys.',
  },
  {
    icon: '☀',
    color: '#fbbf24',
    glow: 'rgba(251,191,36,0.35)',
    title: '3D Solar System Dashboard',
    description:
      'React + Three.js renders your memories as orbiting planets. Watch decisions orbit close and stale knowledge drift away. Drag memories to manually adjust their orbital distance.',
  },
  {
    icon: '⬡',
    color: '#34d399',
    glow: 'rgba(52,211,153,0.35)',
    title: 'Multi-Project Isolation',
    description:
      'Each project is its own star system. Mark memories as "universal" to share them across all projects — like coding style preferences that apply everywhere.',
  },
] as const;

const STATS = [
  { value: '252', label: 'Tests' },
  { value: '100%', label: 'Local' },
  { value: '0.1 AU', label: 'Core orbit' },
  { value: '<1ms', label: 'Corona recall' },
] as const;

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

    // Generate stars
    starsRef.current = Array.from({ length: 200 }, () => ({
      x:       Math.random() * window.innerWidth,
      y:       Math.random() * window.innerHeight,
      r:       Math.random() * 1.2 + 0.2,
      opacity: Math.random() * 0.6 + 0.1,
      speed:   Math.random() * 0.015 + 0.005,
      angle:   Math.random() * Math.PI * 2,
    }));

    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      for (const s of starsRef.current) {
        // Gentle twinkle
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
        position:  'fixed',
        inset:     0,
        zIndex:    0,
        pointerEvents: 'none',
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
        flexShrink:      0,
        display:         'flex',
        alignItems:      'center',
        gap:             '6px',
        padding:         '6px 14px',
        borderRadius:    '6px',
        border:          '1px solid rgba(96,165,250,0.3)',
        background:      copied ? 'rgba(52,211,153,0.12)' : 'rgba(59,130,246,0.1)',
        color:           copied ? '#34d399' : '#93c5fd',
        fontSize:        '12px',
        fontWeight:      600,
        cursor:          'pointer',
        transition:      'all 0.2s ease',
        whiteSpace:      'nowrap',
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

// ─── Main LandingPage ─────────────────────────────────────────────────────────

export function LandingPage({ onNavigateDashboard }: { onNavigateDashboard: () => void }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    // Attempt to read version from npm registry (best-effort, no CORS issues for public packages)
    fetch('https://registry.npmjs.org/stellar-memory/latest')
      .then((r) => r.json())
      .then((d) => { if (d.version) setVersion(d.version); })
      .catch(() => {/* ignore */});
  }, []);

  return (
    <div
      style={{
        minHeight:   '100vh',
        background:  '#020408',
        color:       '#e2e8f0',
        fontFamily:  "'Inter', system-ui, sans-serif",
        position:    'relative',
        overflowX:   'hidden',
      }}
    >
      {/* Animated star background */}
      <StarField />

      {/* Gradient overlays */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        {/* Deep radial glow behind hero */}
        <div style={{
          position:   'absolute',
          top:        '-20%',
          left:       '50%',
          transform:  'translateX(-50%)',
          width:      '80vw',
          height:     '60vw',
          background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.06) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        {/* Bottom fade */}
        <div style={{
          position:   'absolute',
          bottom:     0,
          left:       0,
          right:      0,
          height:     '200px',
          background: 'linear-gradient(to top, #020408, transparent)',
        }} />
      </div>

      {/* ── NAV ── */}
      <nav style={{
        position:   'fixed',
        top:        0,
        left:       0,
        right:      0,
        zIndex:     100,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding:    '0 clamp(20px, 5vw, 60px)',
        height:     '60px',
        background: 'rgba(2,4,8,0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        backdropFilter: 'blur(16px)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width:        '28px',
            height:       '28px',
            borderRadius: '50%',
            background:   'radial-gradient(circle at 35% 35%, #fbbf24 0%, #f59e0b 40%, #d97706 100%)',
            boxShadow:    '0 0 12px rgba(251,191,36,0.5), 0 0 24px rgba(251,191,36,0.2)',
            flexShrink:   0,
          }} />
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
            Stellar Memory
          </span>
        </div>

        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '6px 14px', borderRadius: '6px', color: '#94a3b8', fontSize: '13px', textDecoration: 'none', fontWeight: 500 }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#e2e8f0'; (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; (e.target as HTMLElement).style.background = 'transparent'; }}
          >
            GitHub
          </a>
          <a
            href={NPM_PACKAGE}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '6px 14px', borderRadius: '6px', color: '#94a3b8', fontSize: '13px', textDecoration: 'none', fontWeight: 500 }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#e2e8f0'; (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; (e.target as HTMLElement).style.background = 'transparent'; }}
          >
            npm
          </a>
          <button
            onClick={onNavigateDashboard}
            style={{
              padding:      '6px 16px',
              borderRadius: '7px',
              border:       '1px solid rgba(96,165,250,0.35)',
              background:   'rgba(59,130,246,0.1)',
              color:        '#93c5fd',
              fontSize:     '13px',
              fontWeight:   600,
              cursor:       'pointer',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.2)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.1)'; }}
          >
            Dashboard
          </button>
        </div>
      </nav>

      {/* ── CONTENT ── */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ─ HERO ─ */}
        <section style={{
          minHeight:      '100vh',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          textAlign:      'center',
          padding:        'clamp(100px, 12vh, 160px) clamp(20px, 5vw, 60px) clamp(60px, 8vh, 100px)',
        }}>
          {/* Sun graphic */}
          <div style={{
            position:     'relative',
            width:        '90px',
            height:       '90px',
            marginBottom: '40px',
          }}>
            {/* Outer glow rings */}
            {[1.8, 1.5, 1.2].map((scale, i) => (
              <div
                key={i}
                style={{
                  position:     'absolute',
                  inset:        `${-(scale - 1) * 45}px`,
                  borderRadius: '50%',
                  background:   `radial-gradient(circle, rgba(251,191,36,${0.03 - i * 0.01}) 0%, transparent 70%)`,
                  animation:    `pulse-soft ${3 + i * 0.5}s ease-in-out infinite`,
                  animationDelay: `${i * 0.4}s`,
                }}
              />
            ))}
            {/* Orbit ring */}
            <div style={{
              position:     'absolute',
              inset:        '-32px',
              borderRadius: '50%',
              border:       '1px solid rgba(251,191,36,0.15)',
            }} />
            {/* Core sun */}
            <div style={{
              position:     'absolute',
              inset:        0,
              borderRadius: '50%',
              background:   'radial-gradient(circle at 35% 35%, #fde68a 0%, #fbbf24 40%, #f59e0b 70%, #d97706 100%)',
              boxShadow:    '0 0 24px rgba(251,191,36,0.7), 0 0 60px rgba(251,191,36,0.3), 0 0 100px rgba(251,191,36,0.1)',
              animation:    'glow 2.4s ease-in-out infinite',
            }} />
            {/* Orbiting planet */}
            <div style={{
              position:  'absolute',
              top:       '50%',
              left:      '50%',
              width:     '122px',
              height:    '122px',
              marginTop: '-61px',
              marginLeft: '-61px',
              animation: 'spin 8s linear infinite',
            }}>
              <div style={{
                position:     'absolute',
                top:          '-5px',
                left:         '50%',
                transform:    'translateX(-50%)',
                width:        '10px',
                height:       '10px',
                borderRadius: '50%',
                background:   'radial-gradient(circle at 35% 35%, #93c5fd, #3b82f6)',
                boxShadow:    '0 0 6px rgba(59,130,246,0.6)',
              }} />
            </div>
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize:     'clamp(36px, 6vw, 72px)',
            fontWeight:   800,
            lineHeight:   1.08,
            letterSpacing: '-0.03em',
            marginBottom: '20px',
            background:   'linear-gradient(135deg, #f1f5f9 0%, #93c5fd 50%, #c4b5fd 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            maxWidth:     '800px',
          }}>
            AI memory that orbits<br />like planets
          </h1>

          {/* Subheadline */}
          <p style={{
            fontSize:     'clamp(16px, 2.2vw, 20px)',
            color:        '#94a3b8',
            maxWidth:     '560px',
            lineHeight:   1.65,
            marginBottom: '48px',
          }}>
            Persistent memory for AI assistants using orbital mechanics.
            Important memories stay close. Forgotten ones drift away. Fully local, MCP-native, open source.
          </p>

          {/* CTA buttons */}
          <div style={{
            display:    'flex',
            flexWrap:   'wrap',
            gap:        '12px',
            justifyContent: 'center',
            marginBottom: '64px',
          }}>
            {/* Primary: Get Started */}
            <a
              href="#install"
              style={{
                display:      'inline-flex',
                alignItems:   'center',
                gap:          '8px',
                padding:      '13px 28px',
                borderRadius: '9px',
                background:   'linear-gradient(135deg, #3b82f6, #2563eb)',
                color:        '#fff',
                fontSize:     '15px',
                fontWeight:   700,
                textDecoration: 'none',
                boxShadow:    '0 0 24px rgba(59,130,246,0.4), 0 4px 12px rgba(0,0,0,0.3)',
                transition:   'all 0.2s ease',
              }}
              onMouseEnter={(e) => { const el = e.currentTarget; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 0 32px rgba(59,130,246,0.55), 0 8px 20px rgba(0,0,0,0.35)'; }}
              onMouseLeave={(e) => { const el = e.currentTarget; el.style.transform = 'none'; el.style.boxShadow = '0 0 24px rgba(59,130,246,0.4), 0 4px 12px rgba(0,0,0,0.3)'; }}
            >
              Get Started
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </a>

            {/* Secondary: Download App */}
            <a
              href={GITHUB_RELEASES}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:      'inline-flex',
                alignItems:   'center',
                gap:          '8px',
                padding:      '13px 28px',
                borderRadius: '9px',
                border:       '1px solid rgba(255,255,255,0.12)',
                background:   'rgba(255,255,255,0.05)',
                color:        '#e2e8f0',
                fontSize:     '15px',
                fontWeight:   600,
                textDecoration: 'none',
                backdropFilter: 'blur(8px)',
                transition:   'all 0.2s ease',
              }}
              onMouseEnter={(e) => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.09)'; el.style.borderColor = 'rgba(255,255,255,0.2)'; el.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={(e) => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.05)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.transform = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download .exe
            </a>

            {/* Tertiary: Dashboard */}
            <button
              onClick={onNavigateDashboard}
              style={{
                display:      'inline-flex',
                alignItems:   'center',
                gap:          '8px',
                padding:      '13px 28px',
                borderRadius: '9px',
                border:       '1px solid rgba(167,139,250,0.25)',
                background:   'rgba(139,92,246,0.08)',
                color:        '#c4b5fd',
                fontSize:     '15px',
                fontWeight:   600,
                cursor:       'pointer',
                transition:   'all 0.2s ease',
              }}
              onMouseEnter={(e) => { const el = e.currentTarget; el.style.background = 'rgba(139,92,246,0.15)'; el.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={(e) => { const el = e.currentTarget; el.style.background = 'rgba(139,92,246,0.08)'; el.style.transform = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              Open Dashboard
            </button>
          </div>

          {/* Stats bar */}
          <div style={{
            display:    'flex',
            flexWrap:   'wrap',
            gap:        '0',
            background: 'rgba(255,255,255,0.03)',
            border:     '1px solid rgba(255,255,255,0.07)',
            borderRadius: '12px',
            overflow:   'hidden',
            backdropFilter: 'blur(12px)',
          }}>
            {STATS.map((s, i) => (
              <div
                key={i}
                style={{
                  padding:       '18px 32px',
                  textAlign:     'center',
                  borderRight:   i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  minWidth:      '100px',
                }}
              >
                <div style={{ fontSize: '22px', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                  {s.value}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─ FEATURES ─ */}
        <section style={{
          padding:   'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
          maxWidth:  '1100px',
          margin:    '0 auto',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: '#60a5fa', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '12px' }}>
              What makes it different
            </p>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-0.02em', color: '#f1f5f9', margin: 0 }}>
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

        {/* ─ INSTALL ─ */}
        <section
          id="install"
          style={{
            padding:   'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
            maxWidth:  '760px',
            margin:    '0 auto',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#34d399', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '12px' }}>
            One-liner setup
          </p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', color: '#f1f5f9', margin: '0 0 16px' }}>
            Up and running in seconds
          </h2>
          <p style={{ fontSize: '16px', color: '#64748b', lineHeight: 1.7, marginBottom: '40px' }}>
            One command sets up the MCP server, SQLite database, and downloads the embedding model.
            No API keys. No cloud account. No data leaves your machine.
          </p>

          {/* Command box */}
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
            marginBottom:   '32px',
            textAlign:      'left',
          }}>
            <span style={{ color: '#34d399', fontFamily: 'monospace', fontSize: '12px', flexShrink: 0 }}>$</span>
            <code style={{
              flex:       1,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize:   'clamp(13px, 2vw, 16px)',
              color:      '#e2e8f0',
              letterSpacing: '-0.01em',
            }}>
              {INSTALL_CMD}
            </code>
            <CopyButton text={INSTALL_CMD} />
          </div>

          {/* Steps */}
          <div style={{
            display:   'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap:       '16px',
            textAlign: 'left',
          }}>
            {[
              { step: '01', title: 'Init project', desc: 'Creates config and SQLite database in ~/.stellar-memory' },
              { step: '02', title: 'Claude integration', desc: 'Add to claude_desktop_config.json or use with Claude Code' },
              { step: '03', title: 'Start remembering', desc: 'Claude automatically stores decisions, errors, and milestones' },
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
                <div style={{ fontSize: '10px', fontWeight: 800, color: '#3b82f6', letterSpacing: '0.1em', marginBottom: '8px', fontFamily: 'monospace' }}>
                  {item.step}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '6px' }}>{item.title}</div>
                <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ─ DOWNLOAD ─ */}
        <section style={{
          padding:  'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
          maxWidth: '760px',
          margin:   '0 auto',
        }}>
          <div
            style={{
              background:     'rgba(10,22,40,0.72)',
              border:         '1px solid rgba(255,255,255,0.08)',
              borderRadius:   '16px',
              padding:        'clamp(32px, 5vw, 56px)',
              backdropFilter: 'blur(20px)',
              boxShadow:      '0 4px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
              textAlign:      'center',
            }}
          >
            {/* Windows logo */}
            <div style={{ fontSize: '40px', marginBottom: '20px', lineHeight: 1 }}>⊞</div>
            <h2 style={{ fontSize: 'clamp(22px, 3.5vw, 32px)', fontWeight: 800, letterSpacing: '-0.02em', color: '#f1f5f9', margin: '0 0 10px' }}>
              Desktop App for Windows
            </h2>
            <p style={{ fontSize: '15px', color: '#64748b', marginBottom: '28px', lineHeight: 1.6 }}>
              One-click installer. Electron app with embedded REST API, background daemon, and solar system dashboard.
            </p>

            {/* Version badge */}
            {version && (
              <div style={{ marginBottom: '20px' }}>
                <span style={{
                  display:      'inline-block',
                  padding:      '3px 12px',
                  borderRadius: '999px',
                  fontSize:     '11px',
                  fontWeight:   700,
                  background:   'rgba(52,211,153,0.1)',
                  border:       '1px solid rgba(52,211,153,0.25)',
                  color:        '#34d399',
                  letterSpacing: '0.05em',
                }}>
                  v{version}
                </span>
              </div>
            )}

            {/* Download button */}
            <a
              href={GITHUB_RELEASES}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:        'inline-flex',
                alignItems:     'center',
                gap:            '10px',
                padding:        '14px 32px',
                borderRadius:   '10px',
                background:     'linear-gradient(135deg, #3b82f6, #2563eb)',
                color:          '#fff',
                fontSize:       '15px',
                fontWeight:     700,
                textDecoration: 'none',
                boxShadow:      '0 0 24px rgba(59,130,246,0.4), 0 4px 12px rgba(0,0,0,0.3)',
                marginBottom:   '24px',
                transition:     'all 0.2s ease',
              }}
              onMouseEnter={(e) => { const el = e.currentTarget; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 0 32px rgba(59,130,246,0.55), 0 8px 20px rgba(0,0,0,0.35)'; }}
              onMouseLeave={(e) => { const el = e.currentTarget; el.style.transform = 'none'; el.style.boxShadow = '0 0 24px rgba(59,130,246,0.4), 0 4px 12px rgba(0,0,0,0.3)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download for Windows
            </a>

            <div style={{ fontSize: '13px', color: '#475569' }}>
              Or install via npm —{' '}
              <code style={{
                fontFamily:   'monospace',
                fontSize:     '12px',
                color:        '#93c5fd',
                background:   'rgba(59,130,246,0.08)',
                padding:      '2px 8px',
                borderRadius: '4px',
              }}>
                npm install -g stellar-memory
              </code>
            </div>
          </div>
        </section>

        {/* ─ HOW IT WORKS ─ */}
        <section style={{
          padding:   'clamp(60px, 8vw, 100px) clamp(20px, 5vw, 60px)',
          maxWidth:  '900px',
          margin:    '0 auto',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '12px' }}>
            The model
          </p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', color: '#f1f5f9', margin: '0 0 48px' }}>
            Importance as orbital distance
          </h2>

          {/* Formula */}
          <div style={{
            background:     'rgba(10,22,40,0.8)',
            border:         '1px solid rgba(167,139,250,0.2)',
            borderRadius:   '12px',
            padding:        '28px 32px',
            marginBottom:   '40px',
            backdropFilter: 'blur(12px)',
            boxShadow:      '0 0 32px rgba(139,92,246,0.08)',
          }}>
            <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '14px' }}>
              Importance Formula
            </div>
            <code style={{
              display:       'block',
              fontFamily:    "'JetBrains Mono', 'Fira Code', monospace",
              fontSize:      'clamp(12px, 1.8vw, 15px)',
              color:         '#e2e8f0',
              lineHeight:    1.8,
              letterSpacing: '-0.01em',
              whiteSpace:    'pre-wrap',
              wordBreak:     'break-all',
            }}>
              {'importance = 0.30 × recency\n             + 0.20 × frequency\n             + 0.30 × impact\n             + 0.20 × relevance'}
            </code>
          </div>

          {/* Zone table */}
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap:                 '12px',
            textAlign:           'left',
          }}>
            {[
              { zone: 'Core',     au: '0.1–1 AU',    color: '#fbbf24', desc: 'Instant recall' },
              { zone: 'Near',     au: '1–5 AU',      color: '#60a5fa', desc: 'Recently accessed' },
              { zone: 'Active',   au: '5–15 AU',     color: '#34d399', desc: 'In-context' },
              { zone: 'Archive',  au: '15–40 AU',    color: '#94a3b8', desc: 'Older knowledge' },
              { zone: 'Fading',   au: '40–70 AU',    color: '#64748b', desc: 'Losing relevance' },
              { zone: 'Oort',     au: '70–100 AU',   color: '#334155', desc: 'Soft-deleted' },
            ].map((z) => (
              <div
                key={z.zone}
                style={{
                  padding:      '14px',
                  background:   'rgba(255,255,255,0.025)',
                  border:       `1px solid ${z.color}22`,
                  borderLeft:   `3px solid ${z.color}`,
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: z.color, marginBottom: '2px' }}>{z.zone}</div>
                <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{z.au}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>{z.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ─ FOOTER ─ */}
        <footer style={{
          borderTop:   '1px solid rgba(255,255,255,0.05)',
          padding:     'clamp(32px, 5vw, 48px) clamp(20px, 5vw, 60px)',
          textAlign:   'center',
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
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#64748b'; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
            <a
              href={NPM_PACKAGE}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#64748b'; }}
            >
              npm
            </a>
            <a
              href={`${GITHUB_REPO}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#64748b'; }}
            >
              MIT License
            </a>
            <button
              onClick={onNavigateDashboard}
              style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500, padding: 0 }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#64748b'; }}
            >
              Dashboard
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#334155', margin: 0 }}>
            Stellar Memory — Local-first AI memory. No cloud. No keys. Just physics.
          </p>
        </footer>
      </div>

      {/* Keyframe for orbit spin */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
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
      {/* Icon */}
      <div style={{
        width:        '44px',
        height:       '44px',
        borderRadius: '10px',
        background:   `${feature.color}18`,
        border:       `1px solid ${feature.color}33`,
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        fontSize:     '20px',
        color:        feature.color,
        marginBottom: '18px',
        flexShrink:   0,
      }}>
        {feature.icon}
      </div>

      <h3 style={{
        fontSize:     '15px',
        fontWeight:   700,
        color:        '#f1f5f9',
        margin:       '0 0 10px',
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
