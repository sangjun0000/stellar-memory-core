/**
 * scanner/cloud/slack.ts — Slack connector.
 *
 * Collects: channel message history, thread conversations, pinned messages.
 * Intentionally EXCLUDES: DMs and private channels (privacy by default).
 * DMs can be included by setting credential `include_dms=true` explicitly.
 *
 * Authentication: Bot Token (xoxb-…) with scopes:
 *   channels:history, channels:read, groups:history, groups:read,
 *   pins:read, users:read (for display names)
 * Credential key: `bot_token`
 *
 * Rate limits: Slack Tier 3 = 50 req/min. We add 60ms between requests.
 * Exponential backoff on 429 honouring the Retry-After header.
 *
 * Incremental sync: channel history accepts `oldest` (Unix timestamp).
 */

import type { CloudConnector, CloudDocument, MemoryCreateInput } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('slack');

const SLACK_API_BASE   = 'https://slack.com/api';
const MAX_RETRIES      = 4;
const REQUEST_GAP_MS   = 60; // ≈50 req/min
const MAX_MESSAGES_PER_CHANNEL = 200;

// ---------------------------------------------------------------------------
// Minimal raw shapes
// ---------------------------------------------------------------------------

interface SlackChannel {
  id:         string;
  name:       string;
  is_private: boolean;
  is_im:      boolean;
  is_mpim:    boolean;
}

interface SlackMessage {
  ts:       string;   // Slack epoch string "1234567890.123456"
  text:     string;
  user?:    string;
  thread_ts?: string;
  reply_count?: number;
  pinned_to?: string[];
}

interface SlackPin {
  id:      string;
  type:    string;
  message?: SlackMessage;
}

interface SlackUser {
  id:   string;
  name: string;
  real_name?: string;
}

type UserCache = Map<string, string>;

// ---------------------------------------------------------------------------
// SlackConnector
// ---------------------------------------------------------------------------

export class SlackConnector implements CloudConnector {
  readonly name = 'Slack';
  readonly type = 'slack' as const;

