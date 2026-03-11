/**
 * storage/queries/datasource-queries.ts — Data source management
 */

import { getDatabase } from '../database.js';
import type { DataSource } from '../../scanner/types.js';
import { asRawDataSource, deserializeDataSource } from './shared.js';

export function insertDataSource(ds: Omit<DataSource, 'created_at' | 'updated_at'>): DataSource {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO data_sources (id, path, type, status, last_scanned_at, file_count, total_size, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ds.id, ds.path, ds.type, ds.status,
    ds.last_scanned_at ?? null,
    ds.file_count ?? 0,
    ds.total_size ?? 0,
    JSON.stringify(ds.config ?? {}),
    now, now
  );

  return { ...ds, config: ds.config ?? {}, created_at: now, updated_at: now };
}

export function updateDataSource(id: string, patch: Partial<Pick<DataSource, 'status' | 'last_scanned_at' | 'file_count' | 'total_size' | 'config'>>): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (patch.status !== undefined)          { sets.push('status = ?');           values.push(patch.status); }
  if (patch.last_scanned_at !== undefined) { sets.push('last_scanned_at = ?');  values.push(patch.last_scanned_at); }
  if (patch.file_count !== undefined)      { sets.push('file_count = ?');        values.push(patch.file_count); }
  if (patch.total_size !== undefined)      { sets.push('total_size = ?');        values.push(patch.total_size); }
  if (patch.config !== undefined)          { sets.push('config = ?');            values.push(JSON.stringify(patch.config)); }

  values.push(id);
  db.prepare(`UPDATE data_sources SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getAllDataSources(): DataSource[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM data_sources ORDER BY created_at DESC`).all() as unknown[];
  return rows.map((r) => deserializeDataSource(asRawDataSource(r)));
}

export function getDataSourceByPath(path: string): DataSource | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM data_sources WHERE path = ? LIMIT 1`).get(path);
  return row ? deserializeDataSource(asRawDataSource(row)) : null;
}
