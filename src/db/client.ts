import { Pool } from 'pg';
import { config } from '../config';

// Single connection pool shared across the app.
// pg automatically handles reconnection.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error', err.message);
});

/** Run a query against the pool. Throws on error. */
export async function query<T extends Record<string, unknown>>(
  text: string,
  values?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const result = await pool.query<T>(text, values);
  return { rows: result.rows, rowCount: result.rowCount };
}

/** Convenience: return the first row or null */
export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  values?: unknown[],
): Promise<T | null> {
  const { rows } = await query<T>(text, values);
  return rows[0] ?? null;
}
