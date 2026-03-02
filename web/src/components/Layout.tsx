import type { ReactNode } from 'react';
import { useTranslation, type Language } from '../i18n/context';

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  detail: ReactNode | null;
}

function LanguageToggle() {
  const { lang, setLang, t } = useTranslation();
  const options: Language[] = ['en', 'ko'];

  return (
    <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
      {options.map((l) => {
        const isActive = lang === l;
        return (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              padding: '2px 8px',
              fontSize: '10px',
              fontWeight: isActive ? 700 : 400,
              letterSpacing: '0.05em',
              background: isActive ? 'rgba(96,165,250,0.15)' : 'transparent',
              color: isActive ? '#93c5fd' : '#4b5563',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {t.language[l]}
          </button>
        );
      })}
    </div>
  );
}

export function Layout({ sidebar, main, detail }: LayoutProps) {
  const { t } = useTranslation();

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#020408' }}>
      {/* ── Top bar ── */}
      <header
        className="flex-shrink-0 flex items-center px-5 gap-4"
        style={{
          height: '52px',
          background: 'linear-gradient(180deg, #0a1628 0%, #050a14 100%)',
          borderBottom: '1px solid rgba(96, 165, 250, 0.15)',
          boxShadow: '0 1px 0 rgba(96,165,250,0.08), 0 4px 20px rgba(0,0,0,0.6)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Brand lockup */}
        <div className="flex items-center gap-2.5">
          {/* Animated star */}
          <span
            className="text-yellow-400 select-none"
            style={{
              fontSize: '18px',
              display: 'inline-block',
              animation: 'stellarPulse 3s ease-in-out infinite',
              filter: 'drop-shadow(0 0 6px rgba(251,191,36,0.8))',
            }}
          >
            ★
          </span>
          <span
            className="font-semibold tracking-wide"
            style={{
              fontSize: '14px',
              background: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '0.06em',
            }}
          >
            {t.layout.brand}
          </span>
        </div>

        {/* Separator */}
        <div style={{ width: '1px', height: '16px', background: 'rgba(75,85,99,0.6)' }} />

        <span
          className="text-xs tracking-wider"
          style={{ color: 'rgba(148,163,184,0.5)', letterSpacing: '0.12em' }}
        >
          {t.layout.subtitle}
        </span>

        {/* Right-side status pip + language toggle */}
        <div className="ml-auto flex items-center gap-3">
          <LanguageToggle />
          <div style={{ width: '1px', height: '14px', background: 'rgba(75,85,99,0.4)' }} />
          <div className="flex items-center gap-2">
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px rgba(34,197,94,0.8)',
                animation: 'statusPulse 2s ease-in-out infinite',
                display: 'inline-block',
              }}
            />
            <span className="text-xs" style={{ color: 'rgba(148,163,184,0.4)', fontSize: '10px', letterSpacing: '0.08em' }}>
              {t.layout.online}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left sidebar ── */}
        <aside
          className="flex-shrink-0 overflow-y-auto"
          style={{
            width: '232px',
            background: 'linear-gradient(180deg, #0a1628 0%, #050a14 100%)',
            borderRight: '1px solid rgba(96, 165, 250, 0.12)',
            boxShadow: '2px 0 20px rgba(0,0,0,0.4)',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {sidebar}
        </aside>

        {/* ── Main canvas ── */}
        <main role="main" className="flex-1 relative overflow-hidden">{main}</main>

        {/* ── Right detail panel ── */}
        {detail && (
          <aside
            className="flex-shrink-0 overflow-hidden"
            style={{
              width: '384px',
              background: 'linear-gradient(180deg, #0a1628 0%, #050a14 100%)',
              borderLeft: '1px solid rgba(96, 165, 250, 0.12)',
              boxShadow: '-2px 0 20px rgba(0,0,0,0.4), -1px 0 0 rgba(96,165,250,0.06)',
            }}
          >
            {detail}
          </aside>
        )}
      </div>

      {/* ── Keyframe animations injected via a style tag ── */}
      <style>{`
        @keyframes stellarPulse {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 6px rgba(251,191,36,0.8)); }
          50%       { opacity: 0.7; filter: drop-shadow(0 0 12px rgba(251,191,36,1)) drop-shadow(0 0 20px rgba(251,191,36,0.4)); }
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(34,197,94,0.8); }
          50%       { opacity: 0.6; box-shadow: 0 0 4px rgba(34,197,94,0.4); }
        }
        @keyframes zoneBarSlide {
          from { width: 0%; }
        }
        @keyframes sourceCardIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dotActivePulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          50%       { box-shadow: 0 0 8px 2px currentColor; opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
