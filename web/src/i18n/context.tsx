import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import en, { type Translations } from './en';
import ko from './ko';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Language = 'en' | 'ko';

interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
  /** Format a date string or timestamp as a relative time string (e.g. "3m ago" / "3분 전") */
  formatRelative: (iso: string | number | null | undefined) => string;
}

// ---------------------------------------------------------------------------
// Translations map
// ---------------------------------------------------------------------------

const translations: Record<Language, Translations> = { en, ko };

// ---------------------------------------------------------------------------
// Detect language from browser / localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'stellar-lang';

function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'ko') return stored;
  } catch {
    // localStorage unavailable (SSR, privacy mode, etc.)
  }
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('ko')) return 'ko';
  return 'en';
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const LanguageContext = createContext<LanguageContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectLanguage);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const t = translations[lang];

  const formatRelative = useCallback(
    (iso: string | number | null | undefined): string => {
      if (iso == null) return t.time.never;
      const ts = typeof iso === 'number' ? iso : new Date(iso).getTime();
      if (Number.isNaN(ts)) return t.time.never;
      const diff = Date.now() - ts;
      const sec = Math.floor(diff / 1000);
      if (sec < 60) return t.time.secondsAgo(sec);
      const min = Math.floor(sec / 60);
      if (min < 60) return t.time.minutesAgo(min);
      const hr = Math.floor(min / 60);
      if (hr < 24) return t.time.hoursAgo(hr);
      return t.time.daysAgo(Math.floor(hr / 24));
    },
    [t],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t, formatRelative }),
    [lang, setLang, t, formatRelative],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useTranslation must be used within <LanguageProvider>');
  return ctx;
}
