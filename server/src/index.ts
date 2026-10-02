import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config, ensureDirs } from './config.js';
import { openDatabase } from './db/client.js';
import { buildServices } from './core/container.js';
import { WorkflowEngine } from './workflow/engine.js';
import { CeoService } from './services/ceo.js';
import { registerAuth, needsSetup } from './api/auth.js';
import { registerCompanyRoutes } from './api/company.js';
import { registerProjectRoutes } from './api/projects.js';
import { registerRuntimeRoutes, systemHealth } from './api/runtime.js';
import { writeAgentProfiles } from './kiro/agents.js';

async function main() {
  ensureDirs();
  const handle = await openDatabase();
  const s = await buildServices(handle.db);
  const engine = new WorkflowEngine(s);
  const ceo = new CeoService(s, () => engine.kick());

  s.kiro.on('health', (h: { previous: string; health: string; reason: string }) => {
    const type = h.health === 'LIMITED' ? 'KIRO_LIMIT_REACHED' : h.health === 'UNAVAILABLE' ? 'KIRO_UNAVAILABLE' : 'KIRO_STATUS_CHANGED';
    void s.bus.emit(type, `Kiro runtime ${h.previous} → ${h.health}: ${h.reason}`, { data: h });
    if (h.health === 'LIMITED' || h.health === 'UNAVAILABLE') void s.notify.notifyOwner({ category: 'FALLBACK', severity: 'WARNING', title: `Kiro ${h.health.toLowerCase()}`, body: h.reason });
  });

  const app = Fastify({ logger: { level: process.env.ACO_LOG_LEVEL ?? 'warn' }, bodyLimit: 2 * 1024 * 1024, trustProxy: false });
  await app.register(cookie);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body ?? '');
    if (!text.trim()) return done(null, {});
    try { done(null, JSON.parse(text)); } catch { const err = new Error('Invalid JSON body') as Error & { statusCode: number }; err.statusCode = 400; done(err, undefined); }
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  });
  registerAuth(app, s);
  registerCompanyRoutes(app, s, ceo);
  registerProjectRoutes(app, s, engine);
  registerRuntimeRoutes(app, s, engine, handle.driver);

  // Startup checks: Kiro detection + profiles, crash recovery, background loops.
  await s.kiro.detect();
  if (!(await needsSetup(s))) writeAgentProfiles(config.kiroHome);
  await s.executor.refreshCredits();
  await engine.recover();
  const projectsById = new Map((await s.projects.list()).map((p) => [p.id, p]));
  void s.deploy.restore(projectsById);
  if (!config.disableBackground) { engine.start(config.orchestratorIntervalMs); engine.startMonitoring(); }
  setInterval(() => { void s.kiro.detect(); }, 5 * 60_000).unref();

  await app.listen({ port: config.port, host: config.host });
  const health = await systemHealth(s, engine, handle.driver);
  console.log(`\nAI Startup Company OS — control plane on http://${config.host}:${config.port}`);
  for (const c of health.checks) console.log(`  ${c.ok ? '✔' : '✖'} ${c.label.padEnd(22)} ${c.detail}`);

  const shutdown = async () => {
    engine.stopAll();
    s.kiro.shutdown();
    s.deploy.shutdown();
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e) => { console.error(e); process.exit(1); });
