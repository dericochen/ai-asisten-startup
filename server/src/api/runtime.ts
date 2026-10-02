import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agentRuns, toolCalls } from '../db/schema.js';
import type { Services } from '../core/container.js';
import type { WorkflowEngine } from '../workflow/engine.js';
import { migrationStatus } from '../db/client.js';
import { writeAgentProfiles } from '../kiro/agents.js';
import { PROVIDER_DEFAULTS } from '../fallback/providers.js';
import { config } from '../config.js';
import { run } from '../lib/proc.js';
import { processEnvironment } from '../lib/sandbox.js';

const PROVIDERS = ['OPENROUTER', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE', 'OLLAMA'] as const;

export async function systemHealth(s: Services, engine: WorkflowEngine, driver: string) {
  const checks: { key: string; label: string; ok: boolean; detail: string }[] = [];
  try { await s.db.execute(sql`select 1`); checks.push({ key: 'database', label: 'Database', ok: true, detail: driver === 'pglite' ? 'Embedded PostgreSQL (PGlite)' : 'PostgreSQL server' }); }
  catch (e) { checks.push({ key: 'database', label: 'Database', ok: false, detail: String((e as Error).message) }); }
  try { const m = await migrationStatus(s.db); checks.push({ key: 'migrations', label: 'Migrations', ok: m.applied > 0, detail: `${m.applied} applied` }); }
  catch (e) { checks.push({ key: 'migrations', label: 'Migrations', ok: false, detail: String((e as Error).message) }); }
  const docker = await run('docker', ['info', '--format', '{{.OSType}}'], { env: processEnvironment(), timeoutMs: 5000 });
  const sandboxReady = docker.code === 0 && docker.stdout.trim() === 'linux';
  checks.push({ key: 'sandbox', label: 'Application sandbox', ok: sandboxReady, detail: sandboxReady ? 'Docker Linux containers ready' : 'Start Docker Desktop with Linux containers to build, test and run generated apps.' });
  const k = s.kiro.detection;
  checks.push({ key: 'kiro', label: 'Kiro CLI', ok: k.installed, detail: k.installed ? `v${k.version}` : k.error ?? 'Not detected' });
  checks.push({ key: 'kiroAuth', label: 'Kiro authentication', ok: k.authenticated, detail: k.authenticated ? `Signed in (${k.authMethod ?? 'unknown method'})` : k.error ?? 'Not signed in' });
  const profiles = fs.existsSync(`${config.kiroHome}/agents`) ? fs.readdirSync(`${config.kiroHome}/agents`).filter((f) => f.startsWith('aco-')).length : 0;
  checks.push({ key: 'agents', label: 'Kiro agent profiles', ok: profiles > 0, detail: `${profiles} company profiles in isolated KIRO_HOME` });
  const st = s.kiro.status();
  checks.push({ key: 'workers', label: 'Workers', ok: true, detail: `${st.workers.length}/${st.poolSize} Kiro workers, ${engine.running} task(s) executing` });
  checks.push({ key: 'queue', label: 'Queue', ok: true, detail: `${st.queuedJobs} queued Kiro job(s); persistent task queue in database` });
  const conns = await s.fallback.usable();
  checks.push({ key: 'fallback', label: 'Fallback', ok: true, detail: s.policies().fallbackEnabled ? `${conns.length} enabled connection(s), mode ${s.policies().fallbackMode}` : 'Not enabled (optional)' });
  let wsOk = false;
  try { fs.accessSync(config.workspacesDir, fs.constants.W_OK); wsOk = true; } catch { /* not writable */ }
  checks.push({ key: 'workspaces', label: 'Project workspaces', ok: wsOk, detail: config.workspacesDir });
  const g = await s.git.available();
  checks.push({ key: 'git', label: 'Git', ok: g.ok, detail: g.version ?? 'git not found' });
  return { ok: checks.every((c) => c.ok || c.key === 'fallback'), checks };
}

export function registerRuntimeRoutes(app: FastifyInstance, s: Services, engine: WorkflowEngine, driver: string) {
  const db = s.db;
  const owner = (req: { owner?: { id: string; displayName: string } }) => ({ type: 'OWNER' as const, id: req.owner!.id, name: req.owner!.displayName });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/system/health', async () => systemHealth(s, engine, driver));

  app.get('/api/runtime/kiro', async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = await db.select({ runtime: agentRuns.runtime, provider: agentRuns.provider, status: agentRuns.status, n: sql<number>`count(*)::int`, credits: sql<number>`coalesce(sum(${agentRuns.credits}),0)::float`, usd: sql<number>`coalesce(sum(${agentRuns.costUsd}),0)::float` }).from(agentRuns).where(gte(agentRuns.createdAt, start)).groupBy(agentRuns.runtime, agentRuns.provider, agentRuns.status);
    return { status: s.kiro.status(), today, policies: { fallbackEnabled: s.policies().fallbackEnabled, fallbackMode: s.policies().fallbackMode, kiro: s.policies().kiro } };
  });

  app.post('/api/runtime/kiro/detect', async (req) => {
    const d = await s.kiro.detect();
    const profiles = writeAgentProfiles(config.kiroHome);
    await s.audit.log(owner(req), 'kiro.detect', null, { installed: d.installed, authenticated: d.authenticated, profilesWritten: profiles.written });
    return { detection: d, profiles };
  });

  app.get('/api/runtime/runs', async (req) => {
    const { runtime } = req.query as { runtime?: string };
    const rows = await db.select({ id: agentRuns.id, taskId: agentRuns.taskId, projectId: agentRuns.projectId, employeeId: agentRuns.employeeId, runtime: agentRuns.runtime, provider: agentRuns.provider, model: agentRuns.model, agentProfile: agentRuns.agentProfile, workerId: agentRuns.workerId, kiroSessionId: agentRuns.kiroSessionId, status: agentRuns.status, errorClass: agentRuns.errorClass, errorMessage: agentRuns.errorMessage, fallbackReason: agentRuns.fallbackReason, toolCalls: agentRuns.toolCalls, credits: agentRuns.credits, costUsd: agentRuns.costUsd, costEstimated: agentRuns.costEstimated, durationMs: agentRuns.durationMs, attempt: agentRuns.attempt, createdAt: agentRuns.createdAt })
      .from(agentRuns).where(runtime ? eq(agentRuns.runtime, runtime as 'KIRO') : undefined).orderBy(desc(agentRuns.createdAt)).limit(200);
    return { runs: rows };
  });

  app.get('/api/runtime/runs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const run = (await db.select().from(agentRuns).where(eq(agentRuns.id, id)))[0];
    if (!run) return reply.code(404).send({ error: 'Not found' });
    return { run, toolCalls: await db.select().from(toolCalls).where(eq(toolCalls.runId, id)) };
  });

  // Fallback connections — keys are write-only; responses carry masked values only.
  app.get('/api/runtime/fallback', async () => ({ connections: await s.fallback.list(), providers: PROVIDERS.map((p) => ({ key: p, ...PROVIDER_DEFAULTS[p] })) }));

  const connSchema = z.object({
    name: z.string().trim().min(2).max(60), provider: z.enum(PROVIDERS), apiKey: z.string().trim().min(8).max(500).optional(),
    baseUrl: z.string().url().max(300).nullable().optional(), model: z.string().trim().min(1).max(120), enabled: z.boolean().optional(),
    priority: z.number().int().min(1).max(9).optional(), costInputPerMTok: z.number().min(0).max(1000).nullable().optional(), costOutputPerMTok: z.number().min(0).max(1000).nullable().optional(),
  });

  app.post('/api/runtime/fallback', async (req, reply) => {
    const body = connSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid connection', issues: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (PROVIDER_DEFAULTS[body.data.provider].needsKey && !body.data.apiKey) return reply.code(400).send({ error: 'This provider requires an API key' });
    const id = await s.fallback.create(body.data);
    await s.audit.log(owner(req), 'fallback.connection_create', body.data.name, { provider: body.data.provider, model: body.data.model });
    return { id };
  });

  app.put('/api/runtime/fallback/:id', async (req, reply) => {
    const body = connSchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid connection' });
    await s.fallback.update((req.params as { id: string }).id, body.data);
    await s.audit.log(owner(req), 'fallback.connection_update', (req.params as { id: string }).id, { fields: Object.keys(body.data).filter((k) => k !== 'apiKey'), keyRotated: !!body.data.apiKey });
    return { ok: true };
  });

  app.delete('/api/runtime/fallback/:id', async (req) => {
    await s.fallback.remove((req.params as { id: string }).id);
    await s.audit.log(owner(req), 'fallback.connection_delete', (req.params as { id: string }).id, {});
    return { ok: true };
  });

  app.post('/api/runtime/fallback/:id/test', async (req) => {
    const r = await s.fallback.test((req.params as { id: string }).id);
    await s.audit.log(owner(req), 'fallback.connection_test', (req.params as { id: string }).id, { ok: r.ok });
    return r;
  });

  /** Realtime stream of company events (SSE). */
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write(`retry: 3000\n\n`);
    const unsub = s.bus.subscribe((e) => { reply.raw.write(`data: ${JSON.stringify(e)}\n\n`); });
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 20_000);
    req.raw.on('close', () => { unsub(); clearInterval(ping); });
    return reply;
  });
}
