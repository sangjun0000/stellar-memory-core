/**
 * mcp/connector-registry.ts — Class-based registry for cloud connectors.
 *
 * Replaces the module-level `connectorRegistry` Map in the original server.ts.
 * A class instance is passed around explicitly, making dependencies visible,
 * enabling per-test isolation, and removing hidden global state.
 */

import type { CloudConnector } from '../scanner/cloud/types.js';

export class ConnectorRegistry {
  private readonly registry = new Map<string, CloudConnector>();

  set(type: string, connector: CloudConnector): void {
    this.registry.set(type, connector);
  }

  get(type: string): CloudConnector | undefined {
    return this.registry.get(type);
  }

  has(type: string): boolean {
    return this.registry.has(type);
  }

  get size(): number {
    return this.registry.size;
  }

  keys(): string[] {
    return [...this.registry.keys()];
  }

  values(): CloudConnector[] {
    return [...this.registry.values()];
  }

  delete(type: string): boolean {
    return this.registry.delete(type);
  }

  clear(): void {
    this.registry.clear();
  }
}
