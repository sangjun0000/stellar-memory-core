import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { MemoryType, OrbitZone } from '../api/client';
import { useTranslation } from '../i18n/context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_TYPES: { value: MemoryType; label: string; color: string }[] = [
  { value: 'decision',    label: 'Decision',    color: '#2563eb' },
  { value: 'error',       label: 'Error',       color: '#dc2626' },
  { value: 'task',        label: 'Task',        color: '#16a34a' },
  { value: 'observation', label: 'Observation', color: '#6b7280' },
  { value: 'milestone',   label: 'Milestone',   color: '#eab308' },
  { value: 'context',     label: 'Context',     color: '#7c3aed' },
  { value: 'procedural',  label: 'Procedural',  color: '#0891b2' },
];

const ORBIT_ZONES: { value: OrbitZone; label: string; color: string }[] = [
  { value: 'core',      label: 'Core',      color: '#fbbf24' },
  { value: 'near',      label: 'Near',      color: '#f97316' },
  { value: 'active',    label: 'Active',    color: '#22c55e' },
  { value: 'archive',   label: 'Archive',   color: '#60a5fa' },
  { value: 'fading',    label: 'Fading',    color: '#a78bfa' },
  { value: 'forgotten', label: 'Forgotten', color: '#9ca3af' },
];

// ---------------------------------------------------------------------------
// CSS injection — once per page
// ---------------------------------------------------------------------------

const SEARCH_CSS = `
@keyframes sb-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
@keyframes sb-count-pop {
  0%   { transform: scale(0.8); opacity: 0; }
  60%  { transform: scale(1.1); }
  100% { transform: scale(1);   opacity: 1; }
}
@keyframes sb-glow-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96,165,250,0); }
  50%       { box-shadow: 0 0 16px 2px rgba(96,165,250,0.15); }
}
`;

