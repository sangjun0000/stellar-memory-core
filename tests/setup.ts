/**
 * Test setup — in-memory SQLite database for isolation.
 */
import { initDatabase, resetDatabase } from '../src/storage/database.js';
import { resetConfig } from '../src/utils/config.js';
import { _resetPipeline, _setPipelineForTest } from '../src/engine/embedding.js';

/**
 * Mock pipeline that throws, ensuring vector search is skipped in tests.
 * recallMemoriesAsync catches embedding errors and falls back to FTS5-only,
 * which is the behavior tests were written against.
 * Tests that specifically need embeddings (embedding.test.ts) set their own mock.
 */
function makeDisabledMock() {
  return async () => {
    throw new Error('Embedding disabled in tests');
  };
}

export function setupTestDb(): void {
  resetDatabase();
  resetConfig();

  // Disable real embedding pipeline so vector search is skipped in tests.
  // This ensures tests rely on FTS5-only, matching original test assumptions.
  _resetPipeline();
  _setPipelineForTest(makeDisabledMock());

  // Use environment variable to set DB path to in-memory
  process.env['STELLAR_DB_PATH'] = ':memory:';
  initDatabase(':memory:');
}

export function teardownTestDb(): void {
  resetDatabase();
  resetConfig();
  _resetPipeline();
  delete process.env['STELLAR_DB_PATH'];
}
