/**
 * scanner/cloud/notion.ts — Notion connector.
 *
 * Uses the official Notion API (api.notion.com).
 * Authentication: Internal Integration Token (api_key credential).
 *
 * Fetch strategy:
 *   1. List all pages the integration has access to via /v1/search.
 *   2. For each page, retrieve blocks and convert to Markdown text.
 *   3. Incremental sync: filter by last_edited_time > since.
 *
 * Rate limits: Notion allows 3 requests/second per integration.
 * We throttle to ≤3 req/s and apply exponential backoff on 429.
 *
 * Privacy: Only pages shared with the integration are visible.
 * Private / unshared pages are never accessible.
 */

import type { CloudConnector, CloudDocument, MemoryCreateInput } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('notion');

const NOTION_API_BASE  = 'https://api.notion.com/v1';
const NOTION_API_VERSION = '2022-06-28';
const MAX_RETRIES = 4;
const REQUEST_INTERVAL_MS = 350; // ~3 req/s

// ---------------------------------------------------------------------------
// Raw Notion API shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
}

type NotionProperty =
  | { type: 'title';        title: Array<{ plain_text: string }> }
  | { type: 'rich_text';    rich_text: Array<{ plain_text: string }> }
  | { type: string;         [key: string]: unknown };

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

interface NotionParagraph {
  rich_text: Array<{ plain_text: string }>;
}

// ---------------------------------------------------------------------------
// NotionConnector
// ---------------------------------------------------------------------------

export class NotionConnector implements CloudConnector {
  readonly name = 'Notion';
  readonly type = 'notion' as const;

  private apiKey: string | null = null;
  private lastRequestAt = 0;

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  async authenticate(credentials: Record<string, string>): Promise<void> {
    const key = credentials['api_key'];
    if (!key) {
      throw new Error('NotionConnector requires an "api_key" credential (Internal Integration Token)');
    }

    // Verify the token by calling /v1/users/me
    const res = await this.request('GET', '/users/me', key);
    if (!res.ok) {
      throw new Error(`Notion authentication failed: ${res.status}`);
    }

    this.apiKey = key;
    log.info('Notion authentication successful');
  }

  isAuthenticated(): boolean {
    return this.apiKey !== null;
  }

  // -------------------------------------------------------------------------
  // fetchDocuments
  // -------------------------------------------------------------------------

  async fetchDocuments(since?: Date): Promise<CloudDocument[]> {
    this.assertAuthenticated();
    log.info('Fetching Notion pages', { since: since?.toISOString() });

    const pages = await this.searchPages(since);
    log.info('Found Notion pages', { count: pages.length });

    const docs: CloudDocument[] = [];
    for (const page of pages) {
      try {
        const content = await this.extractPageContent(page.id);
        const title   = extractPageTitle(page);
        docs.push({
          id:           page.id,
          title,
          content,
          url:          page.url,
          mimeType:     'text/markdown',
          lastModified: new Date(page.last_edited_time),
          metadata: {
            notionId:       page.id,
            notionUrl:      page.url,
            lastEditedTime: page.last_edited_time,
          },
        });
      } catch (err) {
        log.warn('Failed to extract Notion page content', { pageId: page.id });
        log.error('Extraction error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    return docs;
  }

  // -------------------------------------------------------------------------
  // toMemory
  // -------------------------------------------------------------------------

  toMemory(doc: CloudDocument): MemoryCreateInput {
    return {
      content:     `# ${doc.title}\n\n${doc.content}`,
      summary:     doc.title.slice(0, 120),
      type:        'context',
      tags:        ['notion', 'cloud'],
      source:      'cloud',
      source_path: doc.url,
      metadata: {
        ...doc.metadata,
        cloudService: 'notion',
        lastModified: doc.lastModified.toISOString(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private assertAuthenticated(): void {
    if (!this.isAuthenticated()) {
      throw new Error('NotionConnector: not authenticated. Call authenticate() first.');
    }
  }

  private async request(
    method: string,
    path: string,
    apiKey?: string,
    body?: unknown,
  ): Promise<Response> {
    // Throttle to stay within rate limit
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = Date.now();

    const key = apiKey ?? this.apiKey!;
    const init: RequestInit = {
      method,
      headers: {
        Authorization:       `Bearer ${key}`,
        'Notion-Version':    NOTION_API_VERSION,
        'Content-Type':      'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    return fetchWithBackoff(`${NOTION_API_BASE}${path}`, init);
  }

  private async searchPages(since?: Date): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filter:   { value: 'page', property: 'object' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };

      const res  = await this.request('POST', '/search', undefined, body);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Notion search failed: ${res.status} ${text}`);
      }

      const data = await res.json() as {
        results: NotionPage[];
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const page of data.results) {
        if (!since || new Date(page.last_edited_time) > since) {
          pages.push(page);
        }
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    return pages;
  }

  private async extractPageContent(pageId: string): Promise<string> {
    const lines: string[] = [];
    let cursor: string | undefined;

    do {
      const path = `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
      const res  = await this.request('GET', path);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Notion blocks fetch failed: ${res.status} ${text}`);
      }

      const data = await res.json() as {
        results: NotionBlock[];
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const block of data.results) {
        const line = blockToMarkdown(block);
        if (line) lines.push(line);
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Notion block → Markdown converter
// ---------------------------------------------------------------------------

function blockToMarkdown(block: NotionBlock): string {
  const type = block.type as string;

  const richText = (block[type] as NotionParagraph | undefined)?.rich_text ?? [];
  const text = richText.map(rt => rt.plain_text).join('');

  switch (type) {
    case 'heading_1':       return `# ${text}`;
    case 'heading_2':       return `## ${text}`;
    case 'heading_3':       return `### ${text}`;
    case 'paragraph':       return text;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': {
      const checked = (block['to_do'] as { checked: boolean } | undefined)?.checked ?? false;
      return `- [${checked ? 'x' : ' '}] ${text}`;
    }
    case 'code': {
      const lang = (block['code'] as { language: string } | undefined)?.language ?? '';
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case 'quote':           return `> ${text}`;
    case 'divider':         return '---';
    case 'callout':         return `> **Note:** ${text}`;
    default:                return text;
  }
}

function extractPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title') {
      return (prop as Extract<NotionProperty, { type: 'title' }>).title
        .map(t => t.plain_text)
        .join('');
    }
  }
  return `Notion page ${page.id}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchWithBackoff(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
    const delay = Math.max(retryAfter * 1000, Math.min(1000 * 2 ** attempt, 16_000));
    log.debug('Rate limited by Notion, retrying', { delay, attempt });
    await sleep(delay);
    return fetchWithBackoff(url, init, attempt + 1);
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