  private token: string | null = null;
  private includeDMs = false;
  private lastRequestAt = 0;
  private userCache: UserCache = new Map();

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  async authenticate(credentials: Record<string, string>): Promise<void> {
    const token = credentials['bot_token'];
    if (!token || !token.startsWith('xoxb-')) {
      throw new Error(
        'SlackConnector requires a "bot_token" credential starting with "xoxb-"'
      );
    }

    // Verify by calling auth.test
    const res = await this.call('auth.test', {}, token);
    if (!res.ok) {
      throw new Error(`Slack authentication failed: ${res.error ?? 'unknown error'}`);
    }

    this.token = token;
    this.includeDMs = credentials['include_dms'] === 'true';

    log.info('Slack authentication successful', {
      team: res.team,
      botUser: res.user,
      includeDMs: this.includeDMs,
    });
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  // -------------------------------------------------------------------------
  // fetchDocuments
  // -------------------------------------------------------------------------

  async fetchDocuments(since?: Date): Promise<CloudDocument[]> {
    this.assertAuthenticated();
    log.info('Fetching Slack documents', { since: since?.toISOString() });

    const channels = await this.listChannels();
    log.info('Found Slack channels', { count: channels.length });

    const docs: CloudDocument[] = [];

    for (const channel of channels) {
      // Fetch pinned messages (highest value; always include regardless of since)
      try {
        const pins = await this.fetchPinnedMessages(channel);
        docs.push(...pins);
      } catch (err) {
        log.warn('Failed to fetch pinned messages', { channel: channel.name });
        log.error('Pins error', err instanceof Error ? err : new Error(String(err)));
      }

      // Fetch recent message history
      try {
        const history = await this.fetchChannelHistory(channel, since);
        if (history) docs.push(history);
      } catch (err) {
        log.warn('Failed to fetch channel history', { channel: channel.name });
        log.error('History error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    return docs;
  }

  // -------------------------------------------------------------------------
  // toMemory
  // -------------------------------------------------------------------------

  toMemory(doc: CloudDocument): MemoryCreateInput {
    const isPinned = doc.metadata['docType'] === 'pinned';
    return {
      content:     doc.content,
      summary:     doc.title.slice(0, 120),
      type:        isPinned ? 'context' : 'observation',
      tags:        ['slack', 'cloud', String(doc.metadata['channelName'] ?? '')].filter(Boolean),
      source:      'cloud',
      source_path: doc.url,
      metadata: {
        ...doc.metadata,
        cloudService: 'slack',
        lastModified: doc.lastModified.toISOString(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private assertAuthenticated(): void {
    if (!this.isAuthenticated()) {
      throw new Error('SlackConnector: not authenticated. Call authenticate() first.');
    }
  }

  private async call(
    method: string,
    params: Record<string, string | number | boolean>,
    token?: string,
  ): Promise<Record<string, unknown> & { ok: boolean; error?: string }> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < REQUEST_GAP_MS) {
      await sleep(REQUEST_GAP_MS - elapsed);
    }
    this.lastRequestAt = Date.now();

    const searchParams = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    );

    const res = await fetchWithBackoff(`${SLACK_API_BASE}/${method}?${searchParams}`, {
      headers: { Authorization: `Bearer ${token ?? this.token!}` },
    });

    if (!res.ok) {
      throw new Error(`Slack API HTTP error: ${res.status}`);
    }

    return res.json() as Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
  }

  private async listChannels(): Promise<SlackChannel[]> {
    const types = this.includeDMs
      ? 'public_channel,private_channel,im,mpim'
      : 'public_channel,private_channel';

    const data = await this.call('conversations.list', {
      limit: 200,
      exclude_archived: true,
      types,
    });

    if (!data.ok) {
      throw new Error(`conversations.list failed: ${data.error}`);
    }

    return (data['channels'] as SlackChannel[] | undefined) ?? [];
  }

  private async fetchPinnedMessages(channel: SlackChannel): Promise<CloudDocument[]> {
    const data = await this.call('pins.list', { channel: channel.id });
    if (!data.ok) return [];

    const pins = (data['items'] as SlackPin[] | undefined) ?? [];
    const docs: CloudDocument[] = [];

    for (const pin of pins) {
      if (!pin.message?.text) continue;

      const msg      = pin.message;
      const ts       = parseSlackTs(msg.ts);
      const userName = await this.resolveUser(msg.user);
      const url      = buildSlackUrl(channel.id, msg.ts);

      docs.push({
        id:           `slack-pin-${channel.id}-${msg.ts}`,
        title:        `Pinned in #${channel.name}: ${msg.text.slice(0, 80)}`,
        content:      `**Pinned message in #${channel.name}**\n\n${msg.text}`,
        url,
        mimeType:     'text/markdown',
        lastModified: ts,
        author:       userName,
        metadata: {
          channelId:   channel.id,
          channelName: channel.name,
          docType:     'pinned',
          ts:          msg.ts,
        },
      });
    }

    return docs;
  }

  private async fetchChannelHistory(
    channel: SlackChannel,
    since?: Date,
  ): Promise<CloudDocument | null> {
    const params: Record<string, string | number | boolean> = {
      channel: channel.id,
      limit:   MAX_MESSAGES_PER_CHANNEL,
    };

    if (since) {
      params['oldest'] = (since.getTime() / 1000).toFixed(6);
    }

    const data = await this.call('conversations.history', params);
    if (!data.ok) return null;

    const messages = (data['messages'] as SlackMessage[] | undefined) ?? [];
    if (messages.length === 0) return null;

    // Collect threads for messages with replies
    const lines: string[] = [`## #${channel.name} — recent messages\n`];

    for (const msg of messages.slice().reverse()) {
      const ts       = parseSlackTs(msg.ts);
      const userName = await this.resolveUser(msg.user);
      const dateStr  = ts.toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`**${userName}** (${dateStr}):\n${msg.text}\n`);

      // Fetch thread replies if any
      if (msg.thread_ts && msg.reply_count && msg.reply_count > 0) {
        const thread = await this.fetchThread(channel.id, msg.thread_ts);
        for (const reply of thread.slice(1)) {  // skip first (= parent)
          const rUser   = await this.resolveUser(reply.user);
          const rTs     = parseSlackTs(reply.ts).toISOString().slice(0, 16).replace('T', ' ');
          lines.push(`  > **${rUser}** (${rTs}):\n  > ${reply.text}\n`);
        }
      }
    }

    const newestTs = messages[0]?.ts ?? String(Date.now() / 1000);

    return {
      id:           `slack-history-${channel.id}`,
      title:        `#${channel.name} history`,
      content:      lines.join('\n'),
      url:          buildSlackUrl(channel.id),
      mimeType:     'text/markdown',
      lastModified: parseSlackTs(newestTs),
      metadata: {
        channelId:    channel.id,
        channelName:  channel.name,
        messageCount: messages.length,
        docType:      'channel_history',
      },
    };
  }

  private async fetchThread(channelId: string, threadTs: string): Promise<SlackMessage[]> {
    const data = await this.call('conversations.replies', {
      channel: channelId,
      ts:      threadTs,
      limit:   50,
    });

    if (!data.ok) return [];
    return (data['messages'] as SlackMessage[] | undefined) ?? [];
  }

  private async resolveUser(userId?: string): Promise<string> {
    if (!userId) return 'Unknown';
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const data = await this.call('users.info', { user: userId });
      if (data.ok) {
        const user = data['user'] as SlackUser;
        const name = user.real_name ?? user.name ?? userId;
        this.userCache.set(userId, name);
        return name;
      }
    } catch {
      // Non-critical; fallback to userId
    }

    this.userCache.set(userId, userId);
    return userId;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseSlackTs(ts: string): Date {
  const seconds = parseFloat(ts);
  return new Date(seconds * 1000);
}

function buildSlackUrl(channelId: string, ts?: string): string {
  const base = `https://app.slack.com/client/${channelId}`;
  return ts ? `${base}/${channelId}-${ts.replace('.', '')}` : base;
}

async function fetchWithBackoff(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
    const delay      = Math.max(retryAfter * 1000, Math.min(1000 * 2 ** attempt, 30_000));
    log.debug('Slack rate limited, retrying', { delay, attempt });
    await sleep(delay);
    return fetchWithBackoff(url, init, attempt + 1);
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
