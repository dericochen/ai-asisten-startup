import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data dir must be set before config is imported.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-test-'));
process.env.ACO_DATA_DIR = dataDir;
process.env.ACO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

type Mods = {
  client: typeof import('../src/db/client.js'); container: typeof import('../src/core/container.js'); schema: typeof import('../src/db/schema.js');
  def: typeof import('../src/org/definition.js'); runtime: typeof import('../src/kiro/runtime.js'); guard: typeof import('../src/workflow/guard.js');
  approvals: typeof import('../src/services/approvals.js'); executor: typeof import('../src/services/executor.js'); config: typeof import('../src/config.js');
};
let m: Mods;
let s: Awaited<ReturnType<Mods['container']['buildServices']>>;
let close: () => Promise<void>;

beforeAll(async () => {
  m = {
    client: await import('../src/db/client.js'), container: await import('../src/core/container.js'), schema: await import('../src/db/schema.js'),
    def: await import('../src/org/definition.js'), runtime: await import('../src/kiro/runtime.js'), guard: await import('../src/workflow/guard.js'),
    approvals: await import('../src/services/approvals.js'), executor: await import('../src/services/executor.js'), config: await import('../src/config.js'),
  };
  m.config.ensureDirs();
  const h = await m.client.openDatabase({ memory: true });
  close = h.close;
  // A Kiro runtime that is not installed — lets us test fallback policy without spawning processes.
  const kiro = new m.runtime.KiroRuntimeManager({ cliPath: 'kiro-cli-not-installed-for-tests', kiroHome: m.config.config.kiroHome, runtimeCwd: m.config.config.kiroRuntimeCwd, settings: () => m.def.DEFAULT_POLICIES.kiro });
  await h.db.insert(m.schema.company).values({ name: 'Test Co', policies: m.def.DEFAULT_POLICIES });
  s = await m.container.buildServices(h.db, { kiro });
  await s.org.install();
});

