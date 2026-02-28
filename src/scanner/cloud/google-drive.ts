/**
 * scanner/cloud/google-drive.ts — Google Drive connector.
 *
 * Supports both Service Account (server-to-server) and OAuth2 personal auth.
 * Documents are exported as text/plain so binary formats (Sheets, Slides) are
 * readable without additional parsers.
 *
 * Required credentials (one of two modes):
 *   Service Account: { client_email, private_key }
 *   OAuth2 personal: { client_id, client_secret, refresh_token }
 *
 * Required env var (or pass as credential):
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID — optional; if set, scan is scoped to that folder
 *
 * Rate limits: Google Drive API v3 — 10 requests/second for metadata,
 * 1 request/second for export. We apply exponential backoff on 429/503.
 */

import type { CloudConnector, CloudDocument, MemoryCreateInput } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('google-drive');

// ---------------------------------------------------------------------------
// Internal auth state
// ---------------------------------------------------------------------------

interface GoogleAuthState {
  mode: 'service-account' | 'oauth2';
  accessToken: string;
  expiresAt: Date;
  credentials: Record<string, string>;
}

// ---------------------------------------------------------------------------
// GoogleDriveConnector
// ---------------------------------------------------------------------------

export class GoogleDriveConnector implements CloudConnector {
  readonly name = 'Google Drive';
  readonly type = 'google-drive' as const;

  private auth: GoogleAuthState | null = null;

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  async authenticate(credentials: Record<string, string>): Promise<void> {
    validateCredentials(credentials);

    const mode = credentials['client_email']
      ? 'service-account'
      : 'oauth2';

    log.info('Authenticating with Google Drive', { mode });

    const accessToken = await fetchAccessToken(mode, credentials);
    this.auth = {
      mode,
      accessToken,
      expiresAt: new Date(Date.now() + 55 * 60 * 1000), // 55 min (tokens last 60)
      credentials,
    };

    log.info('Google Drive authentication successful', { mode });
  }

  isAuthenticated(): boolean {
    return this.auth !== null && new Date() < this.auth.expiresAt;
  }

  // -------------------------------------------------------------------------
  // fetchDocuments
  // -------------------------------------------------------------------------

