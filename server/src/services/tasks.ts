import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { employees, tasks, type Phase, type Priority, type TaskStatus, type TaskStep } from '../db/schema.js';
import { nextCode, type AuditService, type EventBus } from '../core/events.js';
import type { OrganizationService } from '../org/service.js';
import type { WorkflowGuard } from '../workflow/guard.js';

export type Task = typeof tasks.$inferSelect;

const PREFIX: Record<string, string> = {
  executive: 'CEO', research: 'RES', product: 'PRD', design: 'DSN', architecture: 'ARC', engineering: 'ENG', qa: 'QA', security: 'SEC', devops: 'OPS', audit: 'AUD',
};
const ROLE_PREFIX: Record<string, string> = { 'frontend-engineer': 'FE', 'frontend-lead': 'FE', 'backend-engineer': 'BE', 'backend-lead': 'BE', 'integration-engineer': 'INT', 'code-reviewer': 'REV' };

export function stepsProgress(steps: TaskStep[]): number {
  if (!steps.length) return 0;
  const done = steps.filter((s) => s.status === 'DONE' || s.status === 'SKIPPED').length;
  const active = steps.filter((s) => s.status === 'ACTIVE').length;
  return Math.round(((done + active * 0.5) / steps.length) * 100);
}

export const STANDARD_AGENT_STEPS = (extra: string[] = []): TaskStep[] => [
  { key: 'assigned', label: 'Assigned', status: 'PENDING' },
  { key: 'context', label: 'Context assembled', status: 'PENDING' },
  { key: 'working', label: 'Agent working', status: 'PENDING' },
  ...extra.map((label, i) => ({ key: `x${i}`, label, status: 'PENDING' as const })),
  { key: 'validated', label: 'Output validated', status: 'PENDING' },
];

export class TaskService {
  constructor(private db: DB, private bus: EventBus, private audit: AuditService, private org: OrganizationService, private guard: WorkflowGuard) {}

  async create(t: {
    projectId: string | null; phase: Phase | null; stage: string; roleKey: string; title: string; description?: string; priority?: Priority;
    dependsOn?: string[]; steps?: TaskStep[]; input?: Record<string, unknown>; exclude?: string[]; assigneeId?: string | null; round?: number; status?: TaskStatus;
  }): Promise<Task> {
    await this.guard.assertStageAllowed(t.projectId, t.stage); // ENGINEERING_IMPLEMENTATION_LOCKED enforcement
    const role = await this.org.role(t.roleKey);
    if (!role) throw new Error(`Unknown role ${t.roleKey}`);
    const assignee = t.assigneeId ? await this.org.employee(t.assigneeId) : await this.org.pick(t.roleKey, t.exclude ?? []);
    if (!assignee) throw new Error(`No available employee for role ${t.roleKey} (independence constraints may exclude everyone)`);
    const code = await nextCode(this.db, ROLE_PREFIX[t.roleKey] ?? PREFIX[role.departmentKey] ?? 'TSK');
    const steps = (t.steps ?? STANDARD_AGENT_STEPS()).map((s, i) => (i === 0 ? { ...s, status: 'DONE' as const } : s));
    const [row] = await this.db.insert(tasks).values({
      code, projectId: t.projectId, phase: t.phase, stage: t.stage, departmentKey: role.departmentKey, roleKey: t.roleKey, title: t.title,
      description: t.description ?? '', priority: t.priority ?? 'MEDIUM', assigneeId: assignee.id, dependsOn: t.dependsOn ?? [], steps,
      progress: stepsProgress(steps), input: t.input ?? {}, round: t.round ?? 1, status: t.status ?? 'READY',
    }).returning();
    await this.bus.emit('TASK_CREATED', `${code} created: ${t.title}`, { projectId: t.projectId, taskId: row.id, data: { stage: t.stage } });
    await this.bus.emit('TASK_ASSIGNED', `${assignee.name} assigned ${code}`, { projectId: t.projectId, taskId: row.id, employeeId: assignee.id });
    if (assignee.status === 'IDLE') await this.org.setStatus(assignee.id, 'WAITING', `Queued: ${t.title}`, row.id);
    return row;
  }

