/**
 * mcp/tools/memory-tools.ts — Barrel re-export for backward compatibility.
 *
 * All handler logic has been split into focused files:
 *   shared.ts            — McpResponse type, trackBgError, ensureCorona, etc.
 *   memory-handlers.ts   — handleRemember, handleRecall, handleForget
 *   system-handlers.ts   — handleStatus, handleCommit, handleOrbit, handleExport
 *   graph-handlers.ts    — handleConstellation, handleResolveConflict
 *   analytics-handlers.ts — handleAnalytics, handleGalaxy
 *   observation-handlers.ts — handleObserve, handleConsolidate
 *   temporal-handlers.ts — handleTemporal
 *   sun-handler.ts       — handleSunResource
 *
 * Importing from this file continues to work for tests and other consumers.
 */

export * from './shared.js';
export * from './memory-handlers.js';
export * from './system-handlers.js';
export * from './graph-handlers.js';
export * from './analytics-handlers.js';
export * from './observation-handlers.js';
export * from './temporal-handlers.js';
export * from './sun-handler.js';