function injectSearchCSS() {
  if (document.getElementById('sb-css')) return;
  const el = document.createElement('style');
  el.id = 'sb-css';
  el.textContent = SEARCH_CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SearchFilters {
  query: string;
  type?: MemoryType;
  zone?: OrbitZone;
}

interface SearchBarProps {
  onSearch:      (filters: SearchFilters) => void;
  isSearching:   boolean;
  resultCount?:  number;
}

// ---------------------------------------------------------------------------
// Premium select dropdown
// ---------------------------------------------------------------------------

function PremiumSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
}: {
  value:       T | '';
  onChange:    (v: T | '') => void;
  options:     { value: T; label: string; color: string }[];
  placeholder: string;
  ariaLabel:   string;
}) {
  const activeColor = options.find((o) => o.value === value)?.color;

  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | '')}
        aria-label={ariaLabel}
        style={{
          appearance:    'none',
          background:    activeColor
            ? `linear-gradient(135deg, ${activeColor}18, rgba(10,22,40,0.95))`
            : 'rgba(10,22,40,0.95)',
          border:        `1px solid ${activeColor ? activeColor + '55' : 'rgba(255,255,255,0.1)'}`,
          borderRadius:  '8px',
          color:         activeColor ?? '#9ca3af',
          fontSize:      '11px',
          padding:       '5px 28px 5px 10px',
          cursor:        'pointer',
          outline:       'none',
          boxShadow:     activeColor ? `0 0 10px ${activeColor}22` : 'none',
          transition:    'all 0.2s ease',
          minWidth:      '100px',
        }}
        onFocus={(e) => {
          const el = e.currentTarget as HTMLSelectElement;
          el.style.borderColor = activeColor ? `${activeColor}99` : 'rgba(96,165,250,0.5)';
          el.style.boxShadow   = `0 0 14px ${activeColor ?? '#60a5fa'}33`;
        }}
        onBlur={(e) => {
          const el = e.currentTarget as HTMLSelectElement;
          el.style.borderColor = activeColor ? `${activeColor}55` : 'rgba(255,255,255,0.1)';
          el.style.boxShadow   = activeColor ? `0 0 10px ${activeColor}22` : 'none';
        }}
      >
        <option value="" style={{ background: '#0a1628', color: '#9ca3af' }}>
          {placeholder}
        </option>
        {options.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            style={{ background: '#0a1628', color: opt.color }}
          >
            {opt.label}
          </option>
        ))}
      </select>

      {/* Custom chevron */}
      <span
        style={{
          position:       'absolute',
          right:          '8px',
          top:            '50%',
          transform:      'translateY(-50%)',
          pointerEvents:  'none',
          fontSize:       '8px',
          color:          activeColor ?? '#4b5563',
        }}
      >
        ▼
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchBar({ onSearch, isSearching, resultCount }: SearchBarProps) {
  injectSearchCSS();
  const { t } = useTranslation();

  const localizedTypes = useMemo(
    () => MEMORY_TYPES.map(mt => ({ ...mt, label: t.memoryTypes[mt.value] ?? mt.label })),
    [t],
  );
  const localizedZones = useMemo(
    () => ORBIT_ZONES.map(oz => ({ ...oz, label: t.zones[oz.value]?.name ?? oz.label })),
    [t],
  );

  const [query,     setQuery]   = useState('');
  const [type,      setType]    = useState<MemoryType | ''>('');
  const [zone,      setZone]    = useState<OrbitZone  | ''>('');
  const [focused,   setFocused] = useState(false);
  const [prevCount, setPrevCount] = useState<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Trigger count-pop animation key
  const [countKey, setCountKey] = useState(0);
  useEffect(() => {
    if (resultCount !== prevCount && resultCount !== undefined) {
      setCountKey((k) => k + 1);
      setPrevCount(resultCount);
    }
  }, [resultCount, prevCount]);

  const buildFilters = useCallback(
    (q: string, t: MemoryType | '', z: OrbitZone | ''): SearchFilters => ({
      query: q,
      type:  t || undefined,
      zone:  z || undefined,
    }),
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSearch(buildFilters(query.trim(), type, zone));
    },
    [query, type, zone, onSearch, buildFilters],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setType('');
    setZone('');
    onSearch({ query: '' });
    inputRef.current?.focus();
  }, [onSearch]);

  const handleFilterChange = useCallback(
    (newType: MemoryType | '', newZone: OrbitZone | '') => {
      if (query.trim() || newType || newZone) {
        onSearch(buildFilters(query.trim(), newType, newZone));
      }
    },
    [query, onSearch, buildFilters],
  );

  // Accent color for the focused input border — use type color if selected
  const typeColor = MEMORY_TYPES.find((t) => t.value === type)?.color ?? '#60a5fa';
  const focusBorderColor = focused ? `${typeColor}88` : 'rgba(255,255,255,0.1)';
  const focusGlow        = focused ? `0 0 18px ${typeColor}28, 0 0 0 1px ${typeColor}33` : 'none';

  const isDisabled = (!query.trim() && !type && !zone) || isSearching;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">

      {/* ── Query row ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">

        {/* Input wrapper */}
        <div style={{ position: 'relative', flex: 1 }}>
          {/* Search icon */}
          <span
            style={{
              position:      'absolute',
              left:          '10px',
              top:           '50%',
              transform:     'translateY(-50%)',
              fontSize:      '12px',
              color:         focused ? typeColor : '#4b5563',
              pointerEvents: 'none',
              transition:    'color 0.2s ease',
            }}
          >
            ⌕
          </span>

          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            style={{
              width:        '100%',
              background:   'rgba(5,10,20,0.9)',
              border:       `1px solid ${focusBorderColor}`,
              borderRadius: '10px',
              padding:      '7px 32px 7px 30px',
              fontSize:     '13px',
              color:        '#e5e7eb',
              outline:      'none',
              boxShadow:    focusGlow,
              transition:   'border-color 0.2s ease, box-shadow 0.2s ease',
              caretColor:   typeColor,
            }}
          />

          {/* Clear button */}
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={t.search.clear}
              style={{
                position:    'absolute',
                right:       '8px',
                top:         '50%',
                transform:   'translateY(-50%)',
                color:       '#4b5563',
                background:  'none',
                border:      'none',
                cursor:      'pointer',
                fontSize:    '13px',
                padding:     '2px',
                lineHeight:  1,
                transition:  'color 0.15s ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#e5e7eb'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Search button */}
        <button
          type="submit"
          disabled={isDisabled}
          style={{
            padding:      '7px 14px',
            fontSize:     '12px',
            fontWeight:   600,
            borderRadius: '10px',
            border:       isDisabled ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${typeColor}66`,
            background:   isDisabled
              ? 'rgba(255,255,255,0.04)'
              : `linear-gradient(135deg, ${typeColor}44, ${typeColor}22)`,
            color:        isDisabled ? '#4b5563' : typeColor,
            cursor:       isDisabled ? 'not-allowed' : 'pointer',
            boxShadow:    isDisabled ? 'none' : `0 0 14px ${typeColor}33`,
            transition:   'all 0.2s ease',
            whiteSpace:   'nowrap',
            letterSpacing: '0.03em',
          }}
          onMouseEnter={(e) => {
            if (isDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.background = `linear-gradient(135deg, ${typeColor}66, ${typeColor}33)`;
            el.style.boxShadow  = `0 0 20px ${typeColor}55`;
            el.style.transform  = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            if (isDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.background = `linear-gradient(135deg, ${typeColor}44, ${typeColor}22)`;
            el.style.boxShadow  = `0 0 14px ${typeColor}33`;
            el.style.transform  = '';
          }}
        >
          {isSearching ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span
                style={{
                  display:        'inline-block',
                  width:          '8px',
                  height:         '8px',
                  border:         `1.5px solid ${typeColor}44`,
                  borderTop:      `1.5px solid ${typeColor}`,
                  borderRadius:   '50%',
                  animation:      'spin 0.7s linear infinite',
                }}
              />
              {t.search.scanning}
            </span>
          ) : t.search.button}
        </button>
      </div>

      {/* ── Filter row ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">

        <PremiumSelect<MemoryType>
          value={type}
          onChange={(v) => { setType(v); handleFilterChange(v, zone); }}
          options={localizedTypes}
          placeholder={t.search.allTypes}
          ariaLabel={t.search.filterByType}
        />

        <PremiumSelect<OrbitZone>
          value={zone}
          onChange={(v) => { setZone(v); handleFilterChange(type, v); }}
          options={localizedZones}
          placeholder={t.search.allZones}
          ariaLabel={t.search.filterByZone}
        />

        {/* Result count */}
        {resultCount !== undefined && (
          <div
            key={countKey}
            style={{
              marginLeft:   'auto',
              display:      'flex',
              alignItems:   'center',
              gap:          '6px',
              animation:    'sb-count-pop 0.3s ease-out both',
            }}
          >
            {/* Pulsing dot */}
            <span
              style={{
                display:      'inline-block',
                width:        '6px',
                height:       '6px',
                borderRadius: '50%',
                background:   resultCount > 0 ? typeColor : '#4b5563',
                boxShadow:    resultCount > 0 ? `0 0 6px ${typeColor}` : 'none',
                animation:    resultCount > 0 ? 'sb-pulse 1.8s ease-in-out infinite' : 'none',
              }}
            />
            <span
              style={{
                fontSize:  '11px',
                fontFamily: 'monospace',
                color:     resultCount > 0 ? '#d1d5db' : '#4b5563',
              }}
            >
              <span style={{ color: resultCount > 0 ? typeColor : '#6b7280', fontWeight: 700 }}>
                {resultCount}
              </span>
              {' '}
              {resultCount === 1 ? t.search.result : t.search.results}
            </span>
          </div>
        )}
      </div>
    </form>
  );
}
