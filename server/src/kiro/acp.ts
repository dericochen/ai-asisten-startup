import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { KiroError, classifyKiroError } from './errors.js';
import { killTree } from '../lib/proc.js';

/** Session update payloads observed from kiro-cli 2.x (see docs/KIRO_RUNTIME.md). */
export interface SessionUpdate {
  sessionUpdate: string;
  content?: { type: string; text?: string } | unknown[];
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  locations?: { path: string }[];
  _meta?: { kiro?: { toolName?: string; toolCallFailureReason?: string } };
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: { toolCallId: string; title?: string; rawInput?: Record<string, unknown> };
  options: { optionId: string; name?: string; kind: string }[];
}

export interface SessionHandlers {
  onUpdate?: (u: SessionUpdate) => void;
  onMetadata?: (m: { meteringUsage?: { value: number; unit: string }[]; turnDurationMs?: number; contextUsagePercentage?: number }) => void;
  onToolChunk?: (toolCallId: string, toolName: string) => void;
  onPermission?: (req: PermissionRequest) => Promise<'allow' | 'reject'>;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: string }

/**
 * One `kiro-cli acp` child process speaking JSON-RPC 2.0 over stdio.
 * Multiple sessions can live in one process; the pool runs one prompt per process at a time.
 */
export class AcpConnection extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private sessions = new Map<string, SessionHandlers>();
  private stderrTail = '';
  public initialized = false;
  public agentVersion = '';
  public exited = false;

  constructor(private readonly opts: { cliPath: string; cwd: string; env: NodeJS.ProcessEnv; extraArgs?: string[] }) { super(); }

  async start(): Promise<void> {
    const child = spawn(this.opts.cliPath, ['acp', ...(this.opts.extraArgs ?? [])], {
      cwd: this.opts.cwd, env: this.opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child = child;
    const spawnError = new Promise<never>((_, reject) => child.once('error', (e: NodeJS.ErrnoException) => {
      reject(new KiroError(e.code === 'ENOENT' ? 'NOT_INSTALLED' : 'PROCESS_ERROR', `Failed to start kiro-cli: ${e.message}`));
    }));
    child.stderr!.on('data', (d) => { this.stderrTail = (this.stderrTail + d.toString()).slice(-4000); });
    child.on('exit', (code, signal) => {
      this.exited = true;
      const tail = this.stderrTail.trim();
      const kind = tail ? classifyKiroError(tail) : 'PROCESS_ERROR';
      const err = new KiroError(kind === 'UNKNOWN' ? 'PROCESS_ERROR' : kind, `kiro-cli acp exited (code ${code}, signal ${signal})${tail ? `: ${tail.slice(-500)}` : ''}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.emit('exit', err);
    });
    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(line));
    const init = await Promise.race([
      this.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }),
      spawnError,
    ]) as { protocolVersion: number; agentInfo?: { version?: string } };
    this.agentVersion = init?.agentInfo?.version ?? '';
    this.initialized = true;
  }

  get stderr(): string { return this.stderrTail; }

  private write(msg: unknown): void {
    if (!this.child || this.exited) throw new KiroError('PROCESS_ERROR', 'kiro-cli process is not running');
    this.child.stdin!.write(JSON.stringify(msg) + '\n');
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      try { this.write({ jsonrpc: '2.0', id, method, params }); } catch (e) { this.pending.delete(id); reject(e); }
    });
  }

  notify(method: string, params: unknown): void {
    try { this.write({ jsonrpc: '2.0', method, params }); } catch { /* process gone */ }
  }

  private onLine(line: string): void {
    let msg: { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    try { msg = JSON.parse(line); } catch { return; }
    // Response to one of our requests
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const text = `${msg.error.message} ${JSON.stringify(msg.error.data ?? '')}`;
        p.reject(new KiroError(classifyKiroError(text), `ACP ${p.method} failed: ${msg.error.message}`, msg.error));
      } else p.resolve(msg.result);
      return;
    }
    const params = msg.params ?? {};
    const sessionId = params.sessionId as string | undefined;
    const handlers = sessionId ? this.sessions.get(sessionId) : undefined;
    // Agent → client request
    if (msg.id !== undefined && msg.method) {
      if (msg.method === 'session/request_permission') {
        const req = params as unknown as PermissionRequest;
        const decide = handlers?.onPermission ?? (async () => 'reject' as const);
        decide(req).then((d) => {
          const want = d === 'allow' ? 'allow_once' : 'reject_once';
          const opt = req.options.find((o) => o.kind === want) ?? req.options.find((o) => o.kind.startsWith(d === 'allow' ? 'allow' : 'reject'));
          this.write({ jsonrpc: '2.0', id: msg.id, result: { outcome: opt ? { outcome: 'selected', optionId: opt.optionId } : { outcome: 'cancelled' } } });
        }).catch(() => this.write({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } }));
      } else {
        // We advertise no fs/terminal capabilities; reject anything else politely.
        this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not supported by client: ${msg.method}` } });
      }
      return;
    }
    // Notifications
    if (!handlers) return;
    if (msg.method === 'session/update') handlers.onUpdate?.(params.update as SessionUpdate);
    else if (msg.method === '_kiro.dev/metadata') handlers.onMetadata?.(params as never);
    else if (msg.method === '_kiro.dev/session/update') {
      const u = params.update as SessionUpdate | undefined;
      if (u?.sessionUpdate === 'tool_call_chunk' && u.toolCallId && u.title) handlers.onToolChunk?.(u.toolCallId, u.title);
    }
  }

  async newSession(cwd: string, handlers: SessionHandlers): Promise<{ sessionId: string; modes: string[] }> {
    const res = await this.request<{ sessionId: string; modes?: { availableModes?: { id: string }[] } }>('session/new', { cwd, mcpServers: [] });
    this.sessions.set(res.sessionId, handlers);
    return { sessionId: res.sessionId, modes: (res.modes?.availableModes ?? []).map((m) => m.id) };
  }

  setHandlers(sessionId: string, handlers: SessionHandlers): void { this.sessions.set(sessionId, handlers); }
  async setMode(sessionId: string, modeId: string): Promise<void> { await this.request('session/set_mode', { sessionId, modeId }); }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    return this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
  }

  cancel(sessionId: string): void { this.notify('session/cancel', { sessionId }); }
  dropSession(sessionId: string): void { this.sessions.delete(sessionId); }
  get sessionCount(): number { return this.sessions.size; }

  stop(): void {
    if (this.child && !this.exited) killTree(this.child);
  }
}
