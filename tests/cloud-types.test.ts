/**
 * tests/cloud-types.test.ts — Verify that each cloud connector correctly
 * implements the CloudConnector interface at the type level and honours
 * the contract for toMemory().
 *
 * These tests do NOT make real network calls — they exercise local logic only.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveConnector } from '../src/scanner/cloud/google-drive.js';
import { NotionConnector }      from '../src/scanner/cloud/notion.js';
import { GitHubConnector }      from '../src/scanner/cloud/github.js';
import { SlackConnector }       from '../src/scanner/cloud/slack.js';
import type { CloudDocument, CloudConnector } from '../src/scanner/cloud/types.js';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<CloudDocument> = {}): CloudDocument {
  return {
    id:           'doc-123',
    title:        'Test Document',
    content:      'Hello world content',
    url:          'https://example.com/doc-123',
    mimeType:     'text/plain',
    lastModified: new Date('2025-01-15T10:00:00Z'),
    metadata:     { source: 'test' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Interface conformance — each connector must implement CloudConnector
// ---------------------------------------------------------------------------

describe('CloudConnector interface conformance', () => {
  const connectors: Array<{ name: string; connector: CloudConnector }> = [
    { name: 'GoogleDriveConnector', connector: new GoogleDriveConnector() },
    { name: 'NotionConnector',      connector: new NotionConnector()      },
    { name: 'GitHubConnector',      connector: new GitHubConnector()      },
    { name: 'SlackConnector',       connector: new SlackConnector()       },
  ];

  for (const { name, connector } of connectors) {
    describe(name, () => {
      it('has a non-empty name', () => {
        expect(typeof connector.name).toBe('string');
        expect(connector.name.length).toBeGreaterThan(0);
      });

      it('has a valid type discriminant', () => {
        const validTypes = ['google-drive', 'notion', 'github', 'slack'];
        expect(validTypes).toContain(connector.type);
      });

      it('starts unauthenticated', () => {
        expect(connector.isAuthenticated()).toBe(false);
      });

      it('authenticate() is a function', () => {
        expect(typeof connector.authenticate).toBe('function');
      });

      it('fetchDocuments() is a function', () => {
        expect(typeof connector.fetchDocuments).toBe('function');
      });

      it('toMemory() is a function', () => {
        expect(typeof connector.toMemory).toBe('function');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// toMemory() — structural contract
// ---------------------------------------------------------------------------

describe('GoogleDriveConnector.toMemory()', () => {
  const connector = new GoogleDriveConnector();
  const doc = makeDoc({ title: 'My Google Doc', url: 'https://drive.google.com/file/d/abc/view' });

  it('sets source to "cloud"', () => {
    const memory = connector.toMemory(doc);
    expect(memory.source).toBe('cloud');
  });

  it('sets source_path to the document URL', () => {
    const memory = connector.toMemory(doc);
    expect(memory.source_path).toBe(doc.url);
  });

  it('includes the title in content', () => {
    const memory = connector.toMemory(doc);
    expect(memory.content).toContain(doc.title);
  });

  it('includes google-drive in tags', () => {
    const memory = connector.toMemory(doc);
    expect(memory.tags).toContain('google-drive');
  });

  it('summary is at most 120 chars', () => {
    const longTitle = 'A'.repeat(200);
    const memory = connector.toMemory(makeDoc({ title: longTitle }));
    expect(memory.summary.length).toBeLessThanOrEqual(120);
  });
});

describe('NotionConnector.toMemory()', () => {
  const connector = new NotionConnector();
  const doc = makeDoc({ url: 'https://notion.so/page-abc' });

  it('includes notion in tags', () => {
    expect(connector.toMemory(doc).tags).toContain('notion');
  });

  it('sets source to "cloud"', () => {
    expect(connector.toMemory(doc).source).toBe('cloud');
  });
});

describe('GitHubConnector.toMemory()', () => {
  const connector = new GitHubConnector();

  it('uses "context" type for regular docs', () => {
    const doc = makeDoc({ title: 'README: owner/repo' });
    const memory = connector.toMemory(doc);
    expect(memory.type).toBe('context');
  });

  it('uses "observation" type for commit logs', () => {
    const doc = makeDoc({ title: 'Commits: owner/repo', mimeType: 'text/plain' });
    const memory = connector.toMemory(doc);
    expect(memory.type).toBe('observation');
  });

  it('includes github in tags', () => {
    expect(connector.toMemory(makeDoc()).tags).toContain('github');
  });
});

describe('SlackConnector.toMemory()', () => {
  const connector = new SlackConnector();

  it('uses "context" type for pinned messages', () => {
    const doc = makeDoc({ metadata: { docType: 'pinned', channelName: 'general' } });
    expect(connector.toMemory(doc).type).toBe('context');
  });

  it('uses "observation" type for channel history', () => {
    const doc = makeDoc({ metadata: { docType: 'channel_history', channelName: 'random' } });
    expect(connector.toMemory(doc).type).toBe('observation');
  });

  it('includes slack in tags', () => {
    const doc = makeDoc({ metadata: { channelName: 'general', docType: 'channel_history' } });
    expect(connector.toMemory(doc).tags).toContain('slack');
  });
});
