/**
 * scanner/cloud/types.ts — Common interfaces for cloud connectors.
 *
 * Each cloud connector (Google Drive, Notion, GitHub, Slack) implements
 * CloudConnector. The CloudDocument is the neutral transport format;
 * toMemory() maps it into the shape required by the storage layer.
 */

import type { MemoryType } from '../../engine/types.js';

// ---------------------------------------------------------------------------
// CloudDocument — neutral document fetched from a cloud service
// ---------------------------------------------------------------------------

export interface CloudDocument {
  /** Service-specific unique identifier */
  id: string;
  /** Human-readable title / subject */
  title: string;
  /** Plain-text body content */
  content: string;
  /** Canonical URL to the document */
  url: string;
  /** MIME type (e.g., "text/plain", "text/markdown") */
  mimeType: string;
  /** Last modification timestamp on the cloud service */
  lastModified: Date;
  /** Optional display name of the document author */
  author?: string;
  /** Arbitrary service-specific metadata */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MemoryCreateInput — what the storage layer needs to create a new memory
// ---------------------------------------------------------------------------

export interface MemoryCreateInput {
  content: string;
  summary: string;
  type: MemoryType;
  tags: string[];
  source: 'cloud';
  source_path: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CloudConnector — interface every cloud connector must satisfy
// ---------------------------------------------------------------------------

export interface CloudConnector {
  /** Human-readable service name */
  readonly name: string;
  /** Discriminated union key used for routing / logging */
  readonly type: 'google-drive' | 'notion' | 'github' | 'slack';

  /**
   * Authenticate with the cloud service.
   * Credentials are passed as a plain-object map so each connector can define
   * its own required keys without leaking them into the interface.
   * Credentials must come from environment variables or a local config file —
   * never from user-supplied untrusted input directly.
   */
  authenticate(credentials: Record<string, string>): Promise<void>;

  /** Returns true if the connector holds valid authentication state */
  isAuthenticated(): boolean;

  /**
   * Fetch documents modified since the given date.
   * When `since` is omitted the connector performs a full initial scan.
   * Implementors must honour rate limits and apply exponential backoff on 429s.
   */
  fetchDocuments(since?: Date): Promise<CloudDocument[]>;

  /**
   * Convert a fetched CloudDocument into the shape needed to create a memory.
   * Implementors must populate source_path with the document URL so the
   * deduplication index can find duplicates on re-sync.
   */
  toMemory(doc: CloudDocument): MemoryCreateInput;
}

// ---------------------------------------------------------------------------
// ConnectorRegistry — lightweight runtime map of registered connectors
// ---------------------------------------------------------------------------

export type ConnectorType = CloudConnector['type'];

/** Represents the persisted authentication state for a connector */
export interface ConnectorAuthState {
  type: ConnectorType;
  authenticated: boolean;
  authenticatedAt: Date | null;
  /** Redacted credential summary — never store raw secrets here */
  summary: string;
}
