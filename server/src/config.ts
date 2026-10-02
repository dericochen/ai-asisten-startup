import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const dataDir = path.resolve(env('ACO_DATA_DIR', path.join(REPO_ROOT, 'data')));

export const config = {
  port: Number(env('ACO_PORT', '4100')),
  host: env('ACO_HOST', '127.0.0.1'),
  webOrigin: env('ACO_WEB_ORIGIN', 'http://localhost:3000'),
  dataDir,
  /** When set, a real PostgreSQL server is used; otherwise an embedded PostgreSQL (PGlite) in dataDir. */
  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDir: path.join(dataDir, 'pglite'),
  kiroHome: path.join(dataDir, 'kiro-home'),
  kiroRuntimeCwd: path.join(dataDir, 'kiro-runtime'),
  kiroCliPath: env('KIRO_CLI_PATH', 'kiro-cli'),
  workspacesDir: path.join(dataDir, 'workspaces'),
  deployDir: path.join(dataDir, 'deploy'),
  secretsDir: path.join(dataDir, 'secrets'),
  migrationsDir: path.join(SERVER_ROOT, 'drizzle'),
  /** Port range used by the local-process deployment adapter. */
  stagingPortBase: Number(env('ACO_STAGING_PORT_BASE', '4300')),
  productionPortBase: Number(env('ACO_PRODUCTION_PORT_BASE', '4500')),
  qaPortBase: Number(env('ACO_QA_PORT_BASE', '4700')),
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
  orchestratorIntervalMs: Number(env('ACO_TICK_MS', '3000')),
  /** Disable background loops (used by tests). */
  disableBackground: env('ACO_DISABLE_BACKGROUND', '') === '1',
  isTest: process.env.VITEST === 'true',
};

export function ensureDirs(): void {
  for (const d of [config.dataDir, config.kiroHome, path.join(config.kiroHome, 'agents'), config.kiroRuntimeCwd, config.workspacesDir, config.deployDir, config.secretsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
