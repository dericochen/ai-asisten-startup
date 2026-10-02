import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { approvals, type ApprovalStatus, type Evidence, type Gate } from '../db/schema.js';
import { nextCode, type AuditService, type EventBus } from '../core/events.js';
import type { OrganizationService } from '../org/service.js';
import type { NotificationService } from './records.js';

export type Approval = typeof approvals.$inferSelect;

export type Actor =
  | { type: 'OWNER'; id: string; name: string }
  | { type: 'AGENT'; employeeId: string; name: string }
  | { type: 'SYSTEM'; name: string };

export class AuthorityError extends Error { constructor(msg: string) { super(msg); this.name = 'AuthorityError'; } }

/** Who must decide each gate. Authority thresholds are enforced in code, not prompts. */
export const GATE_APPROVERS: Record<Gate, { role: string; authority: number }> = {
  RESEARCH: { role: 'ceo', authority: 90 },
  PRODUCT: { role: 'ceo', authority: 90 },
  DESIGN: { role: 'ceo', authority: 90 },
  ARCHITECTURE: { role: 'cto', authority: 80 },
  RELEASE: { role: 'ceo', authority: 90 },
  PRODUCTION_DEPLOY: { role: 'OWNER', authority: 100 },
  FALLBACK_USAGE: { role: 'OWNER', authority: 100 },
  DESTRUCTIVE_ACTION: { role: 'OWNER', authority: 100 },
  ESCALATION: { role: 'OWNER', authority: 100 },
};

export class ApprovalService {
  constructor(private db: DB, private bus: EventBus, private audit: AuditService, private org: OrganizationService, private notify: NotificationService) {}

  async request(a: {
    projectId: string | null; taskId?: string | null; gate: Gate; title: string; requestedById?: string | null;
    approverRole?: string; requiredAuthority?: number; reason?: string; evidence?: Evidence[]; alternatives?: string; risks?: string;
    impact?: string; cost?: string; recommendation?: string; payload?: Record<string, unknown>;
  }): Promise<Approval> {
    const def = GATE_APPROVERS[a.gate];
    const approverRole = a.approverRole ?? def.role;
    const requiredAuthority = Math.max(a.requiredAuthority ?? def.authority, def.authority);
    const code = await nextCode(this.db, 'APR');
    const [row] = await this.db.insert(approvals).values({
      code, projectId: a.projectId, taskId: a.taskId ?? null, gate: a.gate, title: a.title, requestedById: a.requestedById ?? null,
      approverRole, requiredAuthority, reason: a.reason ?? '', evidence: a.evidence ?? [], alternatives: a.alternatives ?? '', risks: a.risks ?? '',
      impact: a.impact ?? '', cost: a.cost ?? '', recommendation: a.recommendation ?? '', payload: a.payload ?? {},
    }).returning();
    const ownerGate = approverRole === 'OWNER';
    await this.bus.emit(ownerGate ? 'OWNER_APPROVAL_REQUIRED' : 'CEO_APPROVAL_REQUIRED', `${code}: ${a.title}`, { projectId: a.projectId, taskId: a.taskId, data: { approvalId: row.id, gate: a.gate, approverRole } });
    if (ownerGate) await this.notify.notifyOwner({ projectId: a.projectId, category: a.gate === 'FALLBACK_USAGE' ? 'FALLBACK' : 'APPROVAL', severity: 'WARNING', title: `Approval required: ${a.title}`, body: a.reason });
    return row;
  }

