import { describe, it, expect } from 'vitest';
import { shouldPersistObservation } from '../src/engine/observation.js';

describe('shouldPersistObservation', () => {
  it('rejects low-signal conversational filler', () => {
    expect(shouldPersistObservation('Sounds good, thanks for the update.', 'context')).toBe(false);
    expect(shouldPersistObservation('Can you check that later?', 'task')).toBe(false);
  });

  it('keeps concrete decisions and implementation tasks', () => {
    expect(
      shouldPersistObservation('We decided to migrate the auth database schema to PostgreSQL this sprint.', 'decision'),
    ).toBe(true);
    expect(
      shouldPersistObservation('Next step: add retry logic to the queue worker before release.', 'task'),
    ).toBe(true);
  });
});
