import { registerMigration } from '../migration.js';

registerMigration({
  version: 1,
  name: 'add-intrinsic-column',
  up: (db) => {
    // intrinsic: user-set importance value.
    // NULL = use INTRINSIC_DEFAULTS[type] (backward compat).
    // Non-NULL = explicit user override, immune to recalculation.
    db.exec(`ALTER TABLE memories ADD COLUMN intrinsic REAL DEFAULT NULL;`);
  },
});
