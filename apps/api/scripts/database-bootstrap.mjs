import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const databaseDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'database');
const client = new Client({ connectionString: databaseUrl });

async function sortedSqlFiles(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
}

await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [9042026]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationDirectory = join(databaseDirectory, 'migrations');
  for (const name of await sortedSqlFiles(migrationDirectory)) {
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
      [name],
    );
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationDirectory, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (migration_name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied migration ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  const seedDirectory = join(databaseDirectory, 'seeds');
  for (const name of await sortedSqlFiles(seedDirectory)) {
    await client.query(await readFile(join(seedDirectory, name), 'utf8'));
    console.log(`Applied idempotent seed ${name}`);
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [9042026]).catch(() => undefined);
  await client.end();
}
