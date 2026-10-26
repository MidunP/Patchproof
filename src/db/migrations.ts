import fs from 'fs';
import path from 'path';
import { pool } from './client';

/**
 * Run schema.sql on startup if tables don't already exist.
 * Simple and idempotent — uses IF NOT EXISTS throughout.
 */
export async function runMigrations(): Promise<void> {
  let schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
  }
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[db] Migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
