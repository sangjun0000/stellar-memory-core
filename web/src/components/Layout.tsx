import { useState, type ReactNode } from 'react';
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
    <div
      role="group"
      aria-label={lang === 'en' ? 'Language selector' : '언어 선택'}
      style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      {options.map((l) => {
        const isActive = lang === l;
        return (
          <button
            key={l}
            onClick={() => setLang(l)}
            aria-pressed={isActive}
            aria-label={l === 'en' ? 'English' : '한국어'}
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
              minHeight: '28px',
            }}
          >
            {t.language[l]}
          </button>
        );
      })}
    </div>
  );
}

// Mobile panel tabs: sidebar | main | detail
type MobileTab = 'sidebar' | 'main' | 'detail';

export function Layout({ sidebar, main, detail }: LayoutProps) {
  const { t } = useTranslation();
  const [mobileTab, setMobileTab] = useState<MobileTab>('main');

  // When detail becomes available, switch to it on mobile
  const activeTab: MobileTab = detail && mobileTab === 'detail' ? 'detail' : mobileTab;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#020408' }}>
      {/* ── Top bar ── */}
      <header
        className="flex-shrink-0 flex items-center px-3 sm:px-5 gap-2 sm:gap-4"
        role="banner"
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
          <span
            aria-hidden="true"
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

        {/* Separator + subtitle — hidden on small screens */}
        <div className="hidden sm:block" style={{ width: '1px', height: '16px', background: 'rgba(75,85,99,0.6)' }} />
        <span
          className="hidden sm:block text-xs tracking-wider"
          style={{ color: 'rgba(148,163,184,0.5)', letterSpacing: '0.12em' }}
        >
          {t.layout.subtitle}
        </span>

        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LanguageToggle />
          <div className="hidden sm:block" style={{ width: '1px', height: '14px', background: 'rgba(75,85,99,0.4)' }} />
          <div className="flex items-center gap-1.5 sm:gap-2" aria-label={t.layout.online} title={t.layout.online}>
            <span
              aria-hidden="true"
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px rgba(34,197,94,0.8)',
                animation: 'statusPulse 2s ease-in-out infinite',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span
              className="hidden sm:inline text-xs"
              style={{ color: 'rgba(148,163,184,0.4)', fontSize: '10px', letterSpacing: '0.08em' }}
            >
              {t.layout.online}
            </span>
          </div>
        </div>
      </header>

      {/* ── Mobile tab bar (< md) ── */}
      <nav
        className="flex md:hidden flex-shrink-0"
        aria-label="Panel navigation"
        style={{
          borderBottom: '1px solid rgba(96,165,250,0.12)',
          background: 'rgba(5,10,20,0.95)',
        }}
      >
        {(['sidebar', 'main', 'detail'] as MobileTab[]).map((tab) => {
          // Hide "detail" tab when there's no detail panel
          if (tab === 'detail' && !detail) return null;
          const isActive = activeTab === tab;
          const labels: Record<MobileTab, string> = {
            sidebar: t.sidebar.project,
            main: t.tabs.solar.label,
            detail: t.memoryDetail.close.length > 0 ? 'Detail' : 'Detail',
          };
          return (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              aria-selected={isActive}
              role="tab"
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: '11px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#93c5fd' : '#6b7280',
                background: isActive ? 'rgba(96,165,250,0.08)' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid #60a5fa' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                minHeight: '44px',
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </nav>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left sidebar ── desktop always visible, mobile controlled by tab ── */}
        <aside
          aria-label={t.sidebar.project}
          className={`flex-shrink-0 overflow-y-auto ${activeTab === 'sidebar' ? 'flex' : 'hidden'} md:flex flex-col`}
          style={{
            width: '232px',
            background: 'linear-gradient(180deg, #0a1628 0%, #050a14 100%)',
            borderRight: '1px solid rgba(96, 165, 250, 0.12)',
            boxShadow: '2px 0 20px rgba(0,0,0,0.4)',
            padding: '10px 8px',
            gap: '8px',
          }}
        >
          {sidebar}
        </aside>

        {/* ── Main canvas ── desktop always visible, mobile controlled by tab ── */}
        <main
          role="main"
          className={`flex-1 relative overflow-hidden ${activeTab === 'main' ? 'flex' : 'hidden'} md:flex flex-col`}
        >
          {main}
        </main>

        {/* ── Right detail panel ── desktop conditional, mobile controlled by tab ── */}
        {detail && (
          <aside
            aria-label="Memory detail"
            className={`flex-shrink-0 overflow-hidden ${activeTab === 'detail' ? 'flex' : 'hidden'} md:flex flex-col`}
            style={{
              width: '100%',
              maxWidth: '384px',
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
        /* Ensure detail panel on desktop has fixed width, not full width */
        @media (min-width: 768px) {
          aside[aria-label="Memory detail"] {
            width: 384px !important;
            max-width: 384px !important;
          }
        }
      `}</style>
    </div>
  );
}
