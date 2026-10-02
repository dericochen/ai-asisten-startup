import { EventEmitter } from 'node:events';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { events, auditLog, counters } from '../db/schema.js';
import { redact, redactString } from '../lib/redact.js';

export type EventType =
  | 'PROJECT_CREATED' | 'PROJECT_PHASE_CHANGED' | 'PROJECT_STATUS_CHANGED' | 'PROJECT_COMPLETED'
  | 'TASK_CREATED' | 'TASK_ASSIGNED' | 'TASK_STARTED' | 'TASK_PROGRESS' | 'TASK_COMPLETED' | 'TASK_FAILED' | 'TASK_BLOCKED'
  | 'REVIEW_REQUESTED' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED'
  | 'CEO_APPROVAL_REQUIRED' | 'OWNER_APPROVAL_REQUIRED' | 'APPROVAL_DECIDED'
  | 'KIRO_STATUS_CHANGED' | 'KIRO_LIMIT_REACHED' | 'KIRO_UNAVAILABLE' | 'KIRO_WORKER_ALLOCATED' | 'KIRO_RUN_STARTED' | 'KIRO_RUN_FINISHED'
  | 'FALLBACK_ACTIVATED' | 'FALLBACK_APPROVAL_REQUIRED'
  | 'AGENT_ACTIVITY' | 'AGENT_TOOL_CALL'
  | 'BUILD_STARTED' | 'BUILD_FAILED' | 'BUILD_PASSED' | 'TEST_FAILED' | 'CHECK_COMPLETED'
  | 'GIT_COMMIT' | 'GIT_MERGE'
  | 'RELEASE_CREATED' | 'STAGING_DEPLOYED' | 'STAGING_FAILED' | 'PRODUCTION_DEPLOYED' | 'PRODUCTION_HEALTH_FAILED' | 'ROLLBACK'
  | 'INCIDENT_CREATED' | 'INCIDENT_RESOLVED'
  | 'MEETING_HELD' | 'DECISION_RECORDED' | 'ARTIFACT_CREATED'
  | 'CEO_MESSAGE' | 'ESCALATION' | 'NOTIFICATION' | 'SYSTEM';

export interface CompanyEvent {
  id: number;
  type: EventType;
  projectId: string | null;
  taskId: string | null;
  employeeId: string | null;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
}

/** Transient events are broadcast live but not persisted (e.g. token streaming). */
const TRANSIENT: ReadonlySet<EventType> = new Set(['AGENT_ACTIVITY', 'TASK_PROGRESS']);

export class EventBus {
  private emitter = new EventEmitter();
  private transientSeq = 0;
  constructor(private db: DB) { this.emitter.setMaxListeners(200); }

  async emit(type: EventType, message: string, ref: { projectId?: string | null; taskId?: string | null; employeeId?: string | null; data?: Record<string, unknown> } = {}): Promise<CompanyEvent> {
    const data = redact(ref.data ?? {});
    const msg = redactString(message);
    let evt: CompanyEvent;
    if (TRANSIENT.has(type)) {
      evt = { id: -(++this.transientSeq), type, projectId: ref.projectId ?? null, taskId: ref.taskId ?? null, employeeId: ref.employeeId ?? null, message: msg, data, createdAt: new Date().toISOString() };
    } else {
      const [row] = await this.db.insert(events).values({ type, message: msg, projectId: ref.projectId ?? null, taskId: ref.taskId ?? null, employeeId: ref.employeeId ?? null, data }).returning();
      evt = { ...row, type: row.type as EventType, createdAt: row.createdAt.toISOString() };
    }
    this.emitter.emit('event', evt);
    return evt;
  }

  subscribe(fn: (e: CompanyEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}

export class AuditService {
  constructor(private db: DB) {}
  async log(actor: { type: 'OWNER' | 'AGENT' | 'SYSTEM'; id?: string | null; name?: string | null }, action: string, target: string | null, details: Record<string, unknown> = {}): Promise<void> {
    await this.db.insert(auditLog).values({ actorType: actor.type, actorId: actor.id ?? null, actorName: actor.name ?? null, action, target, details: redact(details) });
  }
}

/** Atomic, human-friendly sequential codes: PRJ-001, RES-014, DEC-003 ... */
export async function nextCode(db: DB, prefix: string, width = 3): Promise<string> {
  const rows = await db.insert(counters).values({ key: prefix, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${prefix}-${String(rows[0].value).padStart(width, '0')}`;
}
