import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

export type DB = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: DB;
  driver: 'pglite' | 'postgres';
  close: () => Promise<void>;
}

/**
 * Opens the database. Uses DATABASE_URL (real PostgreSQL) when provided, otherwise an embedded
 * PostgreSQL engine (PGlite) persisted to data/pglite. Both expose the same Drizzle API.
 */
export async function openDatabase(opts: { databaseUrl?: string; pgliteDir?: string; memory?: boolean } = {}): Promise<DbHandle> {
  const url = opts.databaseUrl ?? config.databaseUrl;
  if (url) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: config.migrationsDir });
    return { db, driver: 'postgres', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = opts.memory ? new PGlite() : new PGlite(opts.pgliteDir ?? config.pgliteDir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: config.migrationsDir });
  return { db: db as unknown as DB, driver: 'pglite', close: () => client.close() };
}

export async function migrationStatus(db: DB): Promise<{ applied: number }> {
  const res = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  const rows = (res as unknown as { rows: { n: number }[] }).rows;
  return { applied: rows[0]?.n ?? 0 };
}
