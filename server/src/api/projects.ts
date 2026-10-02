import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agentRuns, checkRuns, deployments, employees, events, incidents, meetings, decisions, tasks, toolCalls } from '../db/schema.js';
import type { Services } from '../core/container.js';
import type { WorkflowEngine } from '../workflow/engine.js';
import { AuthorityError } from '../services/approvals.js';
import { PHASES } from '../workflow/phases.js';

export function registerProjectRoutes(app: FastifyInstance, s: Services, engine: WorkflowEngine) {
  const db = s.db;
  const owner = (req: { owner?: { id: string; displayName: string } }) => ({ type: 'OWNER' as const, id: req.owner!.id, name: req.owner!.displayName });
  const notFound = { error: 'Not found' };

  app.get('/api/phases', async () => ({ phases: PHASES }));

  app.get('/api/projects', async () => {
    const list = await s.projects.list();
    return { projects: await Promise.all(list.map(async (p) => ({ ...p, health: (await s.projects.health(p.id)).signals }))) };
  });

  app.post('/api/projects', async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(120), objective: z.string().trim().min(5).max(1000), description: z.string().max(6000).default(''), type: z.string().regex(/^[A-Z_]{3,30}$/).default('FULL_STACK_APP'), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'), isDemo: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid project', issues: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const p = await s.projects.create({ ...body.data, ownerRequest: `${body.data.objective}\n${body.data.description}`.trim() });
    await s.audit.log(owner(req), 'project.create', p.code, {});
    engine.kick();
    return p;
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const p = await s.projects.get((req.params as { id: string }).id);
    if (!p) return reply.code(404).send(notFound);
    const [progress, health, lock, sponsor, pm] = await Promise.all([s.projects.progress(p.id), s.projects.health(p.id), s.guard.engineeringLock(p.id), p.ceoSponsorId ? s.org.employee(p.ceoSponsorId) : null, p.projectManagerId ? s.org.employee(p.projectManagerId) : null]);
    const next = PHASES.findIndex((x) => x.key === p.phase) + 1;
    const nextReqs = next < PHASES.length ? await s.guard.requirements(p.id, PHASES[next].key) : [];
    const working = await db.select({ id: employees.id, name: employees.name, status: employees.status, activity: employees.currentActivity, taskId: employees.currentTaskId, roleKey: employees.roleKey }).from(employees).innerJoin(tasks, eq(tasks.id, employees.currentTaskId)).where(eq(tasks.projectId, p.id));
    return { project: p, progress, health, engineeringLock: lock, sponsor, projectManager: pm, nextPhase: PHASES[next]?.key ?? null, nextRequirements: nextReqs, working };
  });

  app.post('/api/projects/:id/status', async (req, reply) => {
    const body = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']), reason: z.string().max(500).default('Owner decision') }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid status' });
    const p = await s.projects.get((req.params as { id: string }).id);
    if (!p) return reply.code(404).send(notFound);
    if (p.status === 'COMPLETED') return reply.code(409).send({ error: 'Project is completed' });
    const row = await s.projects.setStatus(p.id, body.data.status, body.data.reason, owner(req));
    if (body.data.status === 'CANCELLED') await s.tasks.cancelOpen(p.id);
    engine.kick();
    return row;
  });

  app.put('/api/projects/:id/deployment', async (req, reply) => {
    const body = z.object({
      provider: z.enum(['LOCAL_PROCESS', 'COMMAND']),
      healthPath: z.string().regex(/^\/[\w\-/.]*$/).max(100).optional(),
      commandDeploy: z.object({ staging: z.string().max(1000).optional(), production: z.string().max(1000).optional(), stagingUrl: z.string().url().optional(), productionUrl: z.string().url().optional() }).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid deployment settings' });
    const p = await s.projects.get((req.params as { id: string }).id);
    if (!p) return reply.code(404).send(notFound);
    const deployment = { ...p.deployment, provider: body.data.provider, healthPath: body.data.healthPath ?? p.deployment.healthPath, commandDeploy: body.data.commandDeploy ?? p.deployment.commandDeploy };
    await s.projects.update(p.id, { deployment });
    await s.audit.log(owner(req), 'project.deployment_settings', p.code, { provider: body.data.provider });
    return { deployment };
  });

  app.get('/api/projects/:id/timeline', async (req) => {
    const id = (req.params as { id: string }).id;
    return { events: await db.select().from(events).where(eq(events.projectId, id)).orderBy(asc(events.id)).limit(2000) };
  });

  app.get('/api/projects/:id/tasks', async (req) => {
    const id = (req.params as { id: string }).id;
    const ts = await s.tasks.byProject(id);
    const emps = await s.org.byIds([...new Set(ts.flatMap((t) => [t.assigneeId, t.reviewerId]).filter(Boolean) as string[])]);
    return { tasks: ts.map((t) => ({ ...t, assignee: emps.find((e) => e.id === t.assigneeId) ?? null, dependsOnCodes: t.dependsOn.map((d) => ts.find((x) => x.id === d)?.code ?? d) })) };
  });

  app.get('/api/tasks', async (req) => {
    const { status } = req.query as { status?: string };
    const list = await s.tasks.list({ status: status ? status.split(',') as never : undefined, limit: 300 });
    const emps = await s.org.byIds([...new Set(list.map((t) => t.assigneeId).filter(Boolean) as string[])]);
    const ps = await s.projects.list();
    return { tasks: list.map((t) => ({ ...t, assignee: emps.find((e) => e.id === t.assigneeId) ?? null, projectCode: ps.find((p) => p.id === t.projectId)?.code ?? null })) };
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const t = await s.tasks.get((req.params as { id: string }).id);
    if (!t) return reply.code(404).send(notFound);
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.taskId, t.id)).orderBy(desc(agentRuns.createdAt));
    const calls = runs.length ? await db.select().from(toolCalls).where(sql`${toolCalls.runId} in (${sql.join(runs.map((r) => sql`${r.id}`), sql`, `)})`).orderBy(asc(toolCalls.createdAt)) : [];
    return { task: t, assignee: t.assigneeId ? await s.org.employee(t.assigneeId) : null, runs, toolCalls: calls };
  });

  app.post('/api/tasks/:id/retry', async (req, reply) => {
    const t = await s.tasks.get((req.params as { id: string }).id);
    if (!t) return reply.code(404).send(notFound);
    if (t.status !== 'BLOCKED' && t.status !== 'FAILED') return reply.code(409).send({ error: 'Only blocked or failed tasks can be retried' });
    const row = await s.tasks.update(t.id, { status: 'READY', blockedReason: null });
    await s.audit.log(owner(req), 'task.retry', t.code, {});
    engine.kick();
    return row;
  });

  app.post('/api/tasks/:id/force-fallback', async (req, reply) => {
    const t = await s.tasks.get((req.params as { id: string }).id);
    if (!t) return reply.code(404).send(notFound);
    if (!s.policies().fallbackEnabled) return reply.code(409).send({ error: 'Fallback is disabled in AI Runtime settings' });
    const row = await s.tasks.update(t.id, { status: t.status === 'BLOCKED' || t.status === 'FAILED' ? 'READY' : t.status, blockedReason: null, input: { ...t.input, allowFallback: true } });
    await s.audit.log(owner(req), 'fallback.owner_approved_task', t.code, {});
    engine.kick();
    return row;
  });

  // Approvals
  app.get('/api/approvals', async (req) => {
    const { status, projectId } = req.query as { status?: string; projectId?: string };
    const list = await s.approvals.list({ status: status as never, projectId });
    const ps = await s.projects.list();
    const emps = await s.org.byIds([...new Set(list.map((a) => a.requestedById).filter(Boolean) as string[])]);
    return { approvals: list.map((a) => ({ ...a, project: ps.find((p) => p.id === a.projectId) ? { code: ps.find((p) => p.id === a.projectId)!.code, name: ps.find((p) => p.id === a.projectId)!.name } : null, requestedBy: emps.find((e) => e.id === a.requestedById)?.name ?? 'System' })) };
  });

  app.post('/api/approvals/:id/decide', async (req, reply) => {
    const body = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'REVISION_REQUESTED']), note: z.string().max(4000).default('') }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid decision' });
    try {
      const row = await s.approvals.decide((req.params as { id: string }).id, owner(req), body.data.decision, body.data.note || body.data.decision);
      engine.kick();
      return row;
    } catch (e) {
      if (e instanceof AuthorityError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  // Quality, releases, deployments, monitoring, incidents
  app.get('/api/projects/:id/checks', async (req) => {
    const id = (req.params as { id: string }).id;
    return { checks: await db.select().from(checkRuns).where(eq(checkRuns.projectId, id)).orderBy(desc(checkRuns.createdAt)).limit(500) };
  });
  app.get('/api/projects/:id/releases', async (req) => ({ releases: await s.deploy.releases((req.params as { id: string }).id), deployments: await s.deploy.list((req.params as { id: string }).id) }));
  app.get('/api/deployments', async () => {
    const ps = await s.projects.list();
    const list = await s.deploy.list();
    return { deployments: list.map((d) => ({ ...d, log: undefined, projectCode: ps.find((p) => p.id === d.projectId)?.code })), releases: (await s.deploy.releases()).map((r) => ({ ...r, projectCode: ps.find((p) => p.id === r.projectId)?.code })) };
  });
  app.get('/api/deployments/:id', async (req, reply) => {
    const d = (await db.select().from(deployments).where(eq(deployments.id, (req.params as { id: string }).id)))[0];
    return d ?? reply.code(404).send(notFound);
  });
  app.get('/api/projects/:id/monitoring', async (req) => ({ samples: await s.monitoring.recent((req.params as { id: string }).id, 120) }));
  app.get('/api/monitoring', async () => {
    const ps = await s.projects.list();
    return { projects: await Promise.all(ps.map(async (p) => ({ id: p.id, code: p.code, name: p.name, productionUrl: p.productionUrl, samples: await s.monitoring.recent(p.id, 30) }))) };
  });
  app.get('/api/incidents', async () => ({ incidents: await s.incidents.list() }));
  app.post('/api/incidents/:id/resolve', async (req, reply) => {
    const body = z.object({ note: z.string().min(3).max(2000), postmortem: z.string().max(20_000).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'A resolution note is required' });
    const id = (req.params as { id: string }).id;
    const inc = (await db.select().from(incidents).where(eq(incidents.id, id)))[0];
    if (!inc) return reply.code(404).send(notFound);
    await s.incidents.note(id, `Resolved by Owner: ${body.data.note}`, 'RESOLVED', body.data.postmortem);
    if (body.data.postmortem) await s.artifacts.save({ projectId: inc.projectId, kind: 'POSTMORTEM', title: `Postmortem ${inc.code}`, content: body.data.postmortem });
    await s.audit.log(owner(req), 'incident.resolve', inc.code, {});
    return { ok: true };
  });

  // Git & costs & per-project records
  app.get('/api/projects/:id/git', async (req, reply) => {
    const p = await s.projects.get((req.params as { id: string }).id);
    if (!p?.workspacePath) return reply.code(404).send(notFound);
    return { branches: await s.git.branches(p.workspacePath), log: await s.git.log(p.workspacePath, 60), workspace: p.workspacePath };
  });
  app.get('/api/projects/:id/costs', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await db.select({ runtime: agentRuns.runtime, provider: agentRuns.provider, runs: sql<number>`count(*)::int`, credits: sql<number>`coalesce(sum(${agentRuns.credits}),0)::float`, usd: sql<number>`coalesce(sum(${agentRuns.costUsd}),0)::float`, estimated: sql<boolean>`bool_or(${agentRuns.costEstimated})`, ms: sql<number>`coalesce(sum(${agentRuns.durationMs}),0)::int` }).from(agentRuns).where(eq(agentRuns.projectId, id)).groupBy(agentRuns.runtime, agentRuns.provider);
    const fallbackRuns = await db.select({ id: agentRuns.id, provider: agentRuns.provider, model: agentRuns.model, reason: agentRuns.fallbackReason, usd: agentRuns.costUsd, estimated: agentRuns.costEstimated, createdAt: agentRuns.createdAt, taskId: agentRuns.taskId, employeeId: agentRuns.employeeId, durationMs: agentRuns.durationMs }).from(agentRuns).where(and(eq(agentRuns.projectId, id), eq(agentRuns.runtime, 'FALLBACK'))).orderBy(desc(agentRuns.createdAt));
    return { byRuntime: rows, fallbackRuns, hosting: 'Local process hosting on this machine — no hosting cost recorded.' };
  });
  app.get('/api/projects/:id/records', async (req) => {
    const id = (req.params as { id: string }).id;
    return {
      meetings: await db.select().from(meetings).where(eq(meetings.projectId, id)).orderBy(desc(meetings.createdAt)),
      decisions: await db.select().from(decisions).where(eq(decisions.projectId, id)).orderBy(desc(decisions.createdAt)),
      incidents: await db.select().from(incidents).where(eq(incidents.projectId, id)).orderBy(desc(incidents.createdAt)),
    };
  });
}
