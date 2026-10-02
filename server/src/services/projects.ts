import path from 'node:path';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { checkRuns, incidents, projects, approvals as approvalsTable, type Phase, type Priority, type ProjectStatus } from '../db/schema.js';
import { nextCode, type AuditService, type EventBus } from '../core/events.js';
import type { OrganizationService } from '../org/service.js';
import type { GitService } from './git.js';
import type { WorkflowGuard } from '../workflow/guard.js';
import type { ApprovalService } from './approvals.js';
import type { TaskService, Task } from './tasks.js';
import type { MemoryService } from './records.js';
import { PHASES, PHASE_INDEX, PROGRESS_GROUPS } from '../workflow/phases.js';
import { config } from '../config.js';

export type Project = typeof projects.$inferSelect;

export class ProjectService {
  constructor(
    private db: DB, private bus: EventBus, private audit: AuditService, private org: OrganizationService, private git: GitService,
    private guard: WorkflowGuard, private approvals: ApprovalService, private tasks: TaskService, private memory: MemoryService,
  ) {}

  async create(p: { name: string; objective: string; description?: string; type?: string; priority?: Priority; ownerRequest?: string; scope?: string; deadline?: Date | null; budget?: string | null; isDemo?: boolean }): Promise<Project> {
    const code = await nextCode(this.db, 'PRJ');
    const n = Number(code.split('-')[1]);
    const ceo = await this.org.firstOfRole('ceo');
    const pm = await this.org.pick('product-manager');
    const workspacePath = path.join(config.workspacesDir, code, 'repo');
    const [row] = await this.db.insert(projects).values({
      code, name: p.name.slice(0, 120), objective: p.objective, description: p.description ?? '', type: p.type ?? 'FULL_STACK_APP',
      priority: p.priority ?? 'MEDIUM', ownerRequest: p.ownerRequest ?? '', scope: p.scope ?? '', deadline: p.deadline ?? null, budget: p.budget ?? null,
      ceoSponsorId: ceo?.id ?? null, projectManagerId: pm?.id ?? null, workspacePath, isDemo: p.isDemo ?? false,
      departments: ['executive', 'research', 'product', 'design', 'architecture', 'engineering', 'qa', 'security', 'devops'],
      deployment: { provider: 'LOCAL_PROCESS', stagingPort: config.stagingPortBase + n, productionPort: config.productionPortBase + n, healthPath: '/api/health', routes: ['/'] },
    }).returning();
    await this.git.init(workspacePath, row);
    await this.bus.emit('PROJECT_CREATED', `Project ${code} created: ${row.name}`, { projectId: row.id, employeeId: ceo?.id });
    await this.audit.log({ type: 'SYSTEM', name: 'ProjectService' }, 'project.create', code, { name: row.name });
    if (p.ownerRequest) await this.memory.remember({ scope: 'PROJECT', projectId: row.id, kind: 'DIRECTIVE', content: `Owner request for ${row.name}: ${p.ownerRequest}`, tags: ['owner'] });
    return row;
  }

  async get(id: string): Promise<Project | undefined> { return (await this.db.select().from(projects).where(eq(projects.id, id)))[0]; }
  async byCode(code: string): Promise<Project | undefined> { return (await this.db.select().from(projects).where(eq(projects.code, code.toUpperCase())))[0]; }
  async list(): Promise<Project[]> { return this.db.select().from(projects).orderBy(desc(projects.createdAt)); }
  async active(): Promise<Project[]> { return this.db.select().from(projects).where(eq(projects.status, 'ACTIVE')).orderBy(asc(projects.createdAt)); }

