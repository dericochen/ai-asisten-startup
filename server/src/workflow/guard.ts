import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { checkRuns, releases, company, type Phase } from '../db/schema.js';
import { ENTRY_REQUIREMENTS, ENGINEERING_STAGES_PREFIX, type Requirement } from './phases.js';
import type { ApprovalService } from '../services/approvals.js';

export class GateLockedError extends Error {
  constructor(public readonly unmet: string[]) { super(`Workflow gate locked: ${unmet.join('; ')}`); this.name = 'GateLockedError'; }
}

export interface RequirementStatus { label: string; met: boolean; detail?: string }

export class WorkflowGuard {
  constructor(private db: DB, private approvals: ApprovalService) {}

  async latestSuite(projectId: string, suite: string) {
    return (await this.db.select().from(checkRuns).where(and(eq(checkRuns.projectId, projectId), eq(checkRuns.suite, suite), eq(checkRuns.name, 'summary'))).orderBy(desc(checkRuns.createdAt)).limit(1))[0];
  }

  async latestRelease(projectId: string) {
    return (await this.db.select().from(releases).where(eq(releases.projectId, projectId)).orderBy(desc(releases.createdAt)).limit(1))[0];
  }

  private async evaluate(projectId: string, r: Requirement): Promise<RequirementStatus> {
    switch (r.kind) {
      case 'approval': {
        const a = await this.approvals.latest(projectId, r.gate);
        return { label: r.label, met: a?.status === 'APPROVED', detail: a ? `${a.code} ${a.status}` : 'not requested' };
      }
      case 'checks': {
        const c = await this.latestSuite(projectId, r.suite);
        return { label: r.label, met: c?.status === 'PASS', detail: c ? c.status : 'not run' };
      }
      case 'release': {
        const rel = await this.latestRelease(projectId);
        return { label: r.label, met: !!rel && r.status.includes(rel.status), detail: rel ? `v${rel.version} ${rel.status}` : 'no release' };
      }
      case 'deployPolicy': {
        const c = (await this.db.select().from(company).limit(1))[0];
        const mode = c?.policies.deploymentMode ?? 'OWNER_APPROVAL';
        if (mode === 'AUTO_AFTER_CHECKS' || mode === 'CEO_APPROVAL') return { label: r.label, met: true, detail: mode };
        const a = await this.approvals.latest(projectId, 'PRODUCTION_DEPLOY');
        if (a?.status === 'APPROVED') return { label: r.label, met: true, detail: `${mode}: ${a.code} APPROVED` };
        const rel = await this.approvals.latest(projectId, 'RELEASE');
        if (mode === 'OWNER_APPROVAL' && (c?.policies.gateApprover ?? 'OWNER') === 'OWNER' && rel?.status === 'APPROVED' && rel.decidedBy === 'OWNER') {
          return { label: r.label, met: true, detail: `${mode}: Owner approved release ${rel.code} (authorises production)` };
        }
        return { label: r.label, met: false, detail: `${mode}: ${a ? `${a.code} ${a.status}` : 'awaiting Owner'}` };
      }
    }
  }

  async requirements(projectId: string, phase: Phase): Promise<RequirementStatus[]> {
    const reqs = ENTRY_REQUIREMENTS[phase] ?? [];
    return Promise.all(reqs.map((r) => this.evaluate(projectId, r)));
  }

  async assertCanEnter(projectId: string, phase: Phase): Promise<void> {
    const unmet = (await this.requirements(projectId, phase)).filter((r) => !r.met).map((r) => `${r.label} (${r.detail})`);
    if (unmet.length) throw new GateLockedError(unmet);
  }

  /** ENGINEERING_IMPLEMENTATION_LOCKED unless research, product, design (CEO) and architecture approvals exist. */
  async engineeringLock(projectId: string): Promise<{ locked: boolean; unmet: string[] }> {
    const unmet = (await this.requirements(projectId, 'DEVELOPMENT')).filter((r) => !r.met).map((r) => r.label);
    return { locked: unmet.length > 0, unmet };
  }

  async assertStageAllowed(projectId: string | null, stage: string): Promise<void> {
    if (!projectId || !stage.startsWith(ENGINEERING_STAGES_PREFIX)) return;
    const lock = await this.engineeringLock(projectId);
    if (lock.locked) throw new GateLockedError(lock.unmet.map((u) => `${u} — ENGINEERING_IMPLEMENTATION_LOCKED`));
  }
}
