import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidePermission, isInside, type PermissionContext } from '../src/kiro/policy.js';
import { containerArgs, processEnvironment, proxyArgs } from '../src/lib/sandbox.js';
import { buildAgentProfile } from '../src/kiro/agents.js';
const dirs: string[] = [];
function dir() { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-isolation-')); dirs.push(p); return p; }
afterEach(() => { for (const p of dirs.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
describe('agent execution boundary', () => {
  it.each(['node -e "process.chdir(String.fromCharCode(67,58,92))"', 'python -c "print(1)"', 'npm run build', 'npm install', 'cmd /c echo hello'])('blocks direct agent shell: %s', (command) => {
    const ctx: PermissionContext = { root: dir(), forbidden: [], caps: { tools: ['shell'], canShell: true, canWriteCode: true, canWeb: true } };
    expect(decidePermission('shell', { command }, ctx).allow).toBe(false);
  });
  it('does not give engineer profiles a shell tool', () => { expect(buildAgentProfile('backend-engineer').tools).not.toContain('shell'); });
  it('rejects junctions leading outside the workspace', () => {
    const root = dir(); const outside = dir(); fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(isInside(root, path.join(root, 'escape', 'new.txt'))).toBe(false);
  });
  it('drops host provider credentials and runtime injection variables', () => {
    expect(processEnvironment({ PATH: '/bin', ACO_MASTER_KEY: 'secret', DATABASE_URL: 'secret', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require evil' })).toEqual({ PATH: '/bin' });
  });
  it('runs builds without networking and masks Git metadata', () => {
    const args = containerArgs({ dir: dir(), args: ['run', 'build'] }, 'test', '/mask');
    expect(args).toContain('none'); expect(args).toContain('--read-only'); expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('type=bind,source=/mask,target=/workspace/.git,readonly');
    expect(args.join(' ')).not.toContain('docker.sock');
  });
  it('publishes application ports only on loopback using an internal network', () => {
    const args = containerArgs({ dir: dir(), args: ['run', 'start'], network: 'application', port: 4501 }, 'test', '/mask');
    expect(args).not.toContain('--publish'); expect(args).toContain('aco-apps-internal');
    const proxy = proxyArgs('aco-test', 4501);
    expect(proxy).toContain('127.0.0.1:4501:4501'); expect(proxy).not.toContain('--mount');
    expect(proxy).toContain('aco-proxy-ingress'); expect(proxy).toContain('aco-apps-internal');
  });
});
