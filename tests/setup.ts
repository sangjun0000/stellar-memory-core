/**
 * Test setup — in-memory SQLite database for isolation.
 */
import { initDatabase, resetDatabase } from '../src/storage/database.js';
import { resetConfig } from '../src/utils/config.js';

export function setupTestDb(): void {
  resetDatabase();
  resetConfig();

  // Use environment variable to set DB path to in-memory
  process.env['STELLAR_DB_PATH'] = ':memory:';
  initDatabase(':memory:');
}

export function teardownTestDb(): void {
  resetDatabase();
  resetConfig();
  delete process.env['STELLAR_DB_PATH'];
}
