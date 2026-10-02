import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { artifacts, decisions, meetings, memories, messages, notifications, type ArtifactKind, type MessageType } from '../db/schema.js';
import { nextCode, type EventBus } from '../core/events.js';

export class ArtifactService {
  constructor(private db: DB, private bus: EventBus) {}

  /** Saves a new version of (project, kind, title). Older versions are kept. */
  async save(a: { projectId: string | null; taskId?: string | null; kind: ArtifactKind; title: string; content: string; data?: Record<string, unknown>; authorId?: string | null; format?: string }) {
    const prev = await this.db.select({ v: artifacts.version }).from(artifacts)
      .where(and(a.projectId ? eq(artifacts.projectId, a.projectId) : isNull(artifacts.projectId), eq(artifacts.kind, a.kind), eq(artifacts.title, a.title)))
      .orderBy(desc(artifacts.version)).limit(1);
    const version = (prev[0]?.v ?? 0) + 1;
    const [row] = await this.db.insert(artifacts).values({ projectId: a.projectId, taskId: a.taskId ?? null, kind: a.kind, title: a.title, content: a.content, data: a.data ?? null, authorId: a.authorId ?? null, version, format: a.format ?? 'markdown' }).returning();
    await this.bus.emit('ARTIFACT_CREATED', `${a.title} v${version} saved`, { projectId: a.projectId, taskId: a.taskId, employeeId: a.authorId, data: { artifactId: row.id, kind: a.kind, version } });
    return row;
  }

  async latest(projectId: string, kind: ArtifactKind) {
    return (await this.db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.kind, kind))).orderBy(desc(artifacts.createdAt)).limit(1))[0];
  }

  async allLatest(projectId: string, kind: ArtifactKind) {
    return this.db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.kind, kind))).orderBy(desc(artifacts.createdAt));
  }
}

export class DecisionService {
  constructor(private db: DB, private bus: EventBus) {}
  async record(d: { projectId: string | null; title: string; decision: string; reason: string; proposedBy: string; reviewedBy?: string[]; approvedBy?: string | null; status?: string }) {
    const code = await nextCode(this.db, 'DEC');
    const [row] = await this.db.insert(decisions).values({ code, projectId: d.projectId, title: d.title, decision: d.decision, reason: d.reason, proposedBy: d.proposedBy, reviewedBy: d.reviewedBy ?? [], approvedBy: d.approvedBy ?? null, status: d.status ?? 'ACCEPTED' }).returning();
    await this.bus.emit('DECISION_RECORDED', `${code}: ${d.title}`, { projectId: d.projectId, data: { decisionId: row.id } });
    return row;
  }
}

export class MeetingService {
  constructor(private db: DB, private bus: EventBus) {}
  async record(m: { projectId: string | null; type: string; title: string; participants: string[]; agenda: string[]; positions: { who: string; position: string }[]; evidence?: string[]; objections?: string[]; decision: string; actionItems?: string[] }) {
    const [row] = await this.db.insert(meetings).values({ ...m, evidence: m.evidence ?? [], objections: m.objections ?? [], actionItems: m.actionItems ?? [] }).returning();
    await this.bus.emit('MEETING_HELD', `${m.title}: ${m.decision.slice(0, 120)}`, { projectId: m.projectId, data: { meetingId: row.id, type: m.type } });
    return row;
  }
}

export class MessageService {
  constructor(private db: DB) {}
  async send(m: { projectId: string | null; fromEmployeeId: string | null; toEmployeeId: string | null; type: MessageType; subject: string; body?: string; taskId?: string | null }) {
    const [row] = await this.db.insert(messages).values({ ...m, body: m.body ?? '', taskId: m.taskId ?? null }).returning();
    return row;
  }
}

/**
 * Owner notification policy: only approvals, major blockers, budget, incidents, security concerns,
 * scope changes, CEO escalations and completion reach the Owner.
 */
export const OWNER_NOTIFY_CATEGORIES = ['APPROVAL', 'BLOCKER', 'BUDGET', 'INCIDENT', 'SECURITY', 'SCOPE', 'ESCALATION', 'COMPLETION', 'FALLBACK'] as const;
export type NotifyCategory = typeof OWNER_NOTIFY_CATEGORIES[number];

export class NotificationService {
  constructor(private db: DB, private bus: EventBus) {}
  async notifyOwner(n: { projectId?: string | null; category: NotifyCategory; severity?: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; body?: string }) {
    const [row] = await this.db.insert(notifications).values({ projectId: n.projectId ?? null, category: n.category, severity: n.severity ?? 'INFO', title: n.title, body: n.body ?? '' }).returning();
    await this.bus.emit('NOTIFICATION', n.title, { projectId: n.projectId, data: { notificationId: row.id, category: n.category, severity: n.severity ?? 'INFO' } });
    return row;
  }
  async list(limit = 50) { return this.db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit); }
  async markRead(id: string) { await this.db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)); }
  async markAllRead() { await this.db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt)); }
}

/** Company memory with Postgres full-text retrieval — agents receive only relevant memories. */
export class MemoryService {
  constructor(private db: DB) {}
  async remember(m: { scope: 'COMPANY' | 'PROJECT' | 'EMPLOYEE'; projectId?: string | null; employeeId?: string | null; kind: string; content: string; tags?: string[] }) {
    await this.db.insert(memories).values({ scope: m.scope, projectId: m.projectId ?? null, employeeId: m.employeeId ?? null, kind: m.kind, content: m.content.slice(0, 4000), tags: m.tags ?? [] });
  }

  async retrieve(query: string, opts: { projectId?: string | null; limit?: number } = {}): Promise<{ kind: string; content: string; scope: string }[]> {
    const terms = Array.from(new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])).slice(0, 24);
    const limit = opts.limit ?? 6;
    const scopeCond = opts.projectId ? or(eq(memories.scope, 'COMPANY'), eq(memories.projectId, opts.projectId)) : eq(memories.scope, 'COMPANY');
    if (!terms.length) {
      return this.db.select({ kind: memories.kind, content: memories.content, scope: memories.scope }).from(memories).where(scopeCond).orderBy(desc(memories.createdAt)).limit(limit);
    }
    const tsq = terms.join(' | ');
    return this.db.select({ kind: memories.kind, content: memories.content, scope: memories.scope }).from(memories)
      .where(and(scopeCond, sql`to_tsvector('english', ${memories.content}) @@ to_tsquery('english', ${tsq})`))
      .orderBy(sql`ts_rank(to_tsvector('english', ${memories.content}), to_tsquery('english', ${tsq})) desc`).limit(limit);
  }

  async list(limit = 100) { return this.db.select().from(memories).orderBy(desc(memories.createdAt)).limit(limit); }
}
