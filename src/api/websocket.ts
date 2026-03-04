/**
 * WebSocket event bus for real-time dashboard updates.
 *
 * Uses Node.js built-in EventEmitter as the internal event bus.
 * Broadcasts JSON events to all connected WebSocket clients.
 */

import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

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
// Internal event bus (singleton)
// ---------------------------------------------------------------------------

class StellarEventBus extends EventEmitter {
  emit(event: WsEventType, payload: Omit<WsEvent, 'type' | 'timestamp'>): boolean {
    return super.emit(event, { type: event, timestamp: Date.now(), ...payload });
  }
}

export const eventBus = new StellarEventBus();

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLIENT_TIMEOUT_MS     = 60_000;

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  lastPong: number;
}

let wss: WebSocketServer | null = null;

/**
 * Create the WebSocketServer and wire it to the event bus.
 * Call this once after the HTTP server is started.
 */
export function createWebSocketServer(): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  // Forward all bus events to connected clients
  const EVENTS: WsEventType[] = [
    'memory:created',
    'memory:updated',
    'memory:deleted',
    'orbit:recalculated',
    'sun:updated',
    'system:status',
  ];

  for (const eventType of EVENTS) {
    eventBus.on(eventType, (payload: WsEvent) => {
      broadcast(payload);
    });
  }

  wss.on('connection', (ws: WebSocket) => {
    const client = ws as ExtendedWebSocket;
    client.isAlive = true;
    client.lastPong = Date.now();

    // Send welcome message
    safeSend(client, {
      type: 'system:status',
      data: { connected: true, message: 'Connected to Stellar Memory WebSocket' },
      timestamp: Date.now(),
    });

    client.on('pong', () => {
      client.isAlive = true;
      client.lastPong = Date.now();
    });

    client.on('message', (data) => {
      // Handle ping from client
      try {
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg.type === 'ping') {
          safeSend(client, { type: 'system:status', data: { pong: true }, timestamp: Date.now() });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    client.on('error', () => {
      // Swallow errors — client will be cleaned up on next heartbeat
    });
  });

  // Heartbeat: detect dead connections
  const heartbeat = setInterval(() => {
    if (!wss) return;
    const now = Date.now();
    wss.clients.forEach((ws) => {
      const client = ws as ExtendedWebSocket;
      if (!client.isAlive || now - client.lastPong > CLIENT_TIMEOUT_MS) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  return wss;
}

/**
 * Handle HTTP upgrade request for the /ws path.
 * Call this from the HTTP server's 'upgrade' event handler.
 */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!wss) return;
  const url = req.url ?? '';
  if (url === '/ws' || url.startsWith('/ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function broadcast(payload: WsEvent): void {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg, (err) => {
        if (err) {
          // Ignore send errors — client will be cleaned up by heartbeat
        }
      });
    }
  });
}

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Ignore
    }
  }
}

/**
 * Emit a memory:created event.
 */
export function emitMemoryCreated(project: string, data: unknown): void {
  eventBus.emit('memory:created', { project, data });
}

/**
 * Emit a memory:updated event.
 */
export function emitMemoryUpdated(project: string, data: unknown): void {
  eventBus.emit('memory:updated', { project, data });
}

/**
 * Emit a memory:deleted event.
 */
export function emitMemoryDeleted(project: string, data: unknown): void {
  eventBus.emit('memory:deleted', { project, data });
}

/**
 * Emit an orbit:recalculated event.
 */
export function emitOrbitRecalculated(project: string, data: unknown): void {
  eventBus.emit('orbit:recalculated', { project, data });
}

/**
 * Emit a sun:updated event.
 */
export function emitSunUpdated(project: string, data: unknown): void {
  eventBus.emit('sun:updated', { project, data });
}
