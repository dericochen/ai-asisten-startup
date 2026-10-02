import fs from 'node:fs';
import path from 'node:path';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { agentRuns, company, toolCalls, type CompanyPolicies } from '../db/schema.js';
import type { AuditService, EventBus } from '../core/events.js';
import type { KiroRuntimeManager } from '../kiro/runtime.js';
import { KiroError, fallbackTrigger, isRetryable, type KiroErrorClass } from '../kiro/errors.js';
import { isInside, type PermissionContext } from '../kiro/policy.js';
import { buildAgentProfile } from '../kiro/agents.js';
import type { FallbackConnections } from '../fallback/connections.js';
import { complete, estimateCost } from '../fallback/providers.js';
import type { OrganizationService, Employee, Role } from '../org/service.js';
import type { ApprovalService } from './approvals.js';
import type { Task } from './tasks.js';
import { extractResult, type Extracted } from '../lib/extract.js';
import { redact, redactString } from '../lib/redact.js';
import { config } from '../config.js';

export class RuntimeBlockedError extends Error {
  constructor(public readonly reason: string, public readonly trigger: string | null) { super(reason); this.name = 'RuntimeBlockedError'; }
}

export interface ExecuteRequest {
  task: Task | null;
  employee: Employee;
  role: Role;
  prompt: string;
  /** Directory the agent may touch. Defaults to an empty scratch dir for analysis-only roles. */
  root: string;
  label: string;
  /** Agent must end with a ```json block; one repair turn is attempted if it does not. */
  expectJson?: boolean;
  /** How fallback models (no tools) deliver: plain text, or file blocks the backend writes into root. */
  fallbackOutput?: 'text' | 'files';
  allowFallback?: boolean;
  timeoutMs?: number;
}

export interface ExecuteResult { text: string; extracted: Extracted; runtime: 'KIRO' | 'FALLBACK'; runId: string; credits: number; costUsd: number; provider: string; filesWritten?: string[] }

export class AgentExecutor {
  constructor(
    private db: DB, private bus: EventBus, private audit: AuditService, private kiro: KiroRuntimeManager,
    private fallback: FallbackConnections, private org: OrganizationService, private approvals: ApprovalService,
  ) {}

  private async policies(): Promise<CompanyPolicies> {
    const c = (await this.db.select().from(company).limit(1))[0];
    if (!c) throw new Error('Company not set up');
    return c.policies;
  }