  async fetchDocuments(since?: Date): Promise<CloudDocument[]> {
    this.assertAuthenticated();

    // Refresh token if within 2 minutes of expiry
    if (this.auth && new Date() >= new Date(this.auth.expiresAt.getTime() - 120_000)) {
      await this.refreshToken();
    }

    const query = buildDriveQuery(since);
    log.info('Fetching Google Drive documents', { since: since?.toISOString(), query });

    const files = await listFiles(this.auth!.accessToken, query);
    log.info('Found files in Google Drive', { count: files.length });

    const docs: CloudDocument[] = [];
    for (const file of files) {
      try {
        const content = await exportFileContent(this.auth!.accessToken, file.id, file.mimeType);
        docs.push({
          id:           file.id,
          title:        file.name,
          content,
          url:          `https://drive.google.com/file/d/${file.id}/view`,
          mimeType:     file.mimeType,
          lastModified: new Date(file.modifiedTime),
          author:       file.owners?.[0]?.displayName,
          metadata: {
            driveId:        file.id,
            webViewLink:    file.webViewLink,
            iconLink:       file.iconLink,
            owners:         file.owners,
            sharedWithMe:   file.sharedWithMe ?? false,
          },
        });
      } catch (err) {
        log.warn('Failed to export Google Drive file', { fileId: file.id, name: file.name });
        log.error('Export error', err instanceof Error ? err : new Error(String(err)));
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
      tags:        ['google-drive', 'cloud'],
      source:      'cloud',
      source_path: doc.url,
      metadata: {
        ...doc.metadata,
        cloudService: 'google-drive',
        lastModified: doc.lastModified.toISOString(),
        author:       doc.author,
        mimeType:     doc.mimeType,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private assertAuthenticated(): void {
    if (!this.isAuthenticated()) {
      throw new Error('GoogleDriveConnector: not authenticated. Call authenticate() first.');
    }
  }

  private async refreshToken(): Promise<void> {
    if (!this.auth) return;
    log.debug('Refreshing Google Drive access token');
    const token = await fetchAccessToken(this.auth.mode, this.auth.credentials);
    this.auth.accessToken = token;
    this.auth.expiresAt = new Date(Date.now() + 55 * 60 * 1000);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers — thin wrappers over fetch with exponential backoff
// ---------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  iconLink: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  sharedWithMe?: boolean;
}

const GOOGLE_API_BASE = 'https://www.googleapis.com';
const MAX_RETRIES = 4;

async function fetchWithBackoff(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
    const delay = Math.min(1000 * 2 ** attempt, 16_000);
    log.debug('Rate limited, retrying', { status: res.status, delay, attempt });
    await sleep(delay);
    return fetchWithBackoff(url, init, attempt + 1);
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAccessToken(
  mode: 'service-account' | 'oauth2',
  credentials: Record<string, string>,
): Promise<string> {
  if (mode === 'service-account') {
    return fetchServiceAccountToken(credentials);
  }
  return fetchOAuth2Token(credentials);
}

async function fetchServiceAccountToken(credentials: Record<string, string>): Promise<string> {
  // Build a signed JWT and exchange it for an access token using Google's token endpoint.
  // In production this would use the googleapis library; here we call the REST endpoint
  // directly to keep the implementation self-contained without requiring the npm package
  // at type-check time (the dep is declared in package.json).
  const { client_email, private_key } = credentials;
  if (!client_email || !private_key) {
    throw new Error('Service account credentials must include client_email and private_key');
  }

  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  // Sign the JWT using the private key via Node.js crypto (available natively)
  const { createSign } = await import('node:crypto');
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claim));
  const input   = `${header}.${payload}`;

  const signer = createSign('SHA256');
  signer.update(input);
  const signature = signer.sign(private_key, 'base64url');
  const jwt = `${input}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch service account token: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function fetchOAuth2Token(credentials: Record<string, string>): Promise<string> {
  const { client_id, client_secret, refresh_token } = credentials;
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('OAuth2 credentials must include client_id, client_secret, and refresh_token');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh OAuth2 token: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

async function listFiles(accessToken: string, query: string): Promise<DriveFile[]> {
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,owners,sharedWithMe)';
  const params = new URLSearchParams({
    q:        query,
    fields,
    pageSize: '100',
    orderBy:  'modifiedTime desc',
  });

  const url = `${GOOGLE_API_BASE}/drive/v3/files?${params}`;
  const res = await fetchWithBackoff(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive files.list failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { files: DriveFile[] };
  return data.files ?? [];
}

async function exportFileContent(
  accessToken: string,
  fileId: string,
  mimeType: string,
): Promise<string> {
  let url: string;

  if (isGoogleDoc(mimeType)) {
    // Google Workspace formats must be exported
    const exportMime = getExportMime(mimeType);
    url = `${GOOGLE_API_BASE}/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  } else {
    // Binary or text files can be downloaded directly
    url = `${GOOGLE_API_BASE}/drive/v3/files/${fileId}?alt=media`;
  }

  const res = await fetchWithBackoff(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Export failed for file ${fileId}: ${res.status}`);
  }

  return res.text();
}

function isGoogleDoc(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.');
}

function getExportMime(googleMime: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.document':     'text/plain',
    'application/vnd.google-apps.spreadsheet':  'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing':      'image/svg+xml',
  };
  return map[googleMime] ?? 'text/plain';
}

function buildDriveQuery(since?: Date): string {
  const parts: string[] = [
    'trashed = false',
    '(mimeType = "text/plain" or mimeType = "text/markdown" or ' +
    'mimeType = "application/vnd.google-apps.document" or ' +
    'mimeType = "application/vnd.google-apps.spreadsheet" or ' +
    'mimeType = "application/pdf")',
  ];

  if (since) {
    parts.push(`modifiedTime > "${since.toISOString()}"`);
  }

  const rootFolder = process.env['GOOGLE_DRIVE_ROOT_FOLDER_ID'];
  if (rootFolder) {
    parts.push(`"${rootFolder}" in parents`);
  }

  return parts.join(' and ');
}

function validateCredentials(credentials: Record<string, string>): void {
  const hasServiceAccount = credentials['client_email'] && credentials['private_key'];
  const hasOAuth2 =
    credentials['client_id'] && credentials['client_secret'] && credentials['refresh_token'];

  if (!hasServiceAccount && !hasOAuth2) {
    throw new Error(
      'GoogleDriveConnector requires either service account credentials ' +
      '(client_email + private_key) or OAuth2 credentials ' +
      '(client_id + client_secret + refresh_token)'
    );
  }
}
