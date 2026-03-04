/**
 * useWebSocket — real-time connection to Stellar Memory WebSocket server.
 *
 * - Connects to ws://localhost:21547/ws (or derives from window.location)
 * - Auto-reconnects with exponential backoff (1s → 2s → 4s → … → 30s max)
 * - Parses incoming JSON events and exposes the latest via `lastEvent`
 * - Returns connection status for UI indicator
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type WsEventType =
  | 'memory:created'
  | 'memory:updated'
  | 'memory:deleted'
  | 'orbit:recalculated'
  | 'sun:updated'
  | 'system:status';

export interface WsEvent {
  type: WsEventType;
  project?: string;
  data?: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWsUrl(): string {
  const viteUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (viteUrl) {
    // Convert http://... → ws://...
    return viteUrl.replace(/^http/, 'ws') + '/ws';
  }
  // In dev, proxy isn't set up for ws — connect directly
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  // Always connect to API port (not Vite dev port)
  const port = import.meta.env.DEV ? '21547' : window.location.port;
  return `${protocol}//${host}:${port}/ws`;
}

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function nextBackoff(attempt: number): number {
  return Math.min(MIN_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket() {
  const [status, setStatus]       = useState<WsStatus>('connecting');
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);

  const wsRef         = useRef<WebSocket | null>(null);
  const attemptRef    = useRef(0);
  const mountedRef    = useRef(true);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const url = getWsUrl();
    let ws: WebSocket;

    try {
      ws = new WebSocket(url);
    } catch {
      // WebSocket construction can throw in some environments
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;
    setStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      attemptRef.current = 0;
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const parsed = JSON.parse(event.data as string) as WsEvent;
        setLastEvent(parsed);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires right after onerror — reconnect handled there
    };
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('reconnecting');
    const delay = nextBackoff(attemptRef.current);
    attemptRef.current += 1;
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setStatus('disconnected');
    };
  }, [connect]);

  return { status, lastEvent };
}