afterAll(async () => { await close?.(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe('organization', () => {
  it('installs departments, roles with authority levels and 100+ employees', async () => {
    const roles = await s.org.roles();
    expect(roles.find((r) => r.key === 'ceo')?.authority).toBe(90);
    expect(roles.find((r) => r.key === 'cto')?.authority).toBe(80);
    expect(roles.find((r) => r.key === 'temp-contractor')?.authority).toBe(10);
    expect((await s.org.employees()).length).toBeGreaterThan(100);
  });
});

describe('machine-enforced workflow gates', () => {
  it('locks engineering until research, product, design and architecture are approved', async () => {
    const p = await s.projects.create({ name: 'Gate Test', objective: 'Test gates' });
    const lock = await s.guard.engineeringLock(p.id);
    expect(lock.locked).toBe(true);
    await expect(s.tasks.create({ projectId: p.id, phase: 'DEVELOPMENT', stage: 'engineering.backend', roleKey: 'backend-engineer', title: 'Sneak in code' })).rejects.toBeInstanceOf(m.guard.GateLockedError);
    await expect(s.projects.enterPhase(p.id, 'DESIGN', 'skip ahead')).rejects.toBeInstanceOf(m.guard.GateLockedError);
    await expect(s.projects.enterPhase(p.id, 'PRODUCTION_DEPLOYMENT', 'skip ahead')).rejects.toBeInstanceOf(m.guard.GateLockedError);
  });

  it('DESIGN_COMPLETE without CEO design approval keeps engineering locked; approvals unlock it', async () => {
    const p = await s.projects.create({ name: 'Unlock Test', objective: 'Test unlock' });
    const ceo = (await s.org.firstOfRole('ceo'))!;
    const cto = (await s.org.firstOfRole('cto'))!;
    const pm = (await s.org.pick('product-manager'))!;
    for (const gate of ['RESEARCH', 'PRODUCT', 'DESIGN'] as const) {
      const a = await s.approvals.request({ projectId: p.id, gate, title: gate, requestedById: pm.id });
      await s.approvals.decide(a.id, { type: 'AGENT', employeeId: ceo.id, name: ceo.name }, 'APPROVED', 'ok');
    }
    expect((await s.guard.engineeringLock(p.id)).locked).toBe(true); // architecture still missing
    const arch = await s.approvals.request({ projectId: p.id, gate: 'ARCHITECTURE', title: 'arch', requestedById: pm.id });
    await s.approvals.decide(arch.id, { type: 'AGENT', employeeId: cto.id, name: cto.name }, 'APPROVED', 'ok');
    expect((await s.guard.engineeringLock(p.id)).locked).toBe(false);
    const t = await s.tasks.create({ projectId: p.id, phase: 'DEVELOPMENT', stage: 'engineering.backend', roleKey: 'backend-engineer', title: 'Now allowed' });
    expect(t.status).toBe('READY');
  });
});

describe('authority and independence', () => {
  it('rejects decisions from agents below the required authority or without the role', async () => {
    const p = await s.projects.create({ name: 'Authority Test', objective: 'Test authority' });
    const a = await s.approvals.request({ projectId: p.id, gate: 'DESIGN', title: 'design' });
    const designer = (await s.org.pick('ux-designer'))!;
    await expect(s.approvals.decide(a.id, { type: 'AGENT', employeeId: designer.id, name: designer.name }, 'APPROVED', 'self-approve')).rejects.toBeInstanceOf(m.approvals.AuthorityError);
    const cto = (await s.org.firstOfRole('cto'))!; // authority 80 < 90 and not the CEO role
    await expect(s.approvals.decide(a.id, { type: 'AGENT', employeeId: cto.id, name: cto.name }, 'APPROVED', 'not my gate')).rejects.toBeInstanceOf(m.approvals.AuthorityError);
    expect((await s.approvals.get(a.id))?.status).toBe('PENDING');
  });

  it('the requester can never approve their own request', async () => {
    const ceo = (await s.org.firstOfRole('ceo'))!;
    const p = await s.projects.create({ name: 'Independence Test', objective: 'Test independence' });
    const a = await s.approvals.request({ projectId: p.id, gate: 'RESEARCH', title: 'research', requestedById: ceo.id });
    await expect(s.approvals.decide(a.id, { type: 'AGENT', employeeId: ceo.id, name: ceo.name }, 'APPROVED', 'mine')).rejects.toThrow(/requester/);
  });

  it('Owner-only gates cannot be decided by agents, only by the Owner', async () => {
    const ceo = (await s.org.firstOfRole('ceo'))!;
    const p = await s.projects.create({ name: 'Owner Gate', objective: 'Owner gate' });
    const a = await s.approvals.request({ projectId: p.id, gate: 'PRODUCTION_DEPLOY', title: 'deploy' });
    await expect(s.approvals.decide(a.id, { type: 'AGENT', employeeId: ceo.id, name: ceo.name }, 'APPROVED', 'ship it')).rejects.toThrow(/Owner/);
    const ok = await s.approvals.decide(a.id, { type: 'OWNER', id: 'owner-1', name: 'Owner' }, 'APPROVED', 'go');
    expect(ok.status).toBe('APPROVED');
    expect(ok.decidedByAuthority).toBe(100);
    await expect(s.approvals.decide(a.id, { type: 'OWNER', id: 'owner-1', name: 'Owner' }, 'REJECTED', 'again')).rejects.toThrow(/already/);
  });

  it('owner-gate policy: a reassigned gate can no longer be decided by the CEO', async () => {
    const ceo = (await s.org.firstOfRole('ceo'))!;
    const p = await s.projects.create({ name: 'Owner Gates', objective: 'Owner approves gates' });
    const a = await s.approvals.request({ projectId: p.id, gate: 'DESIGN', title: 'design' });
    await s.approvals.reassignToOwner(a.id, 'Owner policy');
    expect((await s.approvals.get(a.id))?.approverRole).toBe('OWNER');
    await expect(s.approvals.decide(a.id, { type: 'AGENT', employeeId: ceo.id, name: ceo.name }, 'APPROVED', 'x')).rejects.toThrow(/Owner/);
    expect((await s.approvals.decide(a.id, { type: 'OWNER', id: 'o', name: 'Owner' }, 'APPROVED', 'ok')).decidedBy).toBe('OWNER');
  });

  it('assignment honours exclusion (author is never the reviewer)', async () => {
    const r1 = (await s.org.pick('code-reviewer'))!;
    const r2 = await s.org.pick('code-reviewer', [r1.id]);
    expect(r2?.id).not.toBe(r1.id);
  });
});

describe('fallback policy', () => {
  async function run(mode: 'AUTO' | 'ASK_OWNER' | 'DISABLED', enabled: boolean) {
    await s.db.update(m.schema.company).set({ policies: { ...m.def.DEFAULT_POLICIES, fallbackMode: mode, fallbackEnabled: enabled } });
    const p = await s.projects.create({ name: `Fallback ${mode}`, objective: 'fallback' });
    const emp = (await s.org.pick('market-researcher'))!;
    const role = (await s.org.role('market-researcher'))!;
    const task = await s.tasks.create({ projectId: p.id, phase: 'RESEARCH', stage: 'research.investigate', roleKey: 'market-researcher', title: 'Market research', assigneeId: emp.id });
    return s.executor.execute({ task, employee: emp, role, prompt: 'x', root: path.join(dataDir, 'scratch'), label: 'test' }).then(() => null, (e) => ({ e, p, task }));
  }

  it('pauses (never silently switches) when fallback is not enabled', async () => {
    const r = await run('AUTO', false);
    expect(r?.e).toBeInstanceOf(m.executor.RuntimeBlockedError);
    expect(String(r?.e.message)).toMatch(/No fallback provider is enabled/);
  });

  it('ASK_OWNER requests an Owner approval and pauses the task', async () => {
    await s.fallback.create({ name: 'Local Ollama', provider: 'OLLAMA', baseUrl: 'http://127.0.0.1:9', model: 'llama3' });
    const r = await run('ASK_OWNER', true);
    expect(r?.e).toBeInstanceOf(m.executor.RuntimeBlockedError);
    const pending = await s.approvals.list({ status: 'PENDING', projectId: r!.p.id });
    const fb = pending.find((a) => a.gate === 'FALLBACK_USAGE');
    expect(fb?.approverRole).toBe('OWNER');
    expect(fb?.reason).toMatch(/KIRO_TEMPORARILY_UNAVAILABLE/);
  });

  it('DISABLED pauses until Kiro returns', async () => {
    const r = await run('DISABLED', true);
    expect(String(r?.e.message)).toMatch(/DISABLED/);
  });

  it('AUTO tries the fallback provider and records the run with its reason', async () => {
    const r = await run('AUTO', true); // provider at 127.0.0.1:9 is unreachable → recorded failure, task paused
    expect(String(r?.e.message)).toMatch(/all fallback providers failed/);
    const runs = await s.db.select().from(m.schema.agentRuns);
    const fb = runs.find((x) => x.runtime === 'FALLBACK');
    expect(fb?.fallbackReason).toBe('KIRO_TEMPORARILY_UNAVAILABLE');
    expect(fb?.provider).toBe('Local Ollama');
    expect(fb?.status).toBe('FAILED');
  });
});

describe('progress is derived, not hardcoded', () => {
  it('starts near zero and explains each group', async () => {
    const p = await s.projects.create({ name: 'Progress', objective: 'progress' });
    const pr = await s.projects.progress(p.id);
    expect(pr.overall).toBeLessThan(5);
    expect(pr.groups.find((g) => g.key === 'security')?.locked).toBe(true);
    expect(pr.groups.every((g) => g.explanation.length > 0)).toBe(true);
  });
});

describe('connected providers as primary AI', () => {
  it('uses 9Router directly even when Kiro is available and fallback is disabled', async () => {
    const http = await import('node:http');
    const { vi } = await import('vitest');
    const server = http.createServer(async (req, res) => {
      for await (const chunk of req) { /* consume request */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '# Router ready\n```json\n{"reply":"Router ready"}\n```' } }], model: 'router/test' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as import('node:net').AddressInfo).port;
    const accepting = vi.spyOn(s.kiro, 'acceptingJobs').mockImplementation(() => { throw new Error('Kiro should not be consulted in provider-primary mode'); });
    try {
      await s.db.update(m.schema.providerConnections).set({ enabled: false });
      await s.fallback.create({ name: '9Router integration', provider: 'NINE_ROUTER', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'router/test', priority: 1 });
      await s.db.update(m.schema.company).set({ policies: { ...m.def.DEFAULT_POLICIES, primaryRuntime: 'PROVIDERS', fallbackEnabled: false, fallbackMode: 'DISABLED' } });
      const employee = (await s.org.pick('ceo'))!; const role = (await s.org.role('ceo'))!;
      const result = await s.executor.execute({ task: null, employee, role, prompt: 'Say ready', root: path.join(dataDir, 'router-primary'), label: 'Router primary', expectJson: true });
      expect(result.provider).toBe('9Router integration'); expect(result.extracted.data?.reply).toBe('Router ready');
      expect(accepting).not.toHaveBeenCalled();
    } finally { accepting.mockRestore(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
