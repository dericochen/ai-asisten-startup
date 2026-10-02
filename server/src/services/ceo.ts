import path from 'node:path';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { approvals, ceoMessages, employees, incidents, projects } from '../db/schema.js';
import type { Services } from '../core/container.js';
import { asString } from '../lib/extract.js';
import { config } from '../config.js';
import { RuntimeBlockedError } from './executor.js';

const ACTIONS_DOC = `Allowed actions (the platform validates and executes them; you never change state directly):
- {"type":"CREATE_PROJECT","name":"short product name","objective":"one sentence","description":"scope and requirements from the Owner","projectType":"WEBSITE|SAAS|DASHBOARD|FULL_STACK_APP|API|INTERNAL_TOOL|AUTOMATION","priority":"LOW|MEDIUM|HIGH|CRITICAL"}
- {"type":"PAUSE_PROJECT","project":"PRJ-001","reason":"..."} / {"type":"RESUME_PROJECT","project":"PRJ-001"}
- {"type":"DECIDE_APPROVAL","approval":"APR-001","decision":"APPROVE|REJECT|REVISE","note":"Owner's words"} — ONLY when the Owner explicitly instructs a decision on a pending approval.
- {"type":"RECORD_DIRECTIVE","content":"a standing Owner directive or company rule to remember"}
Use no actions for questions; answer from the company snapshot.`;

export class CeoService {
  constructor(private s: Services, private kick: () => void) {}

  async history(limit = 60) {
    return (await this.s.db.select().from(ceoMessages).orderBy(desc(ceoMessages.createdAt)).limit(limit)).reverse();
  }

  /** Accepts an Owner command; the CEO agent processes it asynchronously. */
  async submit(ownerId: string, ownerName: string, content: string) {
    const [msg] = await this.s.db.insert(ceoMessages).values({ role: 'OWNER', content: content.slice(0, 8000) }).returning();
    const [reply] = await this.s.db.insert(ceoMessages).values({ role: 'CEO', content: '', status: 'PENDING' }).returning();
    await this.s.audit.log({ type: 'OWNER', id: ownerId, name: ownerName }, 'ceo.command', null, { content: content.slice(0, 1000) });
    await this.s.bus.emit('CEO_MESSAGE', 'Owner sent a command to the CEO', { data: { messageId: msg.id } });
    void this.process(ownerId, ownerName, content, reply.id);
    return { message: msg, replyId: reply.id };
  }

  async snapshot(): Promise<string> {
    const db = this.s.db;
    const ps = await db.select().from(projects).orderBy(asc(projects.createdAt));
    const pend = await db.select().from(approvals).where(eq(approvals.status, 'PENDING'));
    const inc = await db.select().from(incidents).where(sql`${incidents.status} <> 'RESOLVED'`);
    const working = await db.select({ n: sql<number>`count(*)::int` }).from(employees).where(eq(employees.status, 'WORKING'));
    const byDept = await db.select({ d: employees.departmentKey, n: sql<number>`count(*)::int` }).from(employees).groupBy(employees.departmentKey);
    const total = byDept.reduce((a, x) => a + x.n, 0);
    const lines = [`Headcount: ${total} AI employees (${byDept.map((x) => `${x.d} ${x.n}`).join(', ')}). Currently working: ${working[0]?.n ?? 0}. Kiro runtime: ${this.s.kiro.health} (${this.s.kiro.healthReason}).`];
    for (const p of ps) {
      const prog = await this.s.projects.progress(p.id).catch(() => null);
      const health = await this.s.projects.health(p.id).catch(() => null);
      lines.push(`- ${p.code} "${p.name}" status ${p.status}, phase ${p.phase}, ${prog?.overall ?? p.progress}% (${prog?.groups.filter((g) => g.status === 'IN_PROGRESS').map((g) => `${g.label}: ${g.explanation}`).join('; ') ?? ''})${health?.blockers.length ? `; BLOCKERS: ${health.blockers.map((b) => `${b.code} ${b.reason.slice(0, 120)}`).join(' | ')}` : ''}${p.productionUrl ? `; production ${p.productionUrl}` : ''}`);
    }
    if (pend.length) lines.push('Pending approvals:', ...pend.map((a) => `- ${a.code} [${a.gate}] "${a.title}" approver ${a.approverRole}`));
    if (inc.length) lines.push('Open incidents:', ...inc.map((i) => `- ${i.code} ${i.severity} ${i.title} (${i.status})`));
    const mem = await this.s.memory.retrieve('owner directive rule policy', { limit: 8 });
    if (mem.length) lines.push('Standing directives:', ...mem.map((m) => `- ${m.content}`));
    return lines.join('\n');
  }

