import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { ProjectInfo } from '../api/client';
import { useTranslation } from '../i18n/context';

interface ProjectSwitcherProps {
  currentProject: string;
  onProjectChange: (project: string) => void;
}

export function ProjectSwitcher({ currentProject, onProjectChange }: ProjectSwitcherProps) {
  const { t } = useTranslation();
  const [projects, setProjects]   = useState<ProjectInfo[]>([]);
  const [open, setOpen]           = useState(false);
  const [creating, setCreating]   = useState(false);
  const [newName, setNewName]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const dropdownRef               = useRef<HTMLDivElement>(null);
  const triggerRef                = useRef<HTMLButtonElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  // Load projects on mount
  useEffect(() => {
    void loadProjects();
  }, []);

  // Close on outside click (portal-aware: check both trigger and dropdown)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inTrigger  = triggerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inTrigger && !inDropdown) {
        setOpen(false);
        setCreating(false);
        setNewName('');
        setError(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus input when create mode opens
  useEffect(() => {
    if (creating) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [creating]);

  async function loadProjects() {
    try {
      const res = await api.listProjects();
      setProjects(res.data ?? []);
    } catch {
      // silently ignore — project list is non-critical
    }
  }

  async function handleSelect(project: string) {
    if (project === currentProject) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await api.switchProject(project);
      onProjectChange(project);
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Switch failed');
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      await api.createProject(name);
      await loadProjects();
      await handleSelect(name);
      setCreating(false);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setLoading(false);
    }
  }

  // Ensure current project is shown in list even if not yet loaded
  const projectList = projects.length > 0
    ? projects
    : [{ project: currentProject, memoryCount: 0 }];

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger pill */}
      <button
        ref={triggerRef}
        onClick={() => { setOpen(!open); setCreating(false); setError(null); }}
        disabled={loading}
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            '6px',
          padding:        '3px 10px 3px 8px',
          borderRadius:   '999px',
          border:         `1px solid ${open ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.12)'}`,
          background:     open
            ? 'rgba(96,165,250,0.1)'
            : 'rgba(255,255,255,0.05)',
          color:          open ? '#93c5fd' : '#9ca3af',
          fontSize:       '11px',
          cursor:         loading ? 'not-allowed' : 'pointer',
          transition:     'all 0.18s ease',
          boxShadow:      open ? '0 0 10px rgba(96,165,250,0.15)' : 'none',
          whiteSpace:     'nowrap',
          maxWidth:       '140px',
          overflow:       'hidden',
        }}
        onMouseEnter={(e) => {
          if (loading || open) return;
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = 'rgba(96,165,250,0.3)';
          el.style.color       = '#d1d5db';
        }}
        onMouseLeave={(e) => {
          if (loading || open) return;
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = 'rgba(255,255,255,0.12)';
          el.style.color       = '#9ca3af';
        }}
      >
        {/* Planet dot */}
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: '#60a5fa', flexShrink: 0,
          boxShadow: '0 0 6px rgba(96,165,250,0.6)',
        }} />
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {currentProject}
        </span>
        <span style={{ fontSize: '8px', opacity: 0.6, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown — portal to escape sidebar overflow clipping */}
      {open && createPortal(
        (() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          const top  = rect ? rect.bottom + 6 : 0;
          const left = rect ? rect.left : 0;
          return (
        <div
          ref={dropdownRef}
          style={{
            position:    'fixed',
            top,
            left,
            minWidth:    '200px',
            background:  'linear-gradient(180deg, #0d1f3c, #080f1e)',
            border:      '1px solid rgba(96,165,250,0.18)',
            borderRadius: '10px',
            boxShadow:   '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(96,165,250,0.06)',
            zIndex:      9999,
            overflow:    'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding:     '8px 12px 6px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            fontSize:    '9px',
            color:       '#4b5563',
            fontWeight:  600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            {t.projectSwitcher.projects}
          </div>

          {/* Project list */}
          <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
            {projectList.map((p) => {
              const isActive = p.project === currentProject;
              return (
                <button
                  key={p.project}
                  onClick={() => void handleSelect(p.project)}
                  style={{
                    width:       '100%',
                    display:     'flex',
                    alignItems:  'center',
                    gap:         '8px',
                    padding:     '7px 12px',
                    background:  isActive ? 'rgba(96,165,250,0.08)' : 'transparent',
                    border:      'none',
                    cursor:      'pointer',
                    textAlign:   'left',
                    transition:  'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = isActive
                      ? 'rgba(96,165,250,0.08)'
                      : 'transparent';
                  }}
                >
                  {/* Active dot */}
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                    background:  isActive ? '#60a5fa' : 'rgba(255,255,255,0.15)',
                    boxShadow:   isActive ? '0 0 6px rgba(96,165,250,0.6)' : 'none',
                  }} />

                  <span style={{
                    flex:     1,
                    fontSize: '12px',
                    color:    isActive ? '#93c5fd' : '#9ca3af',
                    fontWeight: isActive ? 600 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.project}
                  </span>

                  {/* Memory count badge */}
                  {p.memoryCount > 0 && (
                    <span style={{
                      fontSize:    '9px',
                      fontFamily:  'monospace',
                      color:       '#4b5563',
                      background:  'rgba(255,255,255,0.06)',
                      padding:     '1px 5px',
                      borderRadius: '999px',
                    }}>
                      {p.memoryCount}
                    </span>
                  )}

                  {/* Universal badge */}
                  {p.hasUniversal && (
                    <span title={t.projectSwitcher.hasUniversal} style={{
                      fontSize: '10px', opacity: 0.6,
                    }}>
                      &#x1F310;
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider + create */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {creating ? (
              <form onSubmit={(e) => void handleCreate(e)} style={{ padding: '8px 10px', display: 'flex', gap: '6px' }}>
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="project-name"
                  style={{
                    flex:         1,
                    background:   'rgba(0,0,0,0.4)',
                    border:       '1px solid rgba(96,165,250,0.3)',
                    borderRadius: '6px',
                    padding:      '4px 8px',
                    fontSize:     '11px',
                    color:        '#e5e7eb',
                    outline:      'none',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setCreating(false); setNewName(''); setError(null); }
                  }}
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || loading}
                  style={{
                    padding:      '4px 8px',
                    borderRadius: '6px',
                    border:       '1px solid rgba(96,165,250,0.4)',
                    background:   'rgba(96,165,250,0.12)',
                    color:        '#93c5fd',
                    fontSize:     '11px',
                    cursor:       newName.trim() && !loading ? 'pointer' : 'not-allowed',
                    opacity:      newName.trim() && !loading ? 1 : 0.5,
                  }}
                >
                  {t.projectSwitcher.create}
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreating(true)}
                style={{
                  width:       '100%',
                  display:     'flex',
                  alignItems:  'center',
                  gap:         '6px',
                  padding:     '7px 12px',
                  background:  'transparent',
                  border:      'none',
                  cursor:      'pointer',
                  fontSize:    '11px',
                  color:       '#4b5563',
                  textAlign:   'left',
                  transition:  'color 0.15s ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
              >
                <span style={{ fontSize: '13px', lineHeight: 1 }}>+</span>
                {t.projectSwitcher.newProject}
              </button>
            )}

            {/* Inline error */}
            {error && (
              <div style={{
                padding:  '4px 12px 8px',
                fontSize: '10px',
                color:    '#f87171',
              }}>
                {error}
              </div>
            )}
          </div>
        </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
