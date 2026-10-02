import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { DB } from '../db/client.js';
import { checkRuns, type CheckStatus } from '../db/schema.js';
import type { EventBus } from '../core/events.js';
import { run, tail } from '../lib/proc.js';
import { sandboxRun, sandboxStart } from '../lib/sandbox.js';
import { redactString } from '../lib/redact.js';
import { isInside } from '../kiro/policy.js';

export interface ApiCheck { method: string; path: string; body?: unknown; expectStatus: number; name?: string }
export interface RuntimeContract { healthPath: string; routes: string[]; apiChecks: ApiCheck[] }
export interface CheckResult { name: string; status: CheckStatus; details: string; durationMs: number }

const SAFE_SCRIPT = /^[A-Za-z0-9:_-]+$/;

export function readPackageJson(dir: string): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  if (!isInside(dir, path.join(dir, 'package.json'))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; }
}

/** Install dependencies + run a named npm script, with output captured for evidence. */
export async function npmInstall(dir: string): Promise<CheckResult> {
  const pkg = readPackageJson(dir);
  if (!pkg) return { name: 'install', status: 'FAIL', details: 'No package.json at repository root (runtime contract requires a Node.js project).', durationMs: 0 };
  const hasDeps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length > 0;
  if (!hasDeps) return { name: 'install', status: 'SKIP', details: 'No dependencies declared.', durationMs: 0 };
  const args = fs.existsSync(path.join(dir, 'package-lock.json')) ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'];
  const r = await sandboxRun({ dir, args: [...args, '--ignore-scripts', '--include=dev', '--userconfig=/dev/null', '--registry=https://registry.npmjs.org'], network: 'registry' }, 15 * 60_000);
  return { name: 'install', status: r.code === 0 ? 'PASS' : 'FAIL', details: `npm ${args.join(' ')} → exit ${r.code}${r.timedOut ? ' (timeout)' : ''}\n${tail(r.stdout + r.stderr, 3000)}`, durationMs: r.durationMs };
}

export async function npmScript(dir: string, script: string, required: boolean, timeoutMs = 10 * 60_000): Promise<CheckResult> {
  if (!SAFE_SCRIPT.test(script)) return { name: script, status: 'ERROR', details: 'Invalid script name', durationMs: 0 };
  const pkg = readPackageJson(dir);
  if (!pkg?.scripts?.[script]) return { name: script, status: required ? 'FAIL' : 'SKIP', details: required ? `Required npm script "${script}" is missing.` : `No "${script}" script.`, durationMs: 0 };
  const r = await sandboxRun({ dir, args: ['run', script], env: { NODE_ENV: script === 'build' ? 'production' : 'test' } }, timeoutMs);
  return { name: script, status: r.code === 0 ? 'PASS' : 'FAIL', details: `npm run ${script} → exit ${r.code}${r.timedOut ? ' (timeout)' : ''}\n${tail(r.stdout + r.stderr, 4000)}`, durationMs: r.durationMs };
}

export interface RunningApp { child: ChildProcess; port: number; baseUrl: string; logs: () => string; stop: () => Promise<void> }

