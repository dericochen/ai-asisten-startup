import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  agentRuns, approvals, artifacts, auditLog, company, decisions, departments, deployments, employees, events, incidents, meetings, messages, notifications, projects, roles, tasks,
} from '../db/schema.js';
import type { Services } from '../core/container.js';
import type { CeoService } from '../services/ceo.js';
import { DEFAULT_POLICIES } from '../org/definition.js';

export function registerCompanyRoutes(app: FastifyInstance, s: Services, ceo: CeoService) {
  const db = s.db;

  app.get('/api/dashboard', async () => {
    const c = (await db.select().from(company).limit(1))[0];
    const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const empStatus = await db.select({ status: employees.status, n: sql<number>`count(*)::int` }).from(employees).groupBy(employees.status);
    const by = (st: string) => empStatus.find((x) => x.status === st)?.n ?? 0;
    const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt));
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const runs = await db.select({ runtime: agentRuns.runtime, provider: agentRuns.provider, n: sql<number>`count(*)::int`, usd: sql<number>`coalesce(sum(${agentRuns.costUsd}),0)::float`, credits: sql<number>`coalesce(sum(${agentRuns.credits}),0)::float` })
      .from(agentRuns).where(gte(agentRuns.createdAt, start)).groupBy(agentRuns.runtime, agentRuns.provider);
    const fallbackRunning = await count(db.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(and(eq(agentRuns.runtime, 'FALLBACK'), eq(agentRuns.status, 'RUNNING'))));
    const healthByProject = await Promise.all(allProjects.filter((p) => p.status !== 'CANCELLED').slice(0, 20).map(async (p) => ({ id: p.id, health: await s.projects.health(p.id) })));
    const kiro = s.kiro.status();
    return {
      company: c ? { name: c.name, mission: c.mission } : null,
      ceoStatus: (await s.org.firstOfRole('ceo'))?.status ?? 'IDLE',
      activeProjects: allProjects.filter((p) => p.status === 'ACTIVE').length,
      projects: allProjects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status, phase: p.phase, progress: p.progress, priority: p.priority, productionUrl: p.productionUrl, updatedAt: p.updatedAt, isDemo: p.isDemo, health: healthByProject.find((h) => h.id === p.id)?.health.signals ?? [] })),
      employees: { total: empStatus.reduce((a, x) => a + x.n, 0), working: by('WORKING') + by('REVIEWING'), waiting: by('WAITING'), blocked: by('BLOCKED'), idle: by('IDLE') },
      ownerApprovals: await count(db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.status, 'PENDING'), eq(approvals.approverRole, 'OWNER')))),
      pendingApprovals: await count(db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(eq(approvals.status, 'PENDING'))),
      productionIncidents: await count(db.select({ n: sql<number>`count(*)::int` }).from(incidents).where(sql`${incidents.status} <> 'RESOLVED'`)),
      deployments: { staging: await count(db.select({ n: sql<number>`count(*)::int` }).from(deployments).where(and(eq(deployments.environment, 'STAGING'), eq(deployments.active, true)))), production: await count(db.select({ n: sql<number>`count(*)::int` }).from(deployments).where(and(eq(deployments.environment, 'PRODUCTION'), eq(deployments.active, true)))), productionFailures: await count(db.select({ n: sql<number>`count(*)::int` }).from(deployments).where(and(eq(deployments.environment, 'PRODUCTION'), sql`${deployments.status} in ('FAILED','UNHEALTHY','ROLLED_BACK')`))) },
      kiro: { health: kiro.health, reason: kiro.healthReason, connected: kiro.detection.installed && kiro.detection.authenticated, version: kiro.detection.version, running: kiro.runningJobs, queued: kiro.queuedJobs, creditsToday: kiro.creditsToday },
      fallback: { enabled: s.policies().fallbackEnabled, mode: s.policies().fallbackMode, running: fallbackRunning, status: fallbackRunning ? 'ACTIVE' : s.policies().fallbackEnabled ? 'STANDBY' : 'DISABLED' },
      usageToday: runs,
      unreadNotifications: await count(db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(sql`${notifications.readAt} is null`)),
    };
  });

  app.get('/api/org', async () => ({
    departments: await s.org.departments(),
    roles: await db.select().from(roles),
    employees: await db.select().from(employees).orderBy(asc(employees.code)),
  }));

  app.get('/api/employees/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const emp = await s.org.employee(id);
    if (!emp) return reply.code(404).send({ error: 'Not found' });
    return {
      employee: emp, role: await s.org.role(emp.roleKey),
      tasks: await db.select().from(tasks).where(eq(tasks.assigneeId, id)).orderBy(desc(tasks.updatedAt)).limit(50),
      runs: await db.select({ id: agentRuns.id, status: agentRuns.status, runtime: agentRuns.runtime, provider: agentRuns.provider, credits: agentRuns.credits, durationMs: agentRuns.durationMs, createdAt: agentRuns.createdAt, taskId: agentRuns.taskId }).from(agentRuns).where(eq(agentRuns.employeeId, id)).orderBy(desc(agentRuns.createdAt)).limit(30),
    };
  });

  app.get('/api/office', async () => {
    const emps = await db.select().from(employees).where(sql`${employees.status} <> 'IDLE' or ${employees.currentTaskId} is not null`).orderBy(asc(employees.code));
    const taskIds = emps.map((e) => e.currentTaskId).filter(Boolean) as string[];
    const ts = taskIds.length ? await db.select({ id: tasks.id, code: tasks.code, title: tasks.title, projectId: tasks.projectId, progress: tasks.progress }).from(tasks).where(sql`${tasks.id} in (${sql.join(taskIds.map((t) => sql`${t}`), sql`, `)})`) : [];
    return { departments: await s.org.departments(), employees: emps.map((e) => ({ ...e, task: ts.find((t) => t.id === e.currentTaskId) ?? null })) };
  });

  app.get('/api/policies', async () => ({ policies: s.policies(), defaults: DEFAULT_POLICIES }));

  const policySchema = z.object({
    gateApprover: z.enum(['OWNER', 'EXECUTIVES']).optional(),
    deploymentMode: z.enum(['MANUAL', 'CEO_APPROVAL', 'OWNER_APPROVAL', 'AUTO_AFTER_CHECKS']).optional(),
    fallbackMode: z.enum(['AUTO', 'ASK_OWNER', 'DISABLED']).optional(),
    fallbackEnabled: z.boolean().optional(),
    primaryRuntime: z.enum(['KIRO', 'PROVIDERS']).optional(),
    requireOwnerAcceptance: z.boolean().optional(),
    limits: z.object({ maxResearchRounds: z.number().int().min(1).max(5), maxReviewRounds: z.number().int().min(1).max(5), maxAgentRetries: z.number().int().min(0).max(5), maxTaskRevisions: z.number().int().min(0).max(5), maxFixAttempts: z.number().int().min(1).max(5) }).partial().optional(),
    kiro: z.object({ poolSize: z.number().int().min(1).max(20), turnTimeoutMs: z.number().int().min(60_000).max(3_600_000), dailyCreditSoftLimit: z.number().min(0).max(100_000), nearLimitRatio: z.number().min(0.1).max(1), limitCooldownMs: z.number().int().min(60_000).max(86_400_000) }).partial().optional(),
    research: z.object({ researcherCount: z.number().int().min(1).max(5) }).partial().optional(),
    monitoring: z.object({ intervalMs: z.number().int().min(5000).max(3_600_000), samplesBeforeComplete: z.number().int().min(1).max(100) }).partial().optional(),
  });

  app.put('/api/policies', async (req, reply) => {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid policies', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (parsed.data.primaryRuntime === 'PROVIDERS' && !(await s.fallback.usable()).length) return reply.code(400).send({ error: 'Add and enable a provider connection before selecting providers as the primary AI.' });
    const cur = s.policies();
    const d = parsed.data;
    const next = { ...cur, ...d, limits: { ...cur.limits, ...d.limits }, kiro: { ...cur.kiro, ...d.kiro }, research: { ...cur.research, ...d.research }, monitoring: { ...cur.monitoring, ...d.monitoring } };
    await db.update(company).set({ policies: next, updatedAt: new Date() });
    await s.reloadPolicies();
    await s.audit.log({ type: 'OWNER', id: req.owner!.id, name: req.owner!.displayName }, 'policies.update', null, { changes: d });
    return { policies: next };
  });

  // CEO office
  app.get('/api/ceo/messages', async () => ({ messages: await ceo.history() }));
  app.post('/api/ceo/messages', async (req, reply) => {
    const body = z.object({ content: z.string().trim().min(1).max(8000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Message required' });
    return ceo.submit(req.owner!.id, req.owner!.displayName, body.data.content);
  });
  app.get('/api/ceo/office', async () => ({
    pendingApprovals: await s.approvals.list({ status: 'PENDING' }),
    recentDecisions: await db.select().from(decisions).orderBy(desc(decisions.createdAt)).limit(10),
    meetings: await db.select().from(meetings).orderBy(desc(meetings.createdAt)).limit(10),
    inbox: await db.select().from(messages).where(sql`${messages.type} in ('ESCALATION','BLOCKER','INCIDENT','APPROVAL_REQUEST')`).orderBy(desc(messages.createdAt)).limit(20),
    projects: await db.select().from(projects).orderBy(desc(projects.updatedAt)),
    incidents: await db.select().from(incidents).where(sql`${incidents.status} <> 'RESOLVED'`),
  }));

  // Records
  app.get('/api/meetings', async () => ({ meetings: await db.select().from(meetings).orderBy(desc(meetings.createdAt)).limit(200) }));
  app.get('/api/decisions', async () => ({ decisions: await db.select().from(decisions).orderBy(desc(decisions.createdAt)).limit(200) }));
  app.get('/api/artifacts', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return { artifacts: await db.select({ id: artifacts.id, projectId: artifacts.projectId, kind: artifacts.kind, title: artifacts.title, version: artifacts.version, createdAt: artifacts.createdAt, authorId: artifacts.authorId }).from(artifacts).where(projectId ? eq(artifacts.projectId, projectId) : undefined).orderBy(desc(artifacts.createdAt)).limit(300) };
  });
  app.get('/api/artifacts/:id', async (req, reply) => {
    const row = (await db.select().from(artifacts).where(eq(artifacts.id, (req.params as { id: string }).id)))[0];
    return row ?? reply.code(404).send({ error: 'Not found' });
  });
  app.get('/api/messages', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return { messages: await db.select().from(messages).where(projectId ? eq(messages.projectId, projectId) : undefined).orderBy(desc(messages.createdAt)).limit(200) };
  });
  app.get('/api/memory', async () => ({ memories: await s.memory.list() }));

  app.get('/api/notifications', async () => ({ notifications: await s.notify.list() }));
  app.post('/api/notifications/read-all', async () => { await s.notify.markAllRead(); return { ok: true }; });

  app.get('/api/events', async (req) => {
    const { projectId, limit } = req.query as { projectId?: string; limit?: string };
    return { events: await db.select().from(events).where(projectId ? eq(events.projectId, projectId) : undefined).orderBy(desc(events.id)).limit(Math.min(Number(limit ?? 100), 500)) };
  });

  app.get('/api/audit', async (req) => {
    const { q } = req.query as { q?: string };
    const where = q ? or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.target, `%${q}%`), ilike(auditLog.actorName, `%${q}%`)) : undefined;
    return { entries: await db.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).limit(300) };
  });

  app.get('/api/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim().slice(0, 100);
    if (q.length < 2) return { results: [] };
    const like = `%${q}%`;
    const [ps, ts, es, ms, ds, as, is] = await Promise.all([
      db.select({ id: projects.id, label: projects.name, sub: projects.code }).from(projects).where(or(ilike(projects.name, like), ilike(projects.code, like))).limit(8),
      db.select({ id: tasks.id, label: tasks.title, sub: tasks.code, projectId: tasks.projectId }).from(tasks).where(or(ilike(tasks.title, like), ilike(tasks.code, like))).limit(8),
      db.select({ id: employees.id, label: employees.name, sub: employees.code }).from(employees).where(or(ilike(employees.name, like), ilike(employees.code, like))).limit(8),
      db.select({ id: meetings.id, label: meetings.title, sub: meetings.type }).from(meetings).where(ilike(meetings.title, like)).limit(5),
      db.select({ id: decisions.id, label: decisions.title, sub: decisions.code }).from(decisions).where(or(ilike(decisions.title, like), ilike(decisions.code, like))).limit(5),
      db.select({ id: artifacts.id, label: artifacts.title, sub: artifacts.kind }).from(artifacts).where(ilike(artifacts.title, like)).limit(8),
      db.select({ id: incidents.id, label: incidents.title, sub: incidents.code }).from(incidents).where(or(ilike(incidents.title, like), ilike(incidents.code, like))).limit(5),
    ]);
    return { results: [...ps.map((x) => ({ ...x, type: 'project' })), ...ts.map((x) => ({ ...x, type: 'task' })), ...es.map((x) => ({ ...x, type: 'employee' })), ...ms.map((x) => ({ ...x, type: 'meeting' })), ...ds.map((x) => ({ ...x, type: 'decision' })), ...as.map((x) => ({ ...x, type: 'artifact' })), ...is.map((x) => ({ ...x, type: 'incident' }))] };
  });

  app.get('/api/departments', async () => {
    const counts = await db.select({ dept: employees.departmentKey, status: employees.status, n: sql<number>`count(*)::int` }).from(employees).groupBy(employees.departmentKey, employees.status);
    return { departments: (await db.select().from(departments).orderBy(asc(departments.sortOrder))).map((d) => ({ ...d, headcount: counts.filter((c) => c.dept === d.key).reduce((a, c) => a + c.n, 0), working: counts.filter((c) => c.dept === d.key && (c.status === 'WORKING' || c.status === 'REVIEWING')).reduce((a, c) => a + c.n, 0) })) };
  });
}
