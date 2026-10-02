import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import { npmInstall, npmScript, startApp } from '../src/services/quality.js';

vi.mock('../src/services/quality.js', () => ({ npmInstall: vi.fn(), npmScript: vi.fn(), startApp: vi.fn() }));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-deploy-test-'));
process.env.ACO_DATA_DIR = root;
let db: import('../src/db/client.js').DB;
let close: () => Promise<void>;
let service: import('../src/services/deploy.js').DeploymentService;
let schema: typeof import('../src/db/schema.js');
const emit = vi.fn(async () => {});
beforeAll(async () => {
  const { openDatabase } = await import('../src/db/client.js');
  ({ db, close } = await openDatabase({ memory: true, databaseUrl: '' }));
  schema = await import('../src/db/schema.js');
  const { DeploymentService } = await import('../src/services/deploy.js');
  service = new DeploymentService(db, { emit } as any, { log: async () => {} } as any, { addDetachedWorktree: async () => {} } as any, {} as any);
});
afterAll(async () => { service?.shutdown(); await close?.(); fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  vi.mocked(npmInstall).mockResolvedValue({ name: 'install', status: 'PASS', details: '', durationMs: 0 });
  vi.mocked(npmScript).mockResolvedValue({ name: 'build', status: 'PASS', details: '', durationMs: 0 });
  vi.mocked(startApp).mockReset().mockImplementation(async () => ({ child: new EventEmitter() as any, port: 4555, baseUrl: 'http://localhost:4555', logs: () => '', stop: async () => {} }));
  emit.mockClear();
});
async function setup() {
  const id = crypto.randomUUID();
  const project = { id, code: `PRJ-${id}`, workspacePath: root, deployment: { provider: 'LOCAL_PROCESS', productionPort: 4555, healthPath: '/api/health' } } as any;
  const [old] = await db.insert(schema.releases).values({ projectId: id, version: '0.1.0', commit: 'old', status: 'HEALTHY' }).returning();
  const dep = await service.deploy(project, old, 'PRODUCTION'); await service.markHealth(dep.id, true);
  const [next] = await db.insert(schema.releases).values({ projectId: id, version: '0.2.0', commit: 'next' }).returning();
  return { project, old, dep, next };
}
describe('production recovery', () => {
  it('restores the previous healthy release even after its deployment was STOPPED', async () => {
    const { project, old, dep, next } = await setup();
    const newer = await service.deploy(project, next, 'PRODUCTION');
    const [stopped] = await db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id));
    expect(stopped.status).toBe('STOPPED');
    await service.markHealth(newer.id, false);
    const restored = await service.rollback(project, newer);
    expect(restored?.releaseId).toBe(old.id); expect(restored?.status).toBe('RUNNING');
    expect((await service.active(project.id, 'PRODUCTION'))?.id).toBe(restored?.id);
  });
  it('automatically recovers when the replacement cannot start', async () => {
    const { project, old, next } = await setup();
    vi.mocked(startApp).mockRejectedValueOnce(new Error('New version failed to start'));
    expect((await service.deploy(project, next, 'PRODUCTION')).status).toBe('FAILED');
    expect((await service.active(project.id, 'PRODUCTION'))?.releaseId).toBe(old.id);
  });
  it('does not announce successful rollback when recovery fails', async () => {
    const { project, next } = await setup(); const newer = await service.deploy(project, next, 'PRODUCTION');
    vi.mocked(startApp).mockRejectedValueOnce(new Error('Old version cannot start'));
    emit.mockClear(); expect(await service.rollback(project, newer)).toBeNull();
    expect(emit.mock.calls.some((args: unknown[]) => args[0] === 'ROLLBACK')).toBe(false);
  });
});
