/**
 * storage/queries.ts — Barrel re-export for backward compatibility.
 *
 * The entire codebase imports from '../storage/queries.js'.
 * This file re-exports everything from the domain files under queries/
 * so no existing import paths need to change.
 */

export * from './queries/shared.js';
export * from './queries/memory-queries.js';
export * from './queries/sun-queries.js';
export * from './queries/orbit-queries.js';
export * from './queries/constellation-queries.js';
export * from './queries/conflict-queries.js';
export * from './queries/temporal-queries.js';
export * from './queries/analytics-queries.js';
export * from './queries/observation-queries.js';
export * from './queries/datasource-queries.js';
