import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { useTranslation } from '../i18n/context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'selecting_folders' | 'scanning' | 'complete';

interface ScanProgress {
  scannedFiles: number;
  createdMemories: number;
  totalFiles: number;
  currentFile: string;
  percentComplete: number;
}

interface ScanComplete {
  totalScannedFiles: number;
  totalCreatedMemories: number;
  durationMs: number;
}

interface Props {
  onSkip: () => void;
  onComplete: () => void;
  /** If a scan was already in progress on mount, start in scanning phase */
  resumeScanning?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingScreen({ onSkip, onComplete, resumeScanning }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(resumeScanning ? 'scanning' : 'idle');
  const [folders, setFolders] = useState<string[]>(['']);
  const [progress, setProgress] = useState<ScanProgress>({
    scannedFiles: 0,
    createdMemories: 0,
    totalFiles: 0,
    currentFile: '',
    percentComplete: 0,
  });
  const [result, setResult] = useState<ScanComplete | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectingPath, setCollectingPath] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Poll progress when resuming an already-running scan
  useEffect(() => {
    if (!resumeScanning) return;
    let alive = true;
    const poll = async () => {
      while (alive) {
        try {
          const res = await api.getScanStatus();
          if (!res.data.isScanning) {
            // Scan finished between page loads
            setPhase('complete');
            setResult({ totalScannedFiles: 0, totalCreatedMemories: 0, durationMs: 0 });
            break;
          }
          if (res.data.progress) {
            setProgress(res.data.progress);
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    void poll();
    return () => { alive = false; };
  }, [resumeScanning]);

  // -------------------------------------------------------------------
  // Start scan (SSE)
  // -------------------------------------------------------------------

  const startMetaScan = useCallback(async (paths?: string[]) => {
    setPhase('scanning');
    setError(null);
    abortRef.current = false;

    try {
      const res = await api.startMetaScan({
        paths: paths ?? ['C:\\'],
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        setError(err.error ?? `HTTP ${res.status}`);
        setPhase('idle');
        return;
      }

      if (!res.body) {
        setError('No response stream');
        setPhase('idle');
        return;
      }

      // Read SSE stream (same logic as full scan)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              handleSSEEvent(currentEvent, parsed);
            } catch {
              // ignore malformed JSON
            }
          }
        }
      }
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setPhase('idle');
      }
    }
  }, []);