  async get(id: string): Promise<Task | undefined> { return (await this.db.select().from(tasks).where(eq(tasks.id, id)))[0]; }
  async byProject(projectId: string): Promise<Task[]> { return this.db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.createdAt)); }
  async byStage(projectId: string, stage: string): Promise<Task[]> { return this.db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.stage, stage))).orderBy(desc(tasks.createdAt)); }
  async list(filter: { status?: TaskStatus[]; limit?: number } = {}): Promise<Task[]> {
    return this.db.select().from(tasks).where(filter.status?.length ? inArray(tasks.status, filter.status) : undefined).orderBy(desc(tasks.updatedAt)).limit(filter.limit ?? 500);
  }

  async update(id: string, patch: Partial<typeof tasks.$inferInsert>): Promise<Task> {
    if (patch.steps) patch.progress = stepsProgress(patch.steps);
    const [row] = await this.db.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    return row;
  }

  async setStep(id: string, key: string, status: TaskStep['status']): Promise<Task> {
    const t = await this.get(id);
    if (!t) throw new Error('Task not found');
    const steps = t.steps.map((s) => (s.key === key ? { ...s, status } : s));
    const row = await this.update(id, { steps });
    await this.bus.emit('TASK_PROGRESS', `${t.code} ${key} ${status.toLowerCase()}`, { projectId: t.projectId, taskId: id, data: { progress: row.progress } });
    return row;
  }

  async start(id: string): Promise<Task> {
    const t = await this.get(id);
    if (!t) throw new Error('Task not found');
    await this.guard.assertStageAllowed(t.projectId, t.stage);
    const row = await this.update(id, { status: 'WORKING', startedAt: t.startedAt ?? new Date(), attempts: t.attempts + 1, blockedReason: null });
    await this.bus.emit('TASK_STARTED', `${t.code} started: ${t.title}`, { projectId: t.projectId, taskId: id, employeeId: t.assigneeId });
    return row;
  }

  async complete(id: string, result: Record<string, unknown>): Promise<Task> {
    const t = await this.get(id);
    if (!t) throw new Error('Task not found');
    const steps = t.steps.map((s) => (s.status === 'FAILED' ? s : { ...s, status: s.status === 'SKIPPED' ? 'SKIPPED' as const : 'DONE' as const }));
    const row = await this.update(id, { status: 'DONE', result, steps, completedAt: new Date() });
    if (t.assigneeId) {
      await this.org.setStatus(t.assigneeId, 'IDLE', null, null);
      await this.db.update(employees).set({ tasksCompleted: sql`${employees.tasksCompleted} + 1` }).where(eq(employees.id, t.assigneeId));
    }
    await this.bus.emit('TASK_COMPLETED', `${t.code} completed: ${t.title}`, { projectId: t.projectId, taskId: id, employeeId: t.assigneeId });
    return row;
  }

  async fail(id: string, reason: string, opts: { block?: boolean } = {}): Promise<Task> {
    const t = await this.get(id);
    if (!t) throw new Error('Task not found');
    const status: TaskStatus = opts.block ? 'BLOCKED' : 'FAILED';
    const steps = t.steps.map((s) => (s.status === 'ACTIVE' ? { ...s, status: 'FAILED' as const } : s));
    const row = await this.update(id, { status, blockedReason: reason.slice(0, 2000), steps });
    if (t.assigneeId) await this.org.setStatus(t.assigneeId, opts.block ? 'BLOCKED' : 'IDLE', opts.block ? `Blocked: ${t.title}` : null, opts.block ? id : null);
    await this.bus.emit(opts.block ? 'TASK_BLOCKED' : 'TASK_FAILED', `${t.code} ${opts.block ? 'blocked' : 'failed'}: ${reason.slice(0, 200)}`, { projectId: t.projectId, taskId: id, employeeId: t.assigneeId });
    return row;
  }

  /** READY tasks whose dependencies are all DONE. */
  async runnable(projectId: string): Promise<Task[]> {
    const all = await this.byProject(projectId);
    const done = new Set(all.filter((t) => t.status === 'DONE').map((t) => t.id));
    return all.filter((t) => t.status === 'READY' && t.dependsOn.every((d) => done.has(d)));
  }

  async cancelOpen(projectId: string, stagePrefix?: string): Promise<void> {
    const open = (await this.byProject(projectId)).filter((t) => ['BACKLOG', 'READY', 'BLOCKED'].includes(t.status) && (!stagePrefix || t.stage.startsWith(stagePrefix)));
    for (const t of open) {
      await this.update(t.id, { status: 'CANCELLED' });
      if (t.assigneeId) await this.org.setStatus(t.assigneeId, 'IDLE', null, null);
    }
  }

  async logAudit(t: Task, action: string, details: Record<string, unknown>): Promise<void> {
    await this.audit.log({ type: 'SYSTEM', name: 'TaskService' }, action, t.code, details);
  }
}
