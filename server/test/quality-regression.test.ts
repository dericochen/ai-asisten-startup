import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { dependencyAudit, startApp } from '../src/services/quality.js';
import { sandboxRun, sandboxStart } from '../src/lib/sandbox.js';

vi.mock('../src/lib/sandbox.js', () => ({ sandboxRun: vi.fn(), sandboxStart: vi.fn() }));
const dirs: string[] = [];
function project(lock = true, deps = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-quality-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: deps ? { example: '1.0.0' } : {} }));
  if (lock) fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  return dir;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const report = (high = 0) => ({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high } } });
function auditResult(body: unknown, code = 0, timedOut = false) {
  vi.mocked(sandboxRun).mockResolvedValue({ code, timedOut, stdout: JSON.stringify(body), stderr: '', durationMs: 1 });
}
describe('dependency audit fails closed', () => {
  it('accepts a complete clean report', async () => { auditResult(report()); expect((await dependencyAudit(project())).status).toBe('PASS'); });
  it('blocks high vulnerabilities', async () => { auditResult(report(2), 1); expect((await dependencyAudit(project())).status).toBe('FAIL'); });
  it.each([{ error: { code: 'ENOTFOUND' } }, {}, { metadata: { vulnerabilities: {} } }, { metadata: { vulnerabilities: { high: -1 } } }])('rejects an incomplete/error JSON response: %j', async (body) => {
    auditResult(body, 1); expect((await dependencyAudit(project())).status).toBe('ERROR');
  });
  it('rejects unexpected exit codes even with a valid report', async () => { auditResult(report(), 2); expect((await dependencyAudit(project())).status).toBe('ERROR'); });
  it('rejects timeouts', async () => { auditResult(report(), 0, true); expect((await dependencyAudit(project())).status).toBe('ERROR'); });
  it('blocks dependencies without a lockfile', async () => { expect((await dependencyAudit(project(false))).status).toBe('ERROR'); });
  it('skips only a valid project declaring no dependencies', async () => { expect((await dependencyAudit(project(false, false))).status).toBe('SKIP'); });
});

describe('startup health checks', () => {
  function mockApp(status: number) {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null });
    const stop = vi.fn(async () => {});
    vi.mocked(sandboxStart).mockResolvedValue({ child: child as any, stop });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status })));
    return stop;
  }
  it.each([401, 404, 500])('rejects HTTP %i and stops the container', async (status) => {
    const stop = mockApp(status);
    const result = expect(startApp(project(), 4999, '/api/health', {}, 20)).rejects.toThrow('did not become healthy');
    await vi.runAllTimersAsync(); await result; expect(stop).toHaveBeenCalledOnce();
  });
  it('accepts HTTP 200', async () => {
    const stop = mockApp(200); const app = await startApp(project(), 4999, '/api/health');
    expect(app.port).toBe(4999); expect(stop).not.toHaveBeenCalled(); await app.stop();
  });
});