  /**
   * Decide an approval. Verifies (1) it is pending, (2) the actor's authority meets the requirement,
   * (3) the actor holds the required role (or is the Owner, who can decide anything),
   * (4) the actor is not the requester (independence).
   */
  async decide(approvalId: string, actor: Actor, decision: 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED', note: string): Promise<Approval> {
    const row = (await this.db.select().from(approvals).where(eq(approvals.id, approvalId)))[0];
    if (!row) throw new AuthorityError('Approval not found');
    if (row.status !== 'PENDING') throw new AuthorityError(`Approval ${row.code} is already ${row.status}`);
    let authority = 0;
    let decidedBy = '';
    if (actor.type === 'OWNER') { authority = 100; decidedBy = 'OWNER'; }
    else if (actor.type === 'AGENT') {
      authority = await this.org.authorityOf(actor.employeeId);
      decidedBy = actor.employeeId;
      const emp = await this.org.employee(actor.employeeId);
      if (row.approverRole === 'OWNER') throw new AuthorityError(`${row.code} requires the Owner; agents cannot decide it`);
      if (emp?.roleKey !== row.approverRole && authority < 90) throw new AuthorityError(`${actor.name} does not hold the ${row.approverRole} role required for ${row.code}`);
      if (row.requestedById && row.requestedById === actor.employeeId) throw new AuthorityError('The requester cannot approve their own request');
    } else throw new AuthorityError('System actors cannot decide approvals');
    if (authority < row.requiredAuthority) throw new AuthorityError(`Authority ${authority} is below the required ${row.requiredAuthority} for ${row.code}`);

    const [updated] = await this.db.update(approvals).set({
      status: decision, decidedBy, decidedByName: actor.name, decidedByAuthority: authority, decisionNote: note.slice(0, 4000), decidedAt: new Date(),
    }).where(and(eq(approvals.id, approvalId), eq(approvals.status, 'PENDING'))).returning();
    if (!updated) throw new AuthorityError('Approval was decided concurrently');
    await this.audit.log(actor.type === 'OWNER' ? { type: 'OWNER', id: actor.id, name: actor.name } : { type: 'AGENT', id: decidedBy, name: actor.name }, `approval.${decision.toLowerCase()}`, row.code, { gate: row.gate, note: note.slice(0, 500), authority });
    await this.bus.emit('APPROVAL_DECIDED', `${row.code} ${decision.replace('_', ' ').toLowerCase()} by ${actor.name}`, { projectId: row.projectId, taskId: row.taskId, data: { approvalId, decision, gate: row.gate } });
    return updated;
  }

  /** Moves a pending executive approval to the Owner (authority 100). Recorded in the audit log. */
  async reassignToOwner(approvalId: string, reason: string): Promise<void> {
    const row = await this.get(approvalId);
    if (!row || row.status !== 'PENDING' || row.approverRole === 'OWNER') return;
    await this.db.update(approvals).set({ approverRole: 'OWNER', requiredAuthority: 100, reason: `${row.reason}\n\n${reason}` }).where(and(eq(approvals.id, approvalId), eq(approvals.status, 'PENDING')));
    await this.audit.log({ type: 'SYSTEM', name: 'ApprovalService' }, 'approval.reassigned_to_owner', row.code, { from: row.approverRole, reason });
    await this.bus.emit('OWNER_APPROVAL_REQUIRED', `${row.code}: ${row.title}`, { projectId: row.projectId, taskId: row.taskId, data: { approvalId, gate: row.gate, approverRole: 'OWNER' } });
    await this.notify.notifyOwner({ projectId: row.projectId, category: 'APPROVAL', severity: 'WARNING', title: `Approval required: ${row.title}`, body: reason });
  }

  async cancelPending(projectId: string, gate: Gate): Promise<void> {
    await this.db.update(approvals).set({ status: 'CANCELLED' }).where(and(eq(approvals.projectId, projectId), eq(approvals.gate, gate), eq(approvals.status, 'PENDING')));
  }

  async latest(projectId: string, gate: Gate): Promise<Approval | undefined> {
    return (await this.db.select().from(approvals).where(and(eq(approvals.projectId, projectId), eq(approvals.gate, gate))).orderBy(desc(approvals.createdAt)).limit(1))[0];
  }

  async isApproved(projectId: string, gate: Gate): Promise<boolean> {
    return (await this.latest(projectId, gate))?.status === 'APPROVED';
  }

  async list(filter: { status?: ApprovalStatus; projectId?: string } = {}): Promise<Approval[]> {
    const conds = [filter.status ? eq(approvals.status, filter.status) : undefined, filter.projectId ? eq(approvals.projectId, filter.projectId) : undefined].filter(Boolean);
    return this.db.select().from(approvals).where(conds.length ? and(...conds) : undefined).orderBy(desc(approvals.createdAt)).limit(200);
  }

  async get(id: string): Promise<Approval | undefined> { return (await this.db.select().from(approvals).where(eq(approvals.id, id)))[0]; }
}
