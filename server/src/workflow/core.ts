import { eq, inArray } from 'drizzle-orm';
import { agentRuns, tasks as tasksTable, type Gate, type Phase, type TaskStatus } from '../db/schema.js';
import type { Services } from '../core/container.js';
import type { Project } from '../services/projects.js';
import type { Task } from '../services/tasks.js';
import { StageRunner, GATE_LABEL } from './stages.js';
import { GATE_APPROVERS } from '../services/approvals.js';

const TERMINAL: TaskStatus[] = ['DONE', 'FAILED', 'CANCELLED'];
export const isTerminal = (t?: Task) => !!t && TERMINAL.includes(t.status);

export interface NewTask {
  stage: string; phase: Phase; roleKey: string; title: string; description?: string; input?: Record<string, unknown>;
  dependsOn?: string[]; exclude?: string[]; round?: number; assigneeId?: string | null;
}

/**
 * Drives every ACTIVE project through the workflow. State lives in the DB; the engine is a
 * deterministic function of that state, so it is restart-safe and idempotent per tick.
 */
export class EngineCore {
  readonly runner: StageRunner;
  private inflight = new Set<string>();
  private projectLocks = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private kicked = false;
  phaseHandler: (p: Project) => Promise<void> = async () => undefined;

  constructor(readonly s: Services) { this.runner = new StageRunner(s); }