  const startScan = useCallback(async (mode: 'full' | 'folders', paths?: string[]) => {
    setPhase('scanning');
    setError(null);
    abortRef.current = false;

    try {
      const res = await api.startFullScan({
        mode,
        paths: mode === 'folders' ? paths : undefined,
        includeGit: true,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        setError(err.error ?? `HTTP ${res.status}`);
        setPhase('idle');
        return;
      }

      if (!res.body) {
        setError('No response stream');
        setPhase('idle');
        return;
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              handleSSEEvent(currentEvent, parsed);
            } catch {
              // ignore malformed JSON
            }
          }
        }
      }
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setPhase('idle');
      }
    }
  }, []);

  const handleSSEEvent = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case 'scan:progress': {
        if (data.phase === 'collecting') {
          setCollectingPath(data.path as string);
        } else if (data.phase === 'collected') {
          setCollectingPath(null);
          setProgress((prev) => ({
            ...prev,
            totalFiles: (data.totalFiles as number) ?? prev.totalFiles,
          }));
        } else {
          setCollectingPath(null);
          setProgress({
            scannedFiles: (data.scannedFiles as number) ?? 0,
            createdMemories: (data.createdMemories as number) ?? 0,
            totalFiles: (data.totalFiles as number) ?? 0,
            currentFile: (data.currentFile as string) ?? '',
            percentComplete: (data.percentComplete as number) ?? 0,
          });
        }
        break;
      }
      case 'scan:complete':
        setResult({
          totalScannedFiles: (data.totalScannedFiles as number) ?? 0,
          totalCreatedMemories: (data.totalCreatedMemories as number) ?? 0,
          durationMs: (data.durationMs as number) ?? 0,
        });
        setPhase('complete');
        break;
      case 'scan:cancelled':
        setResult({
          totalScannedFiles: (data.totalScannedFiles as number) ?? 0,
          totalCreatedMemories: (data.totalCreatedMemories as number) ?? 0,
          durationMs: (data.durationMs as number) ?? 0,
        });
        setPhase('complete');
        break;
      case 'scan:error':
        if (data.fatal) {
          setError(data.error as string);
          setPhase('idle');
        }
        break;
    }
  };

  const handleCancel = async () => {
    abortRef.current = true;
    try { await api.cancelScan(); } catch { /* ignore */ }
  };

  // -------------------------------------------------------------------
  // Folder management
  // -------------------------------------------------------------------

  const addFolder = () => setFolders((f) => [...f, '']);
  const removeFolder = (i: number) => setFolders((f) => f.filter((_, idx) => idx !== i));
  const updateFolder = (i: number, val: string) =>
    setFolders((f) => f.map((v, idx) => (idx === i ? val : v)));

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    background: 'radial-gradient(ellipse at center, rgba(15,25,50,0.95) 0%, rgba(5,10,20,0.98) 100%)',
    fontFamily: 'monospace',
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: 520,
    width: '100%',
    padding: '40px 44px',
    background: 'rgba(10, 22, 40, 0.85)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '20px',
    backdropFilter: 'blur(24px)',
    boxShadow: '0 12px 64px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
    textAlign: 'center',
  };

  // ---- IDLE (mode selection) ----
  if (phase === 'idle') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          {/* Sun glow */}
          <div style={{
            width: 64, height: 64, margin: '0 auto 20px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 40% 35%, rgba(251,191,36,0.4), rgba(251,191,36,0.1) 60%, transparent)',
            border: '1px solid rgba(251,191,36,0.4)',
            boxShadow: '0 0 40px rgba(251,191,36,0.25), 0 0 80px rgba(251,191,36,0.1)',
            animation: 'pulse 3s ease-in-out infinite',
          }} />

          <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e7eb', letterSpacing: '0.04em', marginBottom: 10 }}>
            {t.onboarding.welcome}
          </div>
          <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7, marginBottom: 28 }}>
            {t.onboarding.emptyDesc.split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
          </div>

          {error && (
            <div style={{
              marginBottom: 16, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#f87171', fontSize: 11,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
            <button
              onClick={() => void startMetaScan()}
              style={{
                flex: 1, maxWidth: 160, padding: '14px 16px', borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,191,36,0.05))',
                border: '1px solid rgba(251,191,36,0.35)',
                color: '#fbbf24', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                fontFamily: 'monospace', transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(251,191,36,0.6)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(251,191,36,0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(251,191,36,0.35)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div style={{ marginBottom: 4 }}>{t.onboarding.quickScan}</div>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 400 }}>
                {t.onboarding.quickScanDesc.split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
              </div>
            </button>

            <button
              onClick={() => void startScan('full')}
              style={{
                flex: 1, maxWidth: 160, padding: '14px 16px', borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(96,165,250,0.15), rgba(96,165,250,0.05))',
                border: '1px solid rgba(96,165,250,0.3)',
                color: '#93c5fd', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                fontFamily: 'monospace', transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.6)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(96,165,250,0.15)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.3)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div style={{ marginBottom: 4 }}>{t.onboarding.fullScan}</div>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 400 }}>
                {t.onboarding.fullScanDesc.split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
              </div>
            </button>

            <button
              onClick={() => setPhase('selecting_folders')}
              style={{
                flex: 1, maxWidth: 160, padding: '14px 16px', borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))',
                border: '1px solid rgba(34,197,94,0.25)',
                color: '#86efac', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                fontFamily: 'monospace', transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.5)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(34,197,94,0.12)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.25)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div style={{ marginBottom: 4 }}>{t.onboarding.selectFolders}</div>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 400 }}>
                {t.onboarding.selectFoldersDesc.split('\n').map((line, i) => <span key={i}>{line}{i === 0 && <br />}</span>)}
              </div>
            </button>
          </div>

          <button
            onClick={onSkip}
            style={{
              background: 'none', border: 'none', color: '#6b7280', fontSize: 11,
              cursor: 'pointer', fontFamily: 'monospace', padding: '4px 8px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
          >
            {t.onboarding.skip}
          </button>
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.08); opacity: 0.85; }
          }
        `}</style>
      </div>
    );
  }

  // ---- SELECTING FOLDERS ----
  if (phase === 'selecting_folders') {
    const validFolders = folders.filter((f) => f.trim().length > 0);
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 6 }}>
            {t.onboarding.selectFoldersTitle}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 20 }}>
            {t.onboarding.enterPaths}
          </div>

          <div style={{ textAlign: 'left', marginBottom: 20 }}>
            {folders.map((folder, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={folder}
                  onChange={(e) => updateFolder(i, e.target.value)}
                  placeholder="C:\Users\..."
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#e5e7eb', fontSize: 12, fontFamily: 'monospace',
                    outline: 'none',
                  }}
                  onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.4)'; }}
                  onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
                {folders.length > 1 && (
                  <button
                    onClick={() => removeFolder(i)}
                    style={{
                      background: 'none', border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: 6, color: '#f87171', cursor: 'pointer',
                      width: 28, height: 28, fontSize: 14, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addFolder}
              style={{
                background: 'none', border: '1px dashed rgba(255,255,255,0.1)',
                borderRadius: 8, color: '#6b7280', cursor: 'pointer',
                width: '100%', padding: '8px', fontSize: 11, fontFamily: 'monospace',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)';
                (e.currentTarget as HTMLElement).style.color = '#9ca3af';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
                (e.currentTarget as HTMLElement).style.color = '#6b7280';
              }}
            >
              {t.onboarding.addFolder}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => setPhase('idle')}
              style={{
                padding: '8px 20px', borderRadius: 8,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                color: '#9ca3af', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
              }}
            >
              {t.onboarding.back}
            </button>
            <button
              onClick={() => void startScan('folders', validFolders)}
              disabled={validFolders.length === 0}
              style={{
                padding: '8px 24px', borderRadius: 8,
                background: validFolders.length > 0
                  ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${validFolders.length > 0 ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: validFolders.length > 0 ? '#93c5fd' : '#4b5563',
                cursor: validFolders.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 12, fontWeight: 600, fontFamily: 'monospace',
              }}
            >
              {t.onboarding.startScan}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- SCANNING ----
  if (phase === 'scanning') {
    const pct = progress.percentComplete;
    const shortFile = progress.currentFile
      ? progress.currentFile.split(/[\\/]/).slice(-2).join('/')
      : collectingPath
        ? `${t.onboarding.collectingFrom} ${collectingPath.split(/[\\/]/).slice(-2).join('/')}...`
        : t.onboarding.initializing;

    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 6 }}>
            {t.onboarding.scanningFiles}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 24 }}>
            {t.onboarding.discoveryDesc}
          </div>

          {/* Progress bar */}
          <div style={{
            width: '100%', height: 6, borderRadius: 3,
            background: 'rgba(255,255,255,0.06)', marginBottom: 16, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              width: `${Math.min(pct, 100)}%`,
              transition: 'width 0.3s ease',
              boxShadow: '0 0 8px rgba(96,165,250,0.4)',
            }} />
          </div>

          {/* Stats */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16,
          }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#60a5fa' }}>
                {progress.scannedFiles.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{t.onboarding.filesScanned}</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#34d399' }}>
                {progress.createdMemories.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{t.onboarding.memoriesCreated}</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>
                {pct > 0 ? `${pct}%` : '...'}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{t.onboarding.complete}</div>
            </div>
          </div>

          {/* Current file */}
          <div style={{
            fontSize: 10, color: '#4b5563', marginBottom: 20,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}>
            {shortFile}
          </div>

          <button
            onClick={() => void handleCancel()}
            style={{
              padding: '8px 24px', borderRadius: 8,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#f87171', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.5)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.25)'; }}
          >
            {t.onboarding.cancel}
          </button>
        </div>
      </div>
    );
  }

  // ---- COMPLETE ----
  if (phase === 'complete' && result) {
    const durationSec = Math.round((result.durationMs ?? 0) / 1000);
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          {/* Success glow */}
          <div style={{
            width: 56, height: 56, margin: '0 auto 20px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(34,197,94,0.3), rgba(34,197,94,0.05) 70%, transparent)',
            border: '1px solid rgba(34,197,94,0.35)',
            boxShadow: '0 0 32px rgba(34,197,94,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
          }}>
            <span style={{ color: '#34d399' }}>&#x2713;</span>
          </div>

          <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 8 }}>
            {t.onboarding.scanComplete}
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24,
            padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#34d399' }}>
                {result.totalCreatedMemories.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{t.onboarding.memoriesCreated}</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#60a5fa' }}>
                {result.totalScannedFiles.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{t.onboarding.filesScanned}</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24' }}>
                {timeStr}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{t.onboarding.duration}</div>
            </div>
          </div>

          <button
            onClick={onComplete}
            style={{
              padding: '10px 32px', borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.08))',
              border: '1px solid rgba(34,197,94,0.35)',
              color: '#86efac', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              fontFamily: 'monospace', transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.6)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 24px rgba(34,197,94,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.35)';
              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
            }}
          >
            {t.onboarding.explore}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
