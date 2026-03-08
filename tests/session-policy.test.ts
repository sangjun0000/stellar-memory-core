import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb } from './setup.js';
import {
  noteRecall,
  noteRemember,
  noteObserve,
  getSessionCommitDraft,
  clearSessionActivity,
} from '../src/engine/session-policy.js';
import { autoCommitOnClose } from '../src/engine/sun.js';
import { getSunState } from '../src/storage/queries.js';

describe('session policy', () => {
  const project = 'test';

  beforeEach(() => setupTestDb());
  afterEach(() => {
    clearSessionActivity(project);
    teardownTestDb();
  });

  it('builds a commit draft from recall and remembered memories', () => {
    noteRecall(project, 'Fix authentication migration');
    noteRemember(project, { type: 'decision', summary: 'Use PostgreSQL for auth storage', content: '' });
    noteRemember(project, { type: 'task', summary: 'Add retry logic to the auth worker', content: '' });
    noteRemember(project, { type: 'error', summary: 'Queue worker times out under load', content: '' });
    noteRemember(project, { type: 'context', summary: 'Auth service depends on Redis and PostgreSQL', content: '' });
    noteObserve(project, '2 memories from observed conversation');

    const draft = getSessionCommitDraft(project);
    expect(draft).not.toBeNull();
    expect(draft?.current_work).toBe('Fix authentication migration');
    expect(draft?.decisions).toContain('Use PostgreSQL for auth storage');
    expect(draft?.next_steps).toContain('Add retry logic to the auth worker');
    expect(draft?.errors).toContain('Queue worker times out under load');
    expect(draft?.context).toContain('Auth service depends on Redis and PostgreSQL');
  });

  it('auto-commit persists the session draft even without recent memories', () => {
    noteRecall(project, 'Stabilize Codex and Claude parity');
    noteRemember(project, { type: 'decision', summary: 'Use shared STM DB for both clients', content: '' });
    noteRemember(project, { type: 'task', summary: 'Move session automation into the MCP server', content: '' });
    noteRemember(project, { type: 'error', summary: 'Codex project detection drifted to system32', content: '' });

    autoCommitOnClose(project);

    const sun = getSunState(project);
    expect(sun).not.toBeNull();
    expect(sun?.current_work).toBe('Stabilize Codex and Claude parity');
    expect(sun?.recent_decisions).toContain('Use shared STM DB for both clients');
    expect(sun?.next_steps).toContain('Move session automation into the MCP server');
    expect(sun?.active_errors).toContain('Codex project detection drifted to system32');
  });
});