  /** After a restart: interrupted runs are marked failed and their tasks re-queued. */
  async recover(): Promise<void> {
    await this.s.db.update(agentRuns).set({ status: 'FAILED', errorClass: 'INTERRUPTED', errorMessage: 'Interrupted by company OS restart', finishedAt: new Date() }).where(inArray(agentRuns.status, ['RUNNING', 'QUEUED']));
    await this.s.db.update(tasksTable).set({ status: 'READY' }).where(eq(tasksTable.status, 'WORKING'));
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    const loop = async () => {
      try { await this.tick(); } catch (e) { console.error('[engine] tick failed', e); }
      this.timer = setTimeout(loop, this.kicked ? 200 : intervalMs);
      this.kicked = false;
    };
    this.timer = setTimeout(loop, 500);
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  kick(): void { this.kicked = true; }
  get running(): number { return this.inflight.size; }

  async tick(): Promise<void> {
    await this.unblockRuntimeTasks();
    for (const p of await this.s.projects.active()) {
      if (this.projectLocks.has(p.id)) continue;
      this.projectLocks.add(p.id);
      try {
        await this.dispatch(p);
        const fresh = await this.s.projects.get(p.id);
        if (fresh?.status === 'ACTIVE') await this.phaseHandler(fresh);
      } catch (e) {
        await this.s.bus.emit('SYSTEM', `Workflow error on ${p.code}: ${String((e as Error).message).slice(0, 300)}`, { projectId: p.id });
      } finally { this.projectLocks.delete(p.id); }
    }
  }

  /** Start runnable tasks (dependencies done). Execution is async; concurrency is bounded by the Kiro pool. */
  private async dispatch(p: Project): Promise<void> {
    for (const t of await this.s.tasks.runnable(p.id)) {
      if (this.inflight.has(t.id)) continue;
      this.inflight.add(t.id);
      void this.runner.run(t.id).finally(() => { this.inflight.delete(t.id); this.kick(); });
    }
  }

  /** Tasks paused for runtime reasons resume when Kiro is back, or when the Owner approved fallback. */
  private async unblockRuntimeTasks(): Promise<void> {
    const blocked = (await this.s.tasks.list({ status: ['BLOCKED'] })).filter((t) => t.blockedReason?.startsWith('RUNTIME:'));
    if (!blocked.length) return;
    const kiroOk = this.s.kiro.acceptingJobs().ok;
    for (const t of blocked) {
      const fb = t.projectId ? (await this.s.approvals.list({ projectId: t.projectId })).find((a) => a.gate === 'FALLBACK_USAGE' && a.taskId === t.id) : undefined;
      if (kiroOk) await this.s.tasks.update(t.id, { status: 'READY', blockedReason: null });
      else if (fb?.status === 'APPROVED' && t.input.allowFallback !== true) await this.s.tasks.update(t.id, { status: 'READY', blockedReason: null, input: { ...t.input, allowFallback: true } });
    }
  }

  // ───────── helpers used by phase handlers ─────────

  async latest(p: Project, stage: string): Promise<Task | undefined> { return (await this.s.tasks.byStage(p.id, stage))[0]; }
  async all(p: Project, stage: string): Promise<Task[]> { return this.s.tasks.byStage(p.id, stage); }

  async create(p: Project, t: NewTask): Promise<Task> {
    return this.s.tasks.create({ projectId: p.id, ...t });
  }

  async enter(p: Project, phase: Phase, reason: string): Promise<void> {
    await this.s.projects.enterPhase(p.id, phase, reason);
    this.kick();
  }

  /**
   * Handles a FAILED (non-runtime) task: retry up to maxTaskRevisions times, then escalate to the Owner.
   * Returns true when the caller should wait.
   */
  async handleFailed(p: Project, t: Task, rebuild: () => NewTask): Promise<boolean> {
    const pol = this.s.policies();
    const failures = (await this.all(p, t.stage)).filter((x) => x.status === 'FAILED' && x.round === t.round).length;
    if (t.result?.retriedBy) return true;
    if (failures <= pol.limits.maxTaskRevisions) {
      const spec = rebuild();
      const retry = await this.create(p, { ...spec, round: t.round, input: { ...spec.input, previousFailure: t.blockedReason } });
      await this.s.tasks.update(t.id, { result: { ...(t.result ?? {}), retriedBy: retry.id } });
      return true;
    }
    await this.escalate(p, `${t.code} (${t.title}) failed ${failures} times`, t.blockedReason ?? 'unknown error', { stage: t.stage, taskId: t.id });
    return true;
  }

  /** Escalation to the Owner pauses the project's flow until decided (recorded as an ESCALATION approval). */
  async escalate(p: Project, title: string, details: string, payload: Record<string, unknown>): Promise<void> {
    const pending = (await this.s.approvals.list({ projectId: p.id, status: 'PENDING' })).find((a) => a.gate === 'ESCALATION');
    if (pending) return;
    await this.s.approvals.request({
      projectId: p.id, gate: 'ESCALATION', title: `Escalation: ${title}`, reason: details.slice(0, 3000),
      alternatives: 'APPROVE = accept current state and continue; REQUEST REVISION = one more attempt with your guidance; REJECT = pause the project.',
      recommendation: 'Review the evidence; provide guidance if requesting another attempt.', payload,
    });
    await this.s.bus.emit('ESCALATION', `${p.code} escalated to the Owner: ${title}`, { projectId: p.id });
  }

  /** Latest escalation decision for a stage key (used to resume after Owner decision). */
  async escalationFor(p: Project, stage: string) {
    return (await this.s.approvals.list({ projectId: p.id })).find((a) => a.gate === 'ESCALATION' && a.payload.stage === stage);
  }

  /**
   * Generic stage gate: request approval → reviewer agent (CEO/CTO) decides via ApprovalService →
   * on REVISION, create an author revision (bounded by maxReviewRounds, then Owner decides).
   * Returns 'approved' only when the DB holds an APPROVED record for this gate.
   */
  async gateStep(p: Project, cfg: { gate: Gate; authorStage: string; reviewStage: string; phase: Phase; reviseAuthor: (author: Task, feedback: string, round: number) => NewTask; evidence?: () => Promise<string> }): Promise<'approved' | 'waiting'> {
    const author = await this.latest(p, cfg.authorStage);
    if (!author || author.status !== 'DONE') return 'waiting';
    const appr = await this.s.approvals.latest(p.id, cfg.gate);
    const def = GATE_APPROVERS[cfg.gate];
    const label = GATE_LABEL[cfg.gate] ?? cfg.gate;
    const ownerGates = this.s.policies().gateApprover === 'OWNER';
    const stale = !!appr?.decidedAt && author.createdAt > appr.decidedAt;
    if (appr?.status === 'APPROVED' && !stale) return 'approved';
    if (appr?.status === 'REJECTED' && !stale) {
      await this.s.projects.setStatus(p.id, 'PAUSED', `${label} rejected: ${appr.decisionNote ?? ''}`, { type: 'SYSTEM', name: 'WorkflowEngine' });
      return 'waiting';
    }
    if (appr?.status === 'PENDING') {
      if (appr.approverRole !== 'OWNER' && ownerGates) {
        await this.s.approvals.reassignToOwner(appr.id, 'Owner policy: the Owner approves every stage gate');
        return 'waiting';
      }
      if (appr.approverRole !== 'OWNER') {
        const reviews = await this.all(p, cfg.reviewStage);
        if (!reviews.some((r) => r.input.approvalId === appr.id && r.status !== 'FAILED')) {
          const evidence = cfg.evidence ? await cfg.evidence() : '';
          await this.create(p, { stage: cfg.reviewStage, phase: cfg.phase, roleKey: def.role, title: `${label} gate review (${appr.code})`, input: { approvalId: appr.id, gate: cfg.gate, gateLabel: label, evidence }, exclude: author.assigneeId ? [author.assigneeId] : [] });
        }
      }
      return 'waiting';
    }
    const fresh = !appr || (appr.decidedAt && author.createdAt > appr.decidedAt);
    if (fresh) {
      // New deliverable without a decision yet → request approval (Owner decides directly by policy, or once executive rounds are exhausted).
      const round = (p.counters[`${cfg.gate}_reviews`] ?? 0);
      const toOwner = ownerGates || round >= this.s.policies().limits.maxReviewRounds;
      const artifactsList = (await this.s.db.query.artifacts.findMany({ where: (a, { eq: e }) => e(a.taskId, author.id) })).map((a) => ({ label: `${a.title} v${a.version}`, kind: 'artifact' as const, ref: a.id }));
      const evidenceText = ownerGates && cfg.evidence ? (await cfg.evidence()).slice(0, 6000) : '';
      await this.s.approvals.request({
        projectId: p.id, taskId: author.id, gate: cfg.gate, title: `${label} approval — ${p.name}${author.round > 1 ? ` (revision ${author.round})` : ''}`,
        requestedById: author.assigneeId, approverRole: toOwner ? 'OWNER' : def.role, requiredAuthority: toOwner ? 100 : def.authority,
        reason: ownerGates ? `${label} deliverable ready for the Owner's decision (Owner policy: the Owner approves every stage gate).${cfg.gate === 'RELEASE' ? ' Approving the release also authorises production deployment.' : ''}${evidenceText ? `\n\n${evidenceText}` : ''}` : toOwner ? `Executive review rounds exhausted (${round}); the Owner decides.` : `${label} deliverable ready for ${def.role.toUpperCase()} review.`,
        evidence: artifactsList, recommendation: toOwner ? 'Read the deliverable; approve, or request a revision with specific guidance.' : '',
      });
      return 'waiting';
    }
    // REVISION_REQUESTED and no newer author deliverable → create the revision (bounded).
    const n = await this.s.projects.bumpCounter(p.id, `${cfg.gate}_reviews`);
    await this.create(p, cfg.reviseAuthor(author, appr!.decisionNote ?? 'Revise per review', author.round + 1));
    await this.s.messages.send({ projectId: p.id, fromEmployeeId: null, toEmployeeId: author.assigneeId, type: 'TASK', subject: `${label} revision ${n} requested`, body: appr!.decisionNote ?? '' });
    return 'waiting';
  }

  /**
   * Bounded fix loop after a failed check (integration, code review, QA, security, staging...).
   * Attempts 1..max → engineers; max+1 → team lead; beyond → CTO escalation to the Owner.
   * After a fix merges, the pipeline re-enters INTEGRATION so every downstream check re-runs.
   */
  async fixLoop(p: Project, failedTask: Task, source: string, details: string, phase: Phase, suite?: string): Promise<void> {
    if (failedTask.result?.fixTaskId) {
      const fix = await this.s.tasks.get(String(failedTask.result.fixTaskId));
      if (!fix || !isTerminal(fix)) return;
      if (fix.status === 'DONE' && fix.result?.merged !== false) { await this.s.projects.bumpCounter(p.id, 'cycle'); await this.enter(p, 'INTEGRATION', `Fix ${fix.code} merged — re-running integration and downstream checks`); return; }
      if (fix.status === 'DONE' && fix.result?.merged === false) { await this.conflict(p, fix); return; }
      if (fix.status === 'FAILED') { await this.handleFailed(p, fix, () => fixSpec(fix)); return; }
      return;
    }
    const pol = this.s.policies();
    const attempt = (p.counters.fixAttempts ?? 0) + 1;
    if (attempt > pol.limits.maxFixAttempts + 1) {
      const esc = await this.escalationFor(p, `fix:${failedTask.stage}:${attempt}`);
      if (!esc) { await this.escalate(p, `CTO escalation: ${source} still failing after ${attempt - 1} fix attempts`, details, { stage: `fix:${failedTask.stage}:${attempt}`, taskId: failedTask.id }); return; }
      if (esc.status === 'PENDING') return;
      if (esc.status === 'REJECTED') { await this.s.projects.setStatus(p.id, 'PAUSED', 'Owner paused after escalation', { type: 'SYSTEM', name: 'WorkflowEngine' }); return; }
      if (esc.status === 'APPROVED') {
        if (suite) await this.s.checks.record(p.id, suite, [{ name: `Accepted by Owner despite failures (${esc.code})`, status: 'PASS', details: esc.decisionNote ?? 'Owner accepted the risk', durationMs: 0 }], { taskId: failedTask.id });
        await this.s.tasks.update(failedTask.id, { result: { ...failedTask.result, ownerAccepted: true } });
        return;
      }
      details = `${details}\n\nOwner guidance: ${esc.decisionNote ?? ''}`;
    }
    await this.s.projects.bumpCounter(p.id, 'fixAttempts');
    const roleKey = attempt <= pol.limits.maxFixAttempts ? (/frontend|ui|html|css|page|screen/i.test(details) && !/api|server|route/i.test(details) ? 'frontend-engineer' : 'backend-engineer') : 'backend-lead';
    const fix = await this.create(p, fixSpec({ title: `Fix: ${source} failure`, roleKey, phase, input: { source, details: details.slice(0, 12_000), title: `Fix ${source} failures` } } as never));
    await this.s.tasks.update(failedTask.id, { result: { ...failedTask.result, fixTaskId: fix.id } });
    await this.s.messages.send({ projectId: p.id, fromEmployeeId: null, toEmployeeId: fix.assigneeId, type: 'TASK', subject: `${source} failed — fix assigned (${fix.code})`, body: details.slice(0, 2000), taskId: fix.id });
  }

  /** Merge conflict → integration engineer resolves in a worktree with the merge in progress. */
  async conflict(p: Project, t: Task): Promise<void> {
    if (t.result?.integrateTaskId) return;
    const it = await this.create(p, { stage: 'engineering.integrate', phase: 'DEVELOPMENT', roleKey: 'integration-engineer', title: `Resolve merge conflicts from ${t.code}`, input: { branch: `agent/${t.code}`, conflicts: t.result?.conflicts ?? [], sourceTaskId: t.id } });
    await this.s.tasks.update(t.id, { result: { ...t.result, integrateTaskId: it.id } });
  }
}

function fixSpec(t: { title: string; roleKey: string; phase: Phase | null; input: Record<string, unknown> }): NewTask {
  return { stage: 'engineering.fix', phase: (t.phase ?? 'INTEGRATION') as Phase, roleKey: t.roleKey, title: t.title, input: t.input };
}
