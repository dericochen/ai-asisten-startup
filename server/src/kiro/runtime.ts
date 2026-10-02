import { EventEmitter } from 'node:events';
import { AcpConnection, type SessionUpdate } from './acp.js';
import { KiroError, classifyKiroError, type KiroErrorClass } from './errors.js';
import { decidePermission, type PermissionContext, type PermissionDecision } from './policy.js';
import { run } from '../lib/proc.js';
import { processEnvironment } from '../lib/sandbox.js';

export type KiroHealth = 'UNKNOWN' | 'HEALTHY' | 'NEAR_LIMIT' | 'LIMITED' | 'UNAVAILABLE';

export interface KiroDetection {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  authMethod: string | null;
  checkedAt: string;
  error: string | null;
}

export interface KiroJob {
  runId: string;
  agentProfile: string;
  cwd: string;
  prompt: string;
  permission: PermissionContext;
  timeoutMs: number;
  /** Reuse a previous session (same employee + task revision loop) when its worker is still alive. */
  reuseKey?: string;
  label: string;
  onText?: (chunk: string, full: string) => void;
  onToolCall?: (e: { toolCallId: string; toolName: string; title: string; status: string; decision?: PermissionDecision; rawInput?: Record<string, unknown> }) => void;
  onStart?: (info: { workerId: number; sessionId: string }) => void;
}

export interface KiroResult { text: string; credits: number; toolCalls: number; durationMs: number; sessionId: string; workerId: number; stopReason: string }

interface Worker { id: number; conn: AcpConnection; busy: boolean; sessions: Map<string, string>; startedAt: number; jobs: number; currentLabel: string | null }

/**
 * Manages the pool of `kiro-cli acp` processes. Employees are profiles, not processes:
 * 100+ employees share a small pool (default 4) of Kiro workers, sessions are created per task and
 * released on completion; durable memory lives in the database.
 */
export class KiroRuntimeManager extends EventEmitter {
  private workers: Worker[] = [];
  private queue: { job: KiroJob; resolve: (r: KiroResult) => void; reject: (e: unknown) => void; enqueuedAt: number }[] = [];
  private nextWorkerId = 1;
  private draining = false;
  detection: KiroDetection = { installed: false, version: null, authenticated: false, authMethod: null, checkedAt: new Date(0).toISOString(), error: null };
  health: KiroHealth = 'UNKNOWN';
  healthReason = 'Not checked yet';
  limitedUntil: number | null = null;
  lastSuccessAt: string | null = null;
  lastErrorAt: string | null = null;
  lastError: string | null = null;
  private consecutiveFailures = 0;
  private recent: { ok: boolean; at: number }[] = [];
  creditsToday = 0;

  constructor(private readonly opts: {
    cliPath: string; kiroHome: string; runtimeCwd: string;
    settings: () => { poolSize: number; dailyCreditSoftLimit: number; nearLimitRatio: number; limitCooldownMs: number };
  }) { super(); }

  private env(): NodeJS.ProcessEnv {
    return { ...processEnvironment(), ...(process.env.KIRO_API_KEY ? { KIRO_API_KEY: process.env.KIRO_API_KEY } : {}), KIRO_HOME: this.opts.kiroHome, KIRO_LOG_NO_COLOR: '1', NO_COLOR: '1' };
  }