  private async process(ownerId: string, ownerName: string, content: string, replyId: string) {
    const ceo = await this.s.org.firstOfRole('ceo');
    const role = await this.s.org.role('ceo');
    if (!ceo || !role) return;
    const recent = (await this.history(10)).filter((m) => m.id !== replyId && m.status !== 'PENDING').slice(-8).map((m) => `${m.role}: ${m.content.slice(0, 600)}`).join('\n');
    const prompt = [
      `# Owner command\nYou are ${ceo.name}, CEO of the company. The Owner (final authority) wrote:\n"""${content}"""`,
      '## How you operate\nInterpret the Owner\'s goal. For new work, create a project — the platform then runs Research → Product → Design → Architecture → Engineering → Code review → QA → Security → Staging → Release → Production automatically with mandatory gates; you do not write code or do research yourself. For questions, answer concisely and factually from the snapshot (say what you do not know). Protect the Owner from operational noise.',
      `## Company snapshot (authoritative database state)\n${await this.snapshot()}`,
      recent ? `## Recent conversation\n${recent}` : '',
      `## ${ACTIONS_DOC}`,
      '## Output format (required)\nWrite your reply to the Owner in Markdown (short, executive tone). Then END with exactly one fenced ```json block:\n```json\n{"reply":"same reply text","actions":[]}\n```',
    ].filter(Boolean).join('\n\n');
    try {
      const res = await this.s.executor.execute({ task: null, employee: ceo, role, prompt, root: path.join(config.workspacesDir, '_executive'), label: 'Owner command', expectJson: true });
      const data = (res.extracted.data ?? {}) as { reply?: string; actions?: Record<string, unknown>[] };
      const results: Record<string, unknown>[] = [];
      for (const a of (Array.isArray(data.actions) ? data.actions : []).slice(0, 5)) results.push(await this.executeAction(a, ownerId, ownerName));
      const replyText = res.extracted.body || asString(data.reply) || '(no reply)';
      await this.s.db.update(ceoMessages).set({ content: replyText, status: 'DONE', actions: results, runId: res.runId }).where(eq(ceoMessages.id, replyId));
      await this.s.bus.emit('CEO_MESSAGE', `CEO replied${results.length ? ` and executed ${results.length} action(s)` : ''}`, { employeeId: ceo.id, data: { messageId: replyId } });
    } catch (e) {
      const msg = e instanceof RuntimeBlockedError ? e.message : `The CEO could not process this command: ${(e as Error).message}`;
      await this.s.db.update(ceoMessages).set({ content: msg, status: 'FAILED' }).where(eq(ceoMessages.id, replyId));
      await this.s.bus.emit('CEO_MESSAGE', 'CEO command failed', { data: { messageId: replyId } });
    } finally {
      await this.s.org.setStatus(ceo.id, 'IDLE', null, null);
    }
  }

  /** Executes one CEO-proposed action with the Owner's authority (the Owner issued the command). */
  async executeAction(a: Record<string, unknown>, ownerId: string, ownerName: string): Promise<Record<string, unknown>> {
    const type = String(a.type ?? '');
    try {
      switch (type) {
        case 'CREATE_PROJECT': {
          const name = asString(a.name).trim().slice(0, 120);
          if (!name) throw new Error('Project name missing');
          const p = await this.s.projects.create({
            name, objective: asString(a.objective, name).slice(0, 1000), description: asString(a.description).slice(0, 6000),
            type: /^[A-Z_]{3,30}$/.test(String(a.projectType)) ? String(a.projectType) : 'FULL_STACK_APP',
            priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(a.priority)) ? (a.priority as 'MEDIUM') : 'MEDIUM',
            ownerRequest: (await this.lastOwnerMessage()).slice(0, 4000),
          });
          this.kick();
          return { type, ok: true, project: p.code, projectId: p.id };
        }
        case 'PAUSE_PROJECT': case 'RESUME_PROJECT': {
          const p = await this.s.projects.byCode(String(a.project ?? ''));
          if (!p) throw new Error(`Unknown project ${String(a.project)}`);
          await this.s.projects.setStatus(p.id, type === 'PAUSE_PROJECT' ? 'PAUSED' : 'ACTIVE', asString(a.reason, 'Owner instruction via CEO'), { type: 'OWNER', id: ownerId, name: ownerName });
          this.kick();
          return { type, ok: true, project: p.code };
        }
        case 'DECIDE_APPROVAL': {
          const code = String(a.approval ?? '').toUpperCase();
          const row = (await this.s.db.select().from(approvals).where(eq(approvals.code, code)))[0];
          if (!row) throw new Error(`Unknown approval ${code}`);
          const decision = String(a.decision).toUpperCase() === 'APPROVE' ? 'APPROVED' : String(a.decision).toUpperCase() === 'REJECT' ? 'REJECTED' : 'REVISION_REQUESTED';
          await this.s.approvals.decide(row.id, { type: 'OWNER', id: ownerId, name: `${ownerName} (via CEO)` }, decision, asString(a.note, 'Owner instruction via CEO'));
          this.kick();
          return { type, ok: true, approval: code, decision };
        }
        case 'RECORD_DIRECTIVE': {
          const content = asString(a.content).slice(0, 2000);
          if (!content) throw new Error('Empty directive');
          await this.s.memory.remember({ scope: 'COMPANY', kind: 'DIRECTIVE', content: `Owner directive: ${content}`, tags: ['owner'] });
          return { type, ok: true };
        }
        default: throw new Error(`Action ${type} is not permitted`);
      }
    } catch (e) {
      return { type, ok: false, error: String((e as Error).message).slice(0, 300) };
    }
  }

  private async lastOwnerMessage(): Promise<string> {
    const row = (await this.s.db.select().from(ceoMessages).where(eq(ceoMessages.role, 'OWNER')).orderBy(desc(ceoMessages.createdAt)).limit(1))[0];
    return row?.content ?? '';
  }
}