  async refreshCredits(): Promise<number> {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const r = await this.db.select({ c: sql<number>`coalesce(sum(${agentRuns.credits}), 0)::float` }).from(agentRuns).where(and(eq(agentRuns.runtime, 'KIRO'), gte(agentRuns.createdAt, start)));
    const credits = r[0]?.c ?? 0;
    this.kiro.updateCredits(credits);
    return credits;
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const pol = await this.policies();
    const { employee, task } = req;
    fs.mkdirSync(req.root, { recursive: true });
    const permission: PermissionContext = {
      caps: req.role.capabilities, root: req.root,
      forbidden: [config.secretsDir, config.kiroHome, config.pgliteDir, path.join(config.dataDir, 'deploy')],
    };
    await this.org.setStatus(employee.id, task?.stage.includes('review') || task?.stage.includes('critic') ? 'REVIEWING' : 'WORKING', req.label, task?.id ?? null);

    let accepting = this.kiro.acceptingJobs();
    if (!accepting.ok && (accepting.reason === 'NOT_INSTALLED' || accepting.reason === 'AUTH') && Date.now() - Date.parse(this.kiro.detection.checkedAt) > 30_000) {
      await this.kiro.detect();
      accepting = this.kiro.acceptingJobs();
    }
    if (!accepting.ok) return this.viaFallbackPolicy(req, pol, fallbackTrigger(accepting.reason!) ?? 'KIRO_TEMPORARILY_UNAVAILABLE', accepting.message);

    const maxAttempts = 1 + Math.max(0, pol.limits.maxAgentRetries);
    let lastErr: KiroError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const [run] = await this.db.insert(agentRuns).values({
        taskId: task?.id ?? null, projectId: task?.projectId ?? null, employeeId: employee.id, runtime: 'KIRO', provider: 'kiro-cli',
        agentProfile: req.role.kiroAgent, prompt: redactString(req.prompt), status: 'QUEUED', attempt,
      }).returning();
      try {
        const res = await this.runKiro(req, run.id, permission, pol, attempt);
        return res;
      } catch (e) {
        const err = e instanceof KiroError ? e : new KiroError('UNKNOWN', String((e as Error).message));
        lastErr = err;
        const detail = (err.detail ?? {}) as { credits?: number };
        await this.db.update(agentRuns).set({ status: 'FAILED', errorClass: err.kind, errorMessage: redactString(err.message).slice(0, 2000), credits: detail.credits ?? 0, finishedAt: new Date() }).where(eq(agentRuns.id, run.id));
        await this.bus.emit(err.kind === 'USAGE_LIMIT' || err.kind === 'RATE_LIMITED' ? 'KIRO_LIMIT_REACHED' : 'KIRO_RUN_FINISHED', `Kiro run for ${req.label} failed (${err.kind}) attempt ${attempt}/${maxAttempts}`, { projectId: task?.projectId, taskId: task?.id, employeeId: employee.id, data: { error: err.message.slice(0, 300), kind: err.kind } });
        if (!isRetryable(err.kind) || !this.kiro.acceptingJobs().ok) break;
        await sleep(err.kind === 'RATE_LIMITED' ? 20_000 * attempt : 3_000 * attempt);
      }
    }
    const kind: KiroErrorClass = lastErr?.kind ?? 'UNKNOWN';
    const trigger = fallbackTrigger(kind) ?? (kind === 'UNKNOWN' ? 'KIRO_TIMEOUT_AFTER_RETRIES' : null);
    if (!trigger) throw lastErr ?? new Error('Kiro run failed');
    return this.viaFallbackPolicy(req, pol, trigger, lastErr?.message ?? 'Kiro failed');
  }

  private async runKiro(req: ExecuteRequest, runId: string, permission: PermissionContext, pol: CompanyPolicies, attempt: number): Promise<ExecuteResult> {
    const { task, employee } = req;
    const reuseKey = req.expectJson ? `run:${runId}` : undefined;
    let lastFlush = 0;
    let lastActivity = 0;
    const flush = async (full: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastFlush < 2500) return;
      lastFlush = now;
      await this.db.update(agentRuns).set({ output: redactString(full).slice(-60_000) }).where(eq(agentRuns.id, runId));
    };
    const job = {
      runId, agentProfile: req.role.kiroAgent, cwd: req.root, prompt: req.prompt, permission, reuseKey, label: `${employee.name}: ${req.label}`,
      timeoutMs: req.timeoutMs ?? pol.kiro.turnTimeoutMs,
      onStart: async ({ workerId, sessionId }: { workerId: number; sessionId: string }) => {
        await this.db.update(agentRuns).set({ status: 'RUNNING', startedAt: new Date(), workerId, kiroSessionId: sessionId }).where(eq(agentRuns.id, runId));
        await this.bus.emit('KIRO_WORKER_ALLOCATED', `Kiro runtime allocated worker #${workerId} to ${employee.name}`, { projectId: task?.projectId, taskId: task?.id, employeeId: employee.id, data: { workerId, sessionId, attempt } });
      },
      onText: (_chunk: string, full: string) => {
        void flush(full);
        const now = Date.now();
        if (now - lastActivity > 3000) {
          lastActivity = now;
          void this.bus.emit('AGENT_ACTIVITY', `${employee.name} is writing…`, { projectId: task?.projectId, taskId: task?.id, employeeId: employee.id, data: { tail: redactString(full.slice(-280)), runId } });
        }
      },
      onToolCall: (e: { toolCallId: string; toolName: string; title: string; status: string; decision?: { allow: boolean; reason: string }; rawInput?: Record<string, unknown> }) => {
        void (async () => {
          const input = e.rawInput ? redact(e.rawInput) : null;
          const trimmed = input && typeof input === 'object' ? JSON.parse(JSON.stringify(input, (_k, v) => (typeof v === 'string' && v.length > 1500 ? v.slice(0, 1500) + '…' : v))) : null;
          if (e.decision) {
            await this.db.insert(toolCalls).values({ runId, toolCallId: e.toolCallId, toolName: e.toolName, title: e.title.slice(0, 300), status: e.status, decision: e.decision.allow ? 'ALLOWED' : 'DENIED', reason: e.decision.reason, input: trimmed });
            await this.audit.log({ type: 'AGENT', id: employee.id, name: employee.name }, `tool.${e.decision.allow ? 'allowed' : 'denied'}`, e.toolName, { title: e.title.slice(0, 300), reason: e.decision.reason, task: task?.code, input: trimmed });
          } else if (e.status === 'pending') {
            await this.db.insert(toolCalls).values({ runId, toolCallId: e.toolCallId, toolName: e.toolName, title: e.title.slice(0, 300), status: 'started', decision: 'AUTO', input: trimmed });
          } else {
            await this.db.update(toolCalls).set({ status: e.status }).where(and(eq(toolCalls.runId, runId), eq(toolCalls.toolCallId, e.toolCallId)));
          }
          await this.org.setStatus(employee.id, 'WORKING', e.title.slice(0, 160), task?.id ?? null);
          await this.bus.emit('AGENT_TOOL_CALL', `${employee.name}: ${e.title.slice(0, 140)}${e.decision && !e.decision.allow ? ' — DENIED' : ''}`, { projectId: task?.projectId, taskId: task?.id, employeeId: employee.id, data: { tool: e.toolName, status: e.status, decision: e.decision?.allow === false ? 'DENIED' : undefined } });
        })().catch(() => undefined);
      },
    };
    let res = await this.kiro.execute(job);
    let text = res.text;
    let credits = res.credits;
    let extracted = extractResult(text);
    try {
      if (req.expectJson && !extracted.data) {
        // One repair turn in the same Kiro session — never more (no infinite loops).
        const repair = await this.kiro.execute({ ...job, prompt: `Your previous reply did not end with the required \`\`\`json result block (${extracted.error}). Reply now with ONLY that fenced \`\`\`json block, following the exact schema requested earlier.` });
        credits += repair.credits;
        const ex2 = extractResult(repair.text);
        if (ex2.data) { extracted = { body: extracted.body, data: ex2.data }; text = `${text}\n\n${repair.text}`; }
        res = { ...res, toolCalls: res.toolCalls + repair.toolCalls, durationMs: res.durationMs + repair.durationMs };
      }
    } finally { if (reuseKey) this.kiro.forget(reuseKey); }
    await flush(text, true);
    await this.db.update(agentRuns).set({
      status: 'SUCCEEDED', output: redactString(text).slice(-60_000), toolCalls: res.toolCalls, credits, durationMs: res.durationMs, finishedAt: new Date(), costEstimated: false,
    }).where(eq(agentRuns.id, runId));
    await this.bus.emit('KIRO_RUN_FINISHED', `${employee.name} finished ${req.label} on Kiro (${(res.durationMs / 1000).toFixed(0)}s, ${credits.toFixed(2)} credits)`, { projectId: task?.projectId, taskId: task?.id, employeeId: employee.id, data: { runId, credits } });
    await this.refreshCredits();
    return { text, extracted, runtime: 'KIRO', runId, credits, costUsd: 0, provider: 'kiro-cli' };
  }

  /** Apply the Owner's fallback policy: AUTO → run fallback; ASK_OWNER → pause + approval; DISABLED → pause. */
  private async viaFallbackPolicy(req: ExecuteRequest, pol: CompanyPolicies, trigger: string, why: string): Promise<ExecuteResult> {
    const { task, employee } = req;
    const connections = pol.fallbackEnabled ? await this.fallback.usable() : [];
    const forced = trigger === 'USER_FORCED_FALLBACK';
    if (!connections.length) throw new RuntimeBlockedError(`Kiro cannot continue (${trigger}: ${why}). No fallback provider is enabled — task paused until Kiro is available.`, trigger);
    if (pol.fallbackMode === 'DISABLED' && !forced) throw new RuntimeBlockedError(`Kiro cannot continue (${trigger}). Fallback is DISABLED — task paused until Kiro is available.`, trigger);
    if (pol.fallbackMode === 'ASK_OWNER' && !req.allowFallback && !forced) {
      const pending = task ? (await this.approvals.list({ status: 'PENDING', projectId: task.projectId ?? undefined })).find((a) => a.gate === 'FALLBACK_USAGE' && a.taskId === task.id) : undefined;
      if (!pending) {
        await this.approvals.request({
          projectId: task?.projectId ?? null, taskId: task?.id ?? null, gate: 'FALLBACK_USAGE', title: `Use fallback AI for ${task?.code ?? req.label}`,
          requestedById: null, reason: `Kiro cannot continue: ${trigger} — ${why.slice(0, 300)}`,
          impact: `${employee.name} would run "${req.label}" on ${connections[0].name} (${connections[0].model}).`,
          cost: connections[0].costInputPerMTok != null ? `≈ $${connections[0].costInputPerMTok}/M input tokens, $${connections[0].costOutputPerMTok}/M output tokens` : 'Estimated — provider pricing not configured',
          alternatives: 'Reject to keep the task paused until Kiro is available again.', recommendation: 'Approve only if the delay is unacceptable.',
          payload: { trigger, connectionId: connections[0].id },
        });
        await this.bus.emit('FALLBACK_APPROVAL_REQUIRED', `Owner approval needed to use fallback for ${task?.code ?? req.label}`, { projectId: task?.projectId, taskId: task?.id });
      }
      throw new RuntimeBlockedError(`Kiro cannot continue (${trigger}). Waiting for Owner approval to use fallback AI.`, trigger);
    }
    let lastError = '';
    for (const conn of connections) {
      try { return await this.runFallback(req, conn.id, trigger); } catch (e) { lastError = String((e as Error).message); }
    }
    throw new RuntimeBlockedError(`Kiro unavailable (${trigger}) and all fallback providers failed: ${lastError.slice(0, 300)}`, trigger);
  }

  private async runFallback(req: ExecuteRequest, connectionId: string, trigger: string): Promise<ExecuteResult> {
    const { task, employee } = req;
    const { row: conn, apiKey } = await this.fallback.credentials(connectionId);
    const profile = buildAgentProfile(req.role.key);
    const filesMode = req.fallbackOutput === 'files';
    const prompt = `${req.prompt}\n\n---\nRUNTIME NOTE: You are running without tools (no file system, shell or web access). Base your work only on the context above and state any assumptions.${filesMode ? '\nDeliver code by including in your final ```json block a "files" array: [{"path": "relative/path", "content": "full file content"}]. Paths are relative to the project root. Include complete file contents.' : ''}`;
    const [run] = await this.db.insert(agentRuns).values({
      taskId: task?.id ?? null, projectId: task?.projectId ?? null, employeeId: employee.id, runtime: 'FALLBACK', provider: conn.name, model: conn.model,
      agentProfile: req.role.kiroAgent, prompt: redactString(prompt), status: 'RUNNING', fallbackReason: trigger, startedAt: new Date(),
    }).returning();
    await this.bus.emit('FALLBACK_ACTIVATED', `Fallback ${conn.name} (${conn.model}) used for ${task?.code ?? req.label} — reason: ${trigger}`, { projectId: task?.projectId, taskId: task?.id, employeeId: employee.id, data: { runId: run.id, provider: conn.name, model: conn.model, trigger } });
    await this.audit.log({ type: 'SYSTEM', name: 'FallbackRouter' }, 'fallback.activated', task?.code ?? req.label, { provider: conn.name, model: conn.model, trigger, employee: employee.name });
    const started = Date.now();
    try {
      const r = await complete({ provider: conn.provider, baseUrl: conn.baseUrl, apiKey, model: conn.model, system: profile.prompt, prompt, maxTokens: filesMode ? 16000 : 8192 });
      const cost = estimateCost(r.inputTokens, r.outputTokens, conn.costInputPerMTok, conn.costOutputPerMTok);
      const extracted = extractResult(r.text);
      let filesWritten: string[] | undefined;
      if (filesMode && extracted.data && Array.isArray((extracted.data as { files?: unknown }).files)) {
        filesWritten = this.writeFiles(req.root, (extracted.data as { files: { path: string; content: string }[] }).files);
      }
      await this.db.update(agentRuns).set({ status: 'SUCCEEDED', output: redactString(r.text).slice(-60_000), costUsd: cost.usd, costEstimated: cost.estimated, durationMs: Date.now() - started, finishedAt: new Date() }).where(eq(agentRuns.id, run.id));
      return { text: r.text, extracted, runtime: 'FALLBACK', runId: run.id, credits: 0, costUsd: cost.usd, provider: conn.name, filesWritten };
    } catch (e) {
      await this.db.update(agentRuns).set({ status: 'FAILED', errorClass: 'FALLBACK_PROVIDER', errorMessage: redactString(String((e as Error).message)).slice(0, 2000), durationMs: Date.now() - started, finishedAt: new Date() }).where(eq(agentRuns.id, run.id));
      throw e;
    }
  }

  /** Writes fallback-delivered files, enforcing the same workspace boundary as the Kiro policy. */
  private writeFiles(root: string, files: { path: string; content: string }[]): string[] {
    const written: string[] = [];
    for (const f of files.slice(0, 200)) {
      if (typeof f?.path !== 'string' || typeof f?.content !== 'string') continue;
      const target = path.resolve(root, f.path);
      const rel = path.relative(root, target);
      if (!isInside(root, target) || rel.toLowerCase().split(/[\\/]/).includes('.git') || /^\.env(\..+)?$/i.test(path.basename(target)) && path.basename(target) !== '.env.example') continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content);
      written.push(rel);
    }
    return written;
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
