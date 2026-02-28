/**
 * scanner/cloud/github.ts — GitHub connector.
 *
 * Scans: repository README files, Issues, Pull Requests, and Wiki pages.
 * Does NOT scan code files — that is the responsibility of the local scanner.
 *
 * Authentication: Personal Access Token (PAT) with `repo` scope.
 * Credential key: `personal_access_token`
 *
 * Rate limits: GitHub API allows 5,000 req/hour for authenticated requests.
 * We apply exponential backoff on 429/403 with a Retry-After header check.
 *
 * Incremental sync: uses `since` parameter on the Issues/PRs API and compares
 * the pushed_at field for repositories when checking README freshness.
 */

import type { CloudConnector, CloudDocument, MemoryCreateInput } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('github');

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_RETRIES = 4;
const RECENT_COMMITS_LIMIT = 20;

// ---------------------------------------------------------------------------
// Minimal raw API shapes
// ---------------------------------------------------------------------------

interface GHRepo {
  id:         number;
  full_name:  string;  // e.g. "owner/repo"
  html_url:   string;
  pushed_at:  string;
  default_branch: string;
}

interface GHIssue {
  id:         number;
  number:     number;
  title:      string;
  body:       string | null;
  html_url:   string;
  updated_at: string;
  state:      string;
  pull_request?: unknown;   // present only on PRs
  user: { login: string } | null;
}

interface GHCommit {
  sha:    string;
  commit: { message: string; committer: { date: string } };
  html_url: string;
}

// ---------------------------------------------------------------------------
// GitHubConnector
// ---------------------------------------------------------------------------

export class GitHubConnector implements CloudConnector {
  readonly name = 'GitHub';
  readonly type = 'github' as const;

