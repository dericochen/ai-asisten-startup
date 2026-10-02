import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-delivery-'));
process.env.ACO_DATA_DIR = root;
let close: () => Promise<void>;
let deploy: import('../src/services/deploy.js').DeploymentService;
let db: import('../src/db/client.js').DB;
let git: import('../src/services/git.js').GitService;
let schema: typeof import('../src/db/schema.js');
beforeAll(async () => {
  const { openDatabase } = await import('../src/db/client.js');
  ({ db, close } = await openDatabase({ memory: true, databaseUrl: '' }));
  schema = await import('../src/db/schema.js');
  const { GitService } = await import('../src/services/git.js'); git = new GitService();
  const { DeploymentService } = await import('../src/services/deploy.js');
  deploy = new DeploymentService(db, { emit: async () => {} } as any, { log: async () => {} } as any, git, {} as any);
});
afterAll(async () => {
  if (deploy) for (const d of await deploy.list()) if (d.active) await deploy.stopDeployment(d.id, 'STOPPED');
  await close?.(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); return port;
}
it('builds and tests an application, validates staging and production, monitors it, then restores a healthy release', async () => {
  const { npmScript, httpSmoke, securityHeaders } = await import('../src/services/quality.js');
  const { MonitoringService } = await import('../src/services/deploy.js');
  const workspace = path.join(root, 'repo');
  await git.init(workspace, { code: 'PRJ-DOCKER', name: 'Delivery fixture', objective: 'Verify real isolated delivery' });
  const packageJson = { name: 'delivery-fixture', type: 'module', scripts: { start: 'node app.mjs', build: 'node --check app.mjs', test: 'node --test app.test.mjs' } };
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(workspace, 'app.mjs'), `import http from 'node:http';
http.createServer((req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
if(req.url==='/api/health'){res.setHeader('Content-Type','application/json');res.end('{"status":"ok"}');}
else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><title>Delivery fixture</title><body>Healthy release</body></html>');}
}).listen(Number(process.env.PORT),process.env.HOST || '0.0.0.0');`);
  fs.writeFileSync(path.join(workspace, 'app.test.mjs'), `import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('host credentials are absent and Git metadata is masked',()=>{assert.equal(process.env.ACO_MASTER_KEY,undefined);assert.equal(fs.readdirSync('.git').length,0);});`);
  await git.commitAll(workspace, 'Add delivery fixture', { name: 'Test', email: 'test@example.invalid' });
  const build = await npmScript(workspace, 'build', true);
  expect(build.status, build.details).toBe('PASS');
  expect((await npmScript(workspace, 'test', true)).status).toBe('PASS');
  const project = { id: crypto.randomUUID(), code: 'PRJ-DOCKER', workspacePath: workspace, deployment: { provider: 'LOCAL_PROCESS', stagingPort: await freePort(), productionPort: await freePort(), healthPath: '/api/health' } } as any;
  const release = await deploy.createRelease(project, 'Verified fixture');
  const contract = { healthPath: '/api/health', routes: ['/'], apiChecks: [] };
  for (const environment of ['STAGING', 'PRODUCTION'] as const) {
    const d = await deploy.deploy(project, release, environment);
    expect(d.status, d.log).toBe('RUNNING');
    const checks = await httpSmoke(d.url!, contract);
    expect(checks.every((c) => c.status === 'PASS' || c.status === 'SKIP')).toBe(true);
    expect((await securityHeaders(d.url!)).status).toBe('PASS'); await deploy.markHealth(d.id, true);
  }
  await deploy.setReleaseStatus(release.id, 'HEALTHY');
  const production = await deploy.active(project.id, 'PRODUCTION');
  const monitor = new MonitoringService(db, {} as any, { openFor: async () => [], open: async () => {} } as any);
  for (let i=0;i<3;i++) expect(await monitor.sample(project, 'PRODUCTION', production!.url!)).toBe(true);
  expect((await monitor.recent(project.id)).length).toBe(3);
  fs.appendFileSync(path.join(workspace, 'app.mjs'), '\n// second release\n');
  await git.commitAll(workspace, 'Second release', { name: 'Test', email: 'test@example.invalid' });
  const next = await deploy.createRelease(project, 'Second fixture');
  const replacement = await deploy.deploy(project, next, 'PRODUCTION'); expect(replacement.status, replacement.log).toBe('RUNNING');
  await deploy.markHealth(replacement.id, false);
  const restored = await deploy.rollback(project, replacement);
  expect(restored?.releaseId).toBe(release.id);
  expect((await fetch(restored!.url! + '/api/health')).status).toBe(200);
});