/** Starts `npm start` with PORT set and waits until the health endpoint answers. */
export async function startApp(dir: string, port: number, healthPath: string, env: Record<string, string> = {}, timeoutMs = 90_000): Promise<RunningApp> {
  let logs = '';
  const { DATA_DIR, ...runtimeEnv } = env;
  const { child, stop } = await sandboxStart({ dir, args: ['run', 'start'], port, network: 'application', dataDir: DATA_DIR, env: { ...runtimeEnv, PORT: String(port), HOST: '0.0.0.0' } });
  let spawnError: Error | undefined;
  child.once('error', (e) => { spawnError = e; });
  child.stdout?.on('data', (d) => { logs = (logs + d.toString()).slice(-20_000); });
  child.stderr?.on('data', (d) => { logs = (logs + d.toString()).slice(-20_000); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) { await stop(); throw new Error(`App exited during startup (code ${child.exitCode}).\n${tail(logs, 3000)}`); }
    try {
      const res = await fetch(baseUrl + healthPath, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return { child, port, baseUrl, logs: () => logs, stop };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stop();
  throw new Error(`App did not become healthy at ${baseUrl}${healthPath} within ${timeoutMs / 1000}s.\n${tail(logs, 3000)}`);
}

async function timed(name: string, fn: () => Promise<{ status: CheckStatus; details: string }>): Promise<CheckResult> {
  const t = Date.now();
  try { const r = await fn(); return { name, ...r, durationMs: Date.now() - t }; }
  catch (e) { return { name, status: 'FAIL', details: String((e as Error).message).slice(0, 2000), durationMs: Date.now() - t }; }
}

/** HTTP smoke checks used by QA, staging and production validation. */
export async function httpSmoke(baseUrl: string, contract: RuntimeContract): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  results.push(await timed(`GET ${contract.healthPath} (health)`, async () => {
    const res = await fetch(baseUrl + contract.healthPath, { signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    return { status: res.status === 200 ? 'PASS' : 'FAIL', details: `HTTP ${res.status} ${body.slice(0, 200)}` };
  }));
  let html = '';
  results.push(await timed('GET / renders HTML', async () => {
    const res = await fetch(baseUrl + '/', { signal: AbortSignal.timeout(10_000) });
    html = await res.text();
    const isHtml = (res.headers.get('content-type') ?? '').includes('text/html') && /<html|<!doctype html/i.test(html);
    return { status: res.status === 200 && isHtml ? 'PASS' : 'FAIL', details: `HTTP ${res.status}, content-type ${res.headers.get('content-type')}, ${html.length} bytes${/<title>([^<]*)<\/title>/i.test(html) ? `, title "${html.match(/<title>([^<]*)<\/title>/i)![1]}"` : ''}` };
  }));
  const assets = Array.from(new Set([...html.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"'#?]+)[^"']*["']/gi)].map((m) => m[1]).filter((u) => u.startsWith('/') && !u.startsWith('//')))).slice(0, 30);
  results.push(await timed(`Assets load (${assets.length})`, async () => {
    if (!assets.length) return { status: 'SKIP', details: 'No local script/stylesheet references found in homepage HTML.' };
    const bad: string[] = [];
    for (const a of assets) { const r = await fetch(baseUrl + a, { signal: AbortSignal.timeout(10_000) }); if (r.status >= 400) bad.push(`${a} → ${r.status}`); }
    return { status: bad.length ? 'FAIL' : 'PASS', details: bad.length ? `Broken: ${bad.join(', ')}` : assets.join(', ') };
  }));
  for (const route of contract.routes.filter((r) => r !== '/').slice(0, 15)) {
    results.push(await timed(`GET ${route}`, async () => {
      const res = await fetch(baseUrl + route, { signal: AbortSignal.timeout(10_000) });
      return { status: res.status < 400 ? 'PASS' : 'FAIL', details: `HTTP ${res.status}` };
    }));
  }
  for (const c of contract.apiChecks.slice(0, 25)) {
    results.push(await timed(c.name ?? `${c.method} ${c.path} → ${c.expectStatus}`, async () => {
      const method = c.method.toUpperCase();
      const res = await fetch(baseUrl + c.path, { method, headers: c.body !== undefined ? { 'content-type': 'application/json' } : {}, body: c.body !== undefined && method !== 'GET' ? JSON.stringify(c.body) : undefined, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      return { status: res.status === c.expectStatus ? 'PASS' : 'FAIL', details: `HTTP ${res.status} (expected ${c.expectStatus}) ${text.slice(0, 200)}` };
    }));
  }
  return results;
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ['OpenAI/OpenRouter/Anthropic key', /sk-(?:or-|ant-|proj-)?[A-Za-z0-9_\-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_\-]{35}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Hardcoded credential', /(password|secret|api[_-]?key)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];

export async function secretScan(dir: string): Promise<CheckResult> {
  const t = Date.now();
  const ls = await run('git', ['ls-files'], { cwd: dir, timeoutMs: 30_000 });
  if (ls.code !== 0) return { name: 'Secret scan', status: 'ERROR', details: 'Git file enumeration failed; secret scan is incomplete.', durationMs: Date.now() - t };
  const files = ls.stdout.split(/\r?\n/).filter(Boolean).filter((f) => !/package-lock\.json$|\.(png|jpg|jpeg|gif|ico|woff2?|ttf|lock)$/i.test(f));
  const findings: string[] = [];
  const committedEnv = files.filter((f) => /(^|\/)\.env(\.[^/]+)?$/.test(f) && !f.endsWith('.env.example'));
  for (const f of committedEnv) findings.push(`${f}: environment file committed to git`);
  for (const f of files.slice(0, 2000)) {
    if (!isInside(dir, path.join(dir, f))) { findings.push(`${f}: unsafe symlink or path`); continue; }
    let content = '';
    try { const st = fs.statSync(path.join(dir, f)); if (st.size > 1_000_000) continue; content = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const [label, re] of SECRET_PATTERNS) {
      const m = content.match(re);
      if (m && !/example|placeholder|changeme|your[-_]|xxxx|dummy|test[-_]?secret/i.test(m[0])) findings.push(`${f}: possible ${label}`);
    }
  }
  return { name: 'Secret scan', status: findings.length ? 'FAIL' : 'PASS', details: findings.length ? findings.slice(0, 30).join('\n') : `${files.length} tracked files scanned; no secrets found.`, durationMs: Date.now() - t };
}

export async function dependencyAudit(dir: string): Promise<CheckResult> {
  const t = Date.now();
  if (!fs.existsSync(path.join(dir, 'package-lock.json'))) {
    const pkg = readPackageJson(dir);
    const noDeps = pkg && Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length === 0;
    return { name: 'Dependency audit', status: noDeps ? 'SKIP' : 'ERROR', details: noDeps ? 'No dependencies declared.' : 'Missing package-lock.json; dependency audit cannot be verified.', durationMs: 0 };
  }
  const r = await sandboxRun({ dir, args: ['audit', '--json', '--omit=dev', '--ignore-scripts', '--userconfig=/dev/null', '--registry=https://registry.npmjs.org'], network: 'registry' }, 120_000);
  try {
    const j = JSON.parse(r.stdout) as { metadata?: { vulnerabilities?: Record<string, number> } };
    const v = j.metadata?.vulnerabilities;
    if (r.timedOut || ![0, 1].includes(r.code ?? -1) || !v || !['info', 'low', 'moderate', 'high', 'critical', 'total'].every((k) => Number.isInteger(v[k]) && v[k] >= 0)) {
      return { name: 'Dependency audit', status: 'ERROR', details: 'npm audit did not return a complete vulnerability report; release blocked.', durationMs: Date.now() - t };
    }
    const high = (v.high ?? 0) + (v.critical ?? 0);
    return { name: 'Dependency audit', status: high ? 'FAIL' : 'PASS', details: `npm audit (production deps): ${JSON.stringify(v)}`, durationMs: Date.now() - t };
  } catch {
    return { name: 'Dependency audit', status: 'ERROR', details: `npm audit could not complete (registry unreachable?): ${tail(r.stderr || r.stdout, 500)}`, durationMs: Date.now() - t };
  }
}

export async function securityHeaders(baseUrl: string): Promise<CheckResult> {
  return timed('Security headers', async () => {
    const res = await fetch(baseUrl + '/', { signal: AbortSignal.timeout(10_000) });
    const h = res.headers;
    const missing: string[] = [];
    if (!/nosniff/i.test(h.get('x-content-type-options') ?? '')) missing.push('X-Content-Type-Options: nosniff');
    if (!h.get('x-frame-options') && !/frame-ancestors/i.test(h.get('content-security-policy') ?? '')) missing.push('X-Frame-Options or CSP frame-ancestors');
    if (!h.get('referrer-policy')) missing.push('Referrer-Policy');
    const powered = h.get('x-powered-by');
    return { status: missing.length ? 'FAIL' : 'PASS', details: missing.length ? `Missing: ${missing.join(', ')}` : `Present: nosniff, framing protection, Referrer-Policy${powered ? ` (note: X-Powered-By ${powered} exposed)` : ''}` };
  });
}

export async function performance(baseUrl: string, contract: RuntimeContract, samples = 20): Promise<CheckResult> {
  return timed('Response time p95', async () => {
    const urls = [contract.healthPath, '/', ...contract.routes.filter((r) => r !== '/').slice(0, 3)];
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      for (const u of urls) { const t = performance_now(); const r = await fetch(baseUrl + u, { signal: AbortSignal.timeout(10_000) }); await r.arrayBuffer(); times.push(performance_now() - t); }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
    return { status: p95 < 1000 ? 'PASS' : 'FAIL', details: `${times.length} requests; p50 ${p50.toFixed(0)}ms, p95 ${p95.toFixed(0)}ms (threshold 1000ms)` };
  });
}
const performance_now = () => Number(process.hrtime.bigint() / 1_000_000n);

export class CheckRecorder {
  constructor(private db: DB, private bus: EventBus) {}
  async record(projectId: string, suite: string, results: CheckResult[], ref: { taskId?: string | null; releaseId?: string | null } = {}): Promise<{ status: CheckStatus; failed: CheckResult[] }> {
    for (const r of results) {
      await this.db.insert(checkRuns).values({ projectId, suite, name: r.name, status: r.status, details: redactString(r.details).slice(0, 8000), durationMs: r.durationMs, taskId: ref.taskId ?? null, releaseId: ref.releaseId ?? null });
    }
    const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
    const status: CheckStatus = failed.length ? 'FAIL' : 'PASS';
    const summary = `${results.filter((r) => r.status === 'PASS').length} passed, ${failed.length} failed, ${results.filter((r) => r.status === 'SKIP').length} skipped`;
    await this.db.insert(checkRuns).values({ projectId, suite, name: 'summary', status, details: summary, taskId: ref.taskId ?? null, releaseId: ref.releaseId ?? null });
    await this.bus.emit(status === 'PASS' ? 'CHECK_COMPLETED' : (suite === 'QA' ? 'TEST_FAILED' : 'CHECK_COMPLETED'), `${suite} checks ${status}: ${summary}`, { projectId, taskId: ref.taskId, data: { suite, status } });
    return { status, failed };
  }
}