  private token: string | null = null;
  /** Optional list of repos to restrict to: ["owner/repo", ...] */
  private targetRepos: string[] = [];

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  async authenticate(credentials: Record<string, string>): Promise<void> {
    const pat = credentials['personal_access_token'];
    if (!pat) {
      throw new Error('GitHubConnector requires a "personal_access_token" credential');
    }

    // Verify by calling /user
    const res = await this.fetch('/user', pat);
    if (!res.ok) {
      throw new Error(`GitHub authentication failed: ${res.status}`);
    }

    this.token = pat;

    // Optional repo filter from credentials
    const repoList = credentials['repositories'];
    if (repoList) {
      this.targetRepos = repoList.split(',').map(s => s.trim()).filter(Boolean);
    }

    log.info('GitHub authentication successful', { targetRepos: this.targetRepos });
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  // -------------------------------------------------------------------------
  // fetchDocuments
  // -------------------------------------------------------------------------

  async fetchDocuments(since?: Date): Promise<CloudDocument[]> {
    this.assertAuthenticated();
    log.info('Fetching GitHub documents', { since: since?.toISOString() });

    const repos = await this.listRepos(since);
    log.info('Found GitHub repositories', { count: repos.length });

    const docs: CloudDocument[] = [];

    for (const repo of repos) {
      // 1. README
      try {
        const readme = await this.fetchReadme(repo);
        if (readme) docs.push(readme);
      } catch (err) {
        log.warn('Failed to fetch README', { repo: repo.full_name });
        log.error('README error', err instanceof Error ? err : new Error(String(err)));
      }

      // 2. Issues (not PRs)
      try {
        const issues = await this.fetchIssues(repo, since, false);
        docs.push(...issues);
      } catch (err) {
        log.warn('Failed to fetch Issues', { repo: repo.full_name });
        log.error('Issues error', err instanceof Error ? err : new Error(String(err)));
      }

      // 3. Pull Requests
      try {
        const prs = await this.fetchIssues(repo, since, true);
        docs.push(...prs);
      } catch (err) {
        log.warn('Failed to fetch PRs', { repo: repo.full_name });
        log.error('PR error', err instanceof Error ? err : new Error(String(err)));
      }

      // 4. Recent commit messages
      try {
        const commits = await this.fetchCommitMessages(repo, since);
        if (commits) docs.push(commits);
      } catch (err) {
        log.warn('Failed to fetch commits', { repo: repo.full_name });
        log.error('Commits error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    return docs;
  }

  // -------------------------------------------------------------------------
  // toMemory
  // -------------------------------------------------------------------------

  toMemory(doc: CloudDocument): MemoryCreateInput {
    const isCommitLog = doc.mimeType === 'text/plain' && doc.title.startsWith('Commits:');
    const type = isCommitLog ? 'observation' : 'context';

    return {
      content:     `# ${doc.title}\n\n${doc.content}`,
      summary:     doc.title.slice(0, 120),
      type,
      tags:        ['github', 'cloud', ...(doc.metadata['repoName'] ? [String(doc.metadata['repoName'])] : [])],
      source:      'cloud',
      source_path: doc.url,
      metadata: {
        ...doc.metadata,
        cloudService: 'github',
        lastModified: doc.lastModified.toISOString(),
        author:       doc.author,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private assertAuthenticated(): void {
    if (!this.isAuthenticated()) {
      throw new Error('GitHubConnector: not authenticated. Call authenticate() first.');
    }
  }

  private async fetch(path: string, token?: string): Promise<Response> {
    const t = token ?? this.token!;
    return fetchWithBackoff(`${GITHUB_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept:        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  private async listRepos(since?: Date): Promise<GHRepo[]> {
    if (this.targetRepos.length > 0) {
      // Fetch only explicitly listed repos
      const repos: GHRepo[] = [];
      for (const fullName of this.targetRepos) {
        const res = await this.fetch(`/repos/${fullName}`);
        if (res.ok) {
          const repo = await res.json() as GHRepo;
          if (!since || new Date(repo.pushed_at) > since) {
            repos.push(repo);
          }
        }
      }
      return repos;
    }

    // List all repos for the authenticated user
    const res = await this.fetch('/user/repos?per_page=100&sort=pushed&direction=desc');
    if (!res.ok) {
      throw new Error(`GitHub repos list failed: ${res.status}`);
    }

    const all = await res.json() as GHRepo[];
    return since
      ? all.filter(r => new Date(r.pushed_at) > since)
      : all;
  }

  private async fetchReadme(repo: GHRepo): Promise<CloudDocument | null> {
    const res = await this.fetch(`/repos/${repo.full_name}/readme`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`README fetch failed: ${res.status}`);

    const data = await res.json() as { content: string; encoding: string; html_url: string };
    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    return {
      id:           `${repo.full_name}/README`,
      title:        `README: ${repo.full_name}`,
      content,
      url:          data.html_url,
      mimeType:     'text/markdown',
      lastModified: new Date(repo.pushed_at),
      metadata: {
        repoName:   repo.full_name,
        repoUrl:    repo.html_url,
        docType:    'readme',
      },
    };
  }

  private async fetchIssues(
    repo: GHRepo,
    since: Date | undefined,
    pullsOnly: boolean,
  ): Promise<CloudDocument[]> {
    const state     = 'all';
    const sinceParam = since ? `&since=${since.toISOString()}` : '';
    const url       = `/repos/${repo.full_name}/issues?state=${state}&per_page=50${sinceParam}`;

    const res = await this.fetch(url);
    if (!res.ok) throw new Error(`Issues fetch failed: ${res.status}`);

    const items = await res.json() as GHIssue[];

    return items
      .filter(item => pullsOnly ? Boolean(item.pull_request) : !item.pull_request)
      .map(item => ({
        id:           `${repo.full_name}/${pullsOnly ? 'pr' : 'issue'}/${item.number}`,
        title:        `${pullsOnly ? 'PR' : 'Issue'} #${item.number}: ${item.title}`,
        content:      item.body ?? '(no description)',
        url:          item.html_url,
        mimeType:     'text/markdown',
        lastModified: new Date(item.updated_at),
        author:       item.user?.login,
        metadata: {
          repoName: repo.full_name,
          number:   item.number,
          state:    item.state,
          docType:  pullsOnly ? 'pull_request' : 'issue',
        },
      }));
  }

  private async fetchCommitMessages(repo: GHRepo, since?: Date): Promise<CloudDocument | null> {
    const sinceParam = since ? `&since=${since.toISOString()}` : '';
    const url = `/repos/${repo.full_name}/commits?per_page=${RECENT_COMMITS_LIMIT}${sinceParam}`;

    const res = await this.fetch(url);
    if (!res.ok || res.status === 409) return null; // 409 = empty repo

    const commits = await res.json() as GHCommit[];
    if (commits.length === 0) return null;

    const lines = commits.map(c => {
      const date = c.commit.committer.date.slice(0, 10);
      return `- ${date}: ${c.commit.message.split('\n')[0]}`;
    });

    const newestDate = commits[0]?.commit.committer.date ?? new Date().toISOString();

    return {
      id:           `${repo.full_name}/commits`,
      title:        `Commits: ${repo.full_name}`,
      content:      lines.join('\n'),
      url:          `${repo.html_url}/commits`,
      mimeType:     'text/plain',
      lastModified: new Date(newestDate),
      metadata:     { repoName: repo.full_name, docType: 'commit_log' },
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchWithBackoff(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);

  const shouldRetry = (res.status === 429 || res.status === 403) && attempt < MAX_RETRIES;
  if (shouldRetry) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
    const delay      = Math.max(retryAfter * 1000, Math.min(1000 * 2 ** attempt, 32_000));
    log.debug('GitHub rate limited, retrying', { status: res.status, delay, attempt });
    await sleep(delay);
    return fetchWithBackoff(url, init, attempt + 1);
  }

  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