  /** Detect installation, version and authentication via the CLI itself. */
  async detect(): Promise<KiroDetection> {
    const checkedAt = new Date().toISOString();
    let ver = await run(this.opts.cliPath, ['--version'], { env: this.env(), timeoutMs: 30_000 });
    if (ver.code !== 0) { await new Promise((r) => setTimeout(r, 2000)); ver = await run(this.opts.cliPath, ['--version'], { env: this.env(), timeoutMs: 30_000 }); }
    if (ver.code !== 0) {
      const msg = (ver.stderr || ver.stdout || (ver.timedOut ? 'kiro-cli --version timed out' : `kiro-cli exited with ${ver.code}`)).trim().slice(0, 300);
      this.detection = { installed: false, version: null, authenticated: false, authMethod: null, checkedAt, error: msg };
      this.setHealth('UNAVAILABLE', 'Kiro CLI is not installed or not on PATH');
      return this.detection;
    }
    const version = ver.stdout.trim().split(/\s+/).pop() ?? ver.stdout.trim();
    const who = await run(this.opts.cliPath, ['whoami'], { env: this.env(), timeoutMs: 20_000 });
    const out = `${who.stdout}\n${who.stderr}`;
    const authenticated = who.code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out);
    const method = out.match(/logged in with ([^\n\r]+)/i)?.[1]?.trim() ?? (process.env.KIRO_API_KEY ? 'API key' : null);
    this.detection = { installed: true, version, authenticated, authMethod: authenticated ? method : null, checkedAt, error: authenticated ? null : 'Not logged in. Run `kiro-cli login`.' };
    if (!authenticated) this.setHealth('UNAVAILABLE', 'Kiro CLI is not authenticated');
    else if (this.health === 'UNKNOWN' || (this.health === 'UNAVAILABLE' && this.healthReason.startsWith('Kiro CLI is not'))) this.setHealth('HEALTHY', 'Kiro CLI detected and authenticated');
    return this.detection;
  }

  private setHealth(h: KiroHealth, reason: string): void {
    if (this.health === h && this.healthReason === reason) return;
    const prev = this.health;
    this.health = h;
    this.healthReason = reason;
    this.emit('health', { previous: prev, health: h, reason });
  }

  /** Whether new jobs may be dispatched to Kiro right now. */
  acceptingJobs(): { ok: boolean; reason: KiroErrorClass | null; message: string } {
    if (!this.detection.installed) return { ok: false, reason: 'NOT_INSTALLED', message: 'Kiro CLI not installed' };
    if (!this.detection.authenticated) return { ok: false, reason: 'AUTH', message: 'Kiro CLI not authenticated' };
    if (this.health === 'LIMITED') {
      if (this.limitedUntil && Date.now() >= this.limitedUntil) { this.setHealth('HEALTHY', 'Limit cooldown elapsed — retrying Kiro'); this.limitedUntil = null; }
      else return { ok: false, reason: 'USAGE_LIMIT', message: this.healthReason };
    }
    if (this.health === 'UNAVAILABLE') {
      if (this.limitedUntil && Date.now() >= this.limitedUntil) { this.setHealth('HEALTHY', 'Cooldown elapsed — retrying Kiro'); this.limitedUntil = null; }
      else return { ok: false, reason: 'UNAVAILABLE', message: this.healthReason };
    }
    return { ok: true, reason: null, message: 'ok' };
  }

  updateCredits(creditsToday: number): void {
    this.creditsToday = creditsToday;
    const s = this.opts.settings();
    if (s.dailyCreditSoftLimit > 0 && (this.health === 'HEALTHY' || this.health === 'NEAR_LIMIT')) {
      const ratio = creditsToday / s.dailyCreditSoftLimit;
      if (ratio >= 1) { this.limitedUntil = startOfTomorrow(); this.setHealth('LIMITED', `Daily Kiro credit budget reached (${creditsToday.toFixed(2)} / ${s.dailyCreditSoftLimit})`); }
      else if (ratio >= s.nearLimitRatio) this.setHealth('NEAR_LIMIT', `Kiro usage at ${(ratio * 100).toFixed(0)}% of the daily budget`);
      else if (this.health === 'NEAR_LIMIT') this.setHealth('HEALTHY', 'Usage within budget');
    }
  }

  /** Queue a job; resolves when the Kiro turn ends. Continuation turns (existing session) jump the queue. */
  execute(job: KiroJob): Promise<KiroResult> {
    return new Promise((resolve, reject) => {
      const item = { job, resolve, reject, enqueuedAt: Date.now() };
      if (job.reuseKey && this.workers.some((w) => w.sessions.has(job.reuseKey!))) this.queue.unshift(item);
      else this.queue.push(item);
      this.emit('queue', this.queue.length);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const worker = await this.acquireWorker(this.queue[0].job.reuseKey);
        if (!worker) break; // pool saturated; a finishing job re-triggers drain
        const item = this.queue.shift();
        if (!item) { worker.busy = false; break; }
        this.emit('queue', this.queue.length);
        void this.runOnWorker(worker, item.job).then(item.resolve, item.reject).finally(() => { void this.drain(); });
      }
    } finally { this.draining = false; }
  }

  private async acquireWorker(preferKey?: string): Promise<Worker | null> {
    this.workers = this.workers.filter((w) => !w.conn.exited);
    const free = (preferKey && this.workers.find((w) => !w.busy && w.sessions.has(preferKey)))
      || this.workers.find((w) => !w.busy && w.sessions.size === 0)
      || this.workers.find((w) => !w.busy);
    if (free) { free.busy = true; return free; }
    if (this.workers.length >= Math.max(1, this.opts.settings().poolSize)) return null;
    const conn = new AcpConnection({ cliPath: this.opts.cliPath, cwd: this.opts.runtimeCwd, env: this.env() });
    const worker: Worker = { id: this.nextWorkerId++, conn, busy: true, sessions: new Map(), startedAt: Date.now(), jobs: 0, currentLabel: null };
    this.workers.push(worker);
    try {
      await conn.start();
      this.emit('worker', { id: worker.id, event: 'started' });
      conn.on('exit', () => this.emit('worker', { id: worker.id, event: 'exited' }));
      return worker;
    } catch (e) {
      this.workers = this.workers.filter((w) => w !== worker);
      const item = this.queue.shift();
      item?.reject(e);
      this.recordFailure(e instanceof KiroError ? e.kind : 'PROCESS_ERROR', String((e as Error).message));
      return this.queue.length ? this.acquireWorker() : null;
    }
  }

  private async runOnWorker(worker: Worker, job: KiroJob): Promise<KiroResult> {
    const started = Date.now();
    worker.jobs++;
    worker.currentLabel = job.label;
    let text = '';
    let credits = 0;
    let toolCallCount = 0;
    const toolNames = new Map<string, string>();
    const handlers = {
      onUpdate: (u: SessionUpdate) => {
        if (u.sessionUpdate === 'agent_message_chunk' && u.content && !Array.isArray(u.content) && typeof u.content.text === 'string') {
          text += u.content.text;
          job.onText?.(u.content.text, text);
        } else if (u.sessionUpdate === 'tool_call' && u.toolCallId) {
          toolCallCount++;
          const name = toolNames.get(u.toolCallId) ?? u.kind ?? 'tool';
          job.onToolCall?.({ toolCallId: u.toolCallId, toolName: name, title: u.title ?? name, status: u.status ?? 'pending', rawInput: u.rawInput });
        } else if (u.sessionUpdate === 'tool_call_update' && u.toolCallId && (u.status === 'completed' || u.status === 'failed')) {
          const name = u._meta?.kiro?.toolName ?? toolNames.get(u.toolCallId) ?? u.kind ?? 'tool';
          job.onToolCall?.({ toolCallId: u.toolCallId, toolName: name, title: u.title ?? name, status: u.status });
        }
      },
      onToolChunk: (id: string, name: string) => { toolNames.set(id, name); },
      onMetadata: (m: { meteringUsage?: { value: number; unit: string }[] }) => {
        if (m.meteringUsage) credits = m.meteringUsage.filter((x) => x.unit === 'credit').reduce((a, x) => a + x.value, 0);
      },
      onPermission: async (req: { toolCall: { toolCallId: string; title?: string; rawInput?: Record<string, unknown> } }) => {
        const name = toolNames.get(req.toolCall.toolCallId);
        const decision = decidePermission(name, req.toolCall.rawInput, job.permission);
        job.onToolCall?.({ toolCallId: req.toolCall.toolCallId, toolName: decision.tool, title: req.toolCall.title ?? decision.tool, status: decision.allow ? 'allowed' : 'denied', decision, rawInput: req.toolCall.rawInput });
        return decision.allow ? 'allow' as const : 'reject' as const;
      },
    };

    let sessionId = job.reuseKey ? worker.sessions.get(job.reuseKey) : undefined;
    try {
      if (sessionId) worker.conn.setHandlers(sessionId, handlers);
      else {
        const s = await worker.conn.newSession(job.cwd, handlers);
        sessionId = s.sessionId;
        if (!s.modes.includes(job.agentProfile)) throw new KiroError('AGENT_PROFILE', `Kiro agent profile ${job.agentProfile} is not installed in KIRO_HOME`);
        await worker.conn.setMode(sessionId, job.agentProfile);
        if (job.reuseKey) worker.sessions.set(job.reuseKey, sessionId);
      }
      job.onStart?.({ workerId: worker.id, sessionId });
      this.emit('run', { workerId: worker.id, label: job.label, event: 'started' });

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          worker.conn.cancel(sessionId!);
          setTimeout(() => worker.conn.stop(), 10_000).unref();
          reject(new KiroError('TIMEOUT', `Kiro turn exceeded ${Math.round(job.timeoutMs / 1000)}s`));
        }, job.timeoutMs);
      });
      const res = await Promise.race([worker.conn.prompt(sessionId, job.prompt), timeout]).finally(() => clearTimeout(timer));
      if (res.stopReason === 'refusal') throw new KiroError('REFUSED', 'The agent refused the task');
      if (res.stopReason === 'cancelled') throw new KiroError('CANCELLED', 'The Kiro turn was cancelled');
      if (!text.trim()) throw new KiroError('UNKNOWN', 'Kiro returned an empty response');
      this.recordSuccess();
      return { text, credits, toolCalls: toolCallCount, durationMs: Date.now() - started, sessionId, workerId: worker.id, stopReason: res.stopReason };
    } catch (e) {
      const err = e instanceof KiroError ? e : new KiroError(classifyKiroError(String((e as Error)?.message ?? e)), String((e as Error)?.message ?? e));
      // Stderr often carries the real cause (throttling, quota) when a turn fails.
      const kind = err.kind === 'UNKNOWN' || err.kind === 'PROCESS_ERROR' ? (classifyKiroError(worker.conn.stderr) !== 'UNKNOWN' ? classifyKiroError(worker.conn.stderr) : err.kind) : err.kind;
      if (job.reuseKey) worker.sessions.delete(job.reuseKey);
      if (sessionId) worker.conn.dropSession(sessionId);
      this.recordFailure(kind, err.message);
      throw new KiroError(kind, err.message, { credits, partialText: text.slice(-2000), sessionId, workerId: worker.id });
    } finally {
      if (!job.reuseKey && sessionId) worker.conn.dropSession(sessionId);
      worker.busy = false;
      worker.currentLabel = null;
      this.emit('run', { workerId: worker.id, label: job.label, event: 'finished' });
      // Recycle long-lived workers to bound memory.
      if (worker.jobs >= 25 && !worker.conn.exited) worker.conn.stop();
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = new Date().toISOString();
    this.pushRecent(true);
    if (this.health !== 'HEALTHY' && this.health !== 'NEAR_LIMIT') this.setHealth('HEALTHY', 'Kiro runs succeeding');
  }

  private recordFailure(kind: KiroErrorClass, message: string): void {
    this.lastErrorAt = new Date().toISOString();
    this.lastError = `${kind}: ${message}`.slice(0, 500);
    this.pushRecent(false);
    const cooldown = this.opts.settings().limitCooldownMs;
    if (kind === 'USAGE_LIMIT' || kind === 'RATE_LIMITED') {
      this.limitedUntil = Date.now() + (kind === 'RATE_LIMITED' ? Math.min(cooldown, 2 * 60_000) : cooldown);
      this.setHealth('LIMITED', kind === 'USAGE_LIMIT' ? 'Kiro usage limit reached' : 'Kiro is rate limiting requests');
      return;
    }
    if (kind === 'AUTH' || kind === 'NOT_INSTALLED') { this.detection.authenticated = kind === 'AUTH' ? false : this.detection.authenticated; this.setHealth('UNAVAILABLE', message.slice(0, 200)); return; }
    if (kind === 'UNAVAILABLE' || kind === 'PROCESS_ERROR' || kind === 'TIMEOUT') {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) { this.limitedUntil = Date.now() + 60_000; this.setHealth('UNAVAILABLE', `Kiro failing repeatedly (${this.consecutiveFailures}x): ${message.slice(0, 160)}`); }
    }
  }

  private pushRecent(ok: boolean): void {
    this.recent.push({ ok, at: Date.now() });
    if (this.recent.length > 100) this.recent.shift();
  }

  status() {
    const s = this.opts.settings();
    const failures = this.recent.filter((r) => !r.ok).length;
    return {
      detection: this.detection,
      health: this.health,
      healthReason: this.healthReason,
      limitedUntil: this.limitedUntil ? new Date(this.limitedUntil).toISOString() : null,
      poolSize: s.poolSize,
      workers: this.workers.filter((w) => !w.conn.exited).map((w) => ({ id: w.id, busy: w.busy, label: w.currentLabel, jobs: w.jobs, sessions: w.conn.sessionCount, uptimeSec: Math.round((Date.now() - w.startedAt) / 1000) })),
      activeSessions: this.workers.reduce((a, w) => a + (w.conn.exited ? 0 : w.conn.sessionCount), 0),
      runningJobs: this.workers.filter((w) => w.busy && !w.conn.exited).length,
      queuedJobs: this.queue.length,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      failureRate: this.recent.length ? failures / this.recent.length : 0,
      recentRuns: this.recent.length,
      creditsToday: this.creditsToday,
      dailyCreditSoftLimit: s.dailyCreditSoftLimit,
    };
  }

  /** Release a reusable session (after a task and its repair turns finish). */
  forget(reuseKey: string): void {
    for (const w of this.workers) {
      const sid = w.sessions.get(reuseKey);
      if (sid) { w.sessions.delete(reuseKey); w.conn.dropSession(sid); }
    }
  }

  /** Stop all workers (shutdown or Owner request). Queued jobs are rejected and later re-queued from the DB. */
  shutdown(): void {
    for (const item of this.queue.splice(0)) item.reject(new KiroError('CANCELLED', 'Runtime shutting down'));
    for (const w of this.workers) w.conn.stop();
    this.workers = [];
  }
}

function startOfTomorrow(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}