  async update(id: string, patch: Partial<typeof projects.$inferInsert>): Promise<Project> {
    const [row] = await this.db.update(projects).set({ ...patch, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return row;
  }

  /** The ONLY way a phase changes. Gate requirements are verified against DB state first. */
  async enterPhase(id: string, phase: Phase, reason: string): Promise<Project> {
    const p = await this.get(id);
    if (!p) throw new Error('Project not found');
    if (p.phase === phase) return p;
    await this.guard.assertCanEnter(id, phase);
    const row = await this.update(id, { phase });
    await this.bus.emit('PROJECT_PHASE_CHANGED', `${p.code} entered ${PHASES[PHASE_INDEX[phase]].label}: ${reason}`, { projectId: id, data: { from: p.phase, to: phase, reason } });
    await this.audit.log({ type: 'SYSTEM', name: 'WorkflowEngine' }, 'project.phase', p.code, { from: p.phase, to: phase, reason });
    return row;
  }

  async setStatus(id: string, status: ProjectStatus, reason: string, actor: { type: 'OWNER' | 'AGENT' | 'SYSTEM'; id?: string; name: string }): Promise<Project> {
    const p = await this.get(id);
    if (!p) throw new Error('Project not found');
    const row = await this.update(id, { status, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) });
    await this.bus.emit('PROJECT_STATUS_CHANGED', `${p.code} is now ${status}: ${reason}`, { projectId: id, data: { from: p.status, to: status } });
    await this.audit.log(actor, 'project.status', p.code, { from: p.status, to: status, reason });
    return row;
  }

  async bumpCounter(id: string, key: string): Promise<number> {
    const p = await this.get(id);
    const value = (p?.counters?.[key] ?? 0) + 1;
    await this.update(id, { counters: { ...(p?.counters ?? {}), [key]: value } });
    return value;
  }

  /**
   * Explainable progress: each group = completed gate (100%) or average of its tasks' step progress.
   * Groups after the current phase show 0% and are locked.
   */
  async progress(id: string) {
    const p = await this.get(id);
    if (!p) throw new Error('Project not found');
    const all = await this.tasks.byProject(id);
    const currentIdx = PHASE_INDEX[p.phase];
    const lock = await this.guard.engineeringLock(id);
    const groups = await Promise.all(PROGRESS_GROUPS.map(async (g) => {
      const groupTasks = all.filter((t) => t.phase && g.phases.includes(t.phase) && t.status !== 'CANCELLED');
      const firstIdx = Math.min(...g.phases.map((ph) => PHASE_INDEX[ph]));
      const lastIdx = Math.max(...g.phases.map((ph) => PHASE_INDEX[ph]));
      const gateApproved = g.gate ? await this.approvals.isApproved(id, g.gate) : false;
      let pct: number; let explanation: string;
      if (p.phase === 'COMPLETED' || currentIdx > lastIdx || gateApproved) { pct = 100; explanation = gateApproved ? `${g.gate} gate approved` : 'Phase completed'; }
      else if (currentIdx < firstIdx) { pct = 0; explanation = 'Not started'; }
      else if (groupTasks.length) {
        pct = Math.min(95, Math.round(groupTasks.reduce((a, t) => a + (t.status === 'DONE' ? 100 : t.progress), 0) / groupTasks.length));
        const done = groupTasks.filter((t) => t.status === 'DONE').length;
        explanation = `${done}/${groupTasks.length} tasks done${g.gate ? `; ${g.gate} approval pending` : ''}`;
      } else { pct = 5; explanation = 'Phase entered; tasks being planned'; }
      const locked = currentIdx < firstIdx;
      return { key: g.key, label: g.label, weight: g.weight, percent: pct, explanation, locked, status: pct === 100 ? 'DONE' : locked ? 'LOCKED' : 'IN_PROGRESS' };
    }));
    const totalW = groups.reduce((a, g) => a + g.weight, 0);
    const overall = Math.round(groups.reduce((a, g) => a + g.percent * g.weight, 0) / totalW);
    // Department-level view (Frontend / Backend / ...) from engineering tasks.
    const byRole = (roles: string[]) => {
      const ts = all.filter((t) => roles.includes(t.roleKey) && t.status !== 'CANCELLED');
      return ts.length ? Math.round(ts.reduce((a, t) => a + (t.status === 'DONE' ? 100 : t.progress), 0) / ts.length) : null;
    };
    const tracks = [
      { key: 'frontend', label: 'Frontend', percent: byRole(['frontend-engineer', 'frontend-lead']) },
      { key: 'backend', label: 'Backend', percent: byRole(['backend-engineer', 'backend-lead']) },
      { key: 'integration', label: 'Integration', percent: byRole(['integration-engineer']) },
    ].filter((t) => t.percent !== null);
    if (overall !== p.progress) await this.update(id, { progress: overall });
    return { overall, phase: p.phase, groups, tracks, engineeringLocked: lock.locked, engineeringLockReasons: lock.unmet };
  }

  /** Health derived only from real signals: blocked/failed tasks, failed checks, incidents, pending approvals, deploy state. */
  async health(id: string) {
    const all = await this.tasks.byProject(id);
    const blocked = all.filter((t) => t.status === 'BLOCKED');
    const failed = all.filter((t) => t.status === 'FAILED');
    const failedChecks = await this.db.select({ suite: checkRuns.suite, n: sql<number>`count(*)::int` }).from(checkRuns)
      .where(sql`${checkRuns.projectId} = ${id} and ${checkRuns.name} = 'summary' and ${checkRuns.status} = 'FAIL'`).groupBy(checkRuns.suite);
    const openIncidents = await this.db.select().from(incidents).where(sql`${incidents.projectId} = ${id} and ${incidents.status} <> 'RESOLVED'`);
    const pending = await this.db.select().from(approvalsTable).where(sql`${approvalsTable.projectId} = ${id} and ${approvalsTable.status} = 'PENDING'`);
    const signals: { area: string; status: 'GOOD' | 'WARN' | 'BAD'; reason: string }[] = [];
    const push = (area: string, bad: boolean, warn: boolean, reason: string) => signals.push({ area, status: bad ? 'BAD' : warn ? 'WARN' : 'GOOD', reason });
    push('Schedule', blocked.length > 1, blocked.length === 1, blocked.length ? `${blocked.length} blocked task(s)` : 'No blocked tasks');
    push('Engineering', failed.some((t) => t.departmentKey === 'engineering'), failed.length > 0, failed.length ? `${failed.length} failed task(s)` : 'No failed tasks');
    const qaFails = failedChecks.find((c) => c.suite === 'QA')?.n ?? 0;
    push('Quality', false, qaFails > 0, qaFails ? `${qaFails} failed QA run(s) recorded` : 'No failed QA runs');
    const secFails = failedChecks.find((c) => c.suite === 'SECURITY')?.n ?? 0;
    push('Security', false, secFails > 0, secFails ? `${secFails} failed security run(s) recorded` : 'No failed security runs');
    const sev = openIncidents.filter((i) => i.severity === 'SEV1' || i.severity === 'SEV2');
    push('Deployment', sev.length > 0, openIncidents.length > 0, openIncidents.length ? `${openIncidents.length} open incident(s)` : 'No open incidents');
    push('Scope', false, pending.length > 0, pending.length ? `${pending.length} decision(s) awaiting approval` : 'No pending decisions');
    const blockers = blocked.map((t: Task) => ({ taskId: t.id, code: t.code, title: t.title, reason: t.blockedReason ?? '', downstream: all.filter((x) => x.dependsOn.includes(t.id)).length }));
    return { signals, blockers, openIncidents: openIncidents.length, pendingApprovals: pending.length };
  }
}
