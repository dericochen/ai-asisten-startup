import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { run, killTree, type RunResult } from './proc.js';

export interface SandboxOptions {
  dir: string; args: string[]; network?: 'registry' | 'application'; port?: number;
  env?: Record<string, string>; dataDir?: string;
}

/** Pass only process-launch essentials. Never forward database URLs or provider credentials. */
export function processEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'home', 'userprofile', 'localappdata', 'appdata']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
}

export function containerArgs(o: SandboxOptions, name: string, mask: string): string[] {
  const dir = fs.realpathSync(o.dir);
  const args = ['run', '--rm', '--name', name, '--init', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, '--read-only', '--pids-limit=256', '--memory=2g', '--cpus=2', '--tmpfs', '/tmp:rw,nosuid,size=512m',
    '--workdir', '/workspace', '--mount', `type=bind,source=${dir},target=/workspace`,
    '--mount', `type=bind,source=${mask},target=/workspace/.git,readonly`,
    '--network', o.network === 'registry' ? 'bridge' : o.network === 'application' ? 'aco-apps-internal' : 'none',
    '--env', 'HOME=/tmp', '--env', 'npm_config_cache=/tmp/npm', '--env', 'CI=1'];
  if (o.dataDir) {
    fs.mkdirSync(o.dataDir, { recursive: true });
    args.push('--mount', `type=bind,source=${fs.realpathSync(o.dataDir)},target=/app-data`, '--env', 'DATA_DIR=/app-data');
  }
  for (const [key, value] of Object.entries(o.env ?? {})) {
    if (!['NODE_ENV', 'HOST', 'PORT'].includes(key)) throw new Error(`Unsupported sandbox environment variable: ${key}`);
    args.push('--env', `${key}=${value}`);
  }
  if (o.port !== undefined) {
    if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65535) throw new Error('Invalid sandbox port');
    args.push('--publish', `127.0.0.1:${o.port}:${o.port}`);
  }
  args.push(process.env.ACO_SANDBOX_IMAGE || 'node:24-bookworm-slim', 'npm', ...o.args);
  return args;
}

async function prepare(o: SandboxOptions) {
  const env = processEnvironment();
  const check = await run('docker', ['info', '--format', '{{.OSType}}'], { env, timeoutMs: 15_000 });
  if (check.code !== 0 || check.stdout.trim() !== 'linux') throw new Error('Generated code is blocked: start Docker Desktop with Linux containers. No host execution fallback is permitted.');
  if (o.network === 'application') {
    const inspect = await run('docker', ['network', 'inspect', 'aco-apps-internal', '--format', '{{.Internal}}'], { env, timeoutMs: 15_000 });
    if (inspect.code !== 0) {
      await run('docker', ['network', 'create', '--internal', 'aco-apps-internal'], { env, timeoutMs: 15_000 });
    }
    const verify = await run('docker', ['network', 'inspect', 'aco-apps-internal', '--format', '{{.Internal}}'], { env, timeoutMs: 15_000 });
    if (verify.code !== 0 || verify.stdout.trim() !== 'true') throw new Error('Application sandbox network must be internal.');
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-sandbox-'));
  const mask = path.join(temp, 'git-mask');
  if (fs.existsSync(path.join(o.dir, '.git')) && fs.lstatSync(path.join(o.dir, '.git')).isFile()) fs.writeFileSync(mask, '');
  else fs.mkdirSync(mask);
  const name = `aco-${crypto.randomUUID()}`;
  try { return { temp, name, env, args: containerArgs(o, name, mask) }; }
  catch (e) { fs.rmSync(temp, { recursive: true, force: true }); throw e; }
}

export async function sandboxRun(o: SandboxOptions, timeoutMs: number): Promise<RunResult> {
  const started = Date.now();
  let state: Awaited<ReturnType<typeof prepare>> | undefined;
  try {
    state = await prepare(o);
    return await run('docker', state.args, { env: state.env, timeoutMs });
  } catch (e) {
    return { code: -1, stdout: '', stderr: String((e as Error).message), timedOut: false, durationMs: Date.now() - started };
  } finally {
    if (state) {
      await run('docker', ['rm', '-f', state.name], { env: state.env, timeoutMs: 15_000 });
      fs.rmSync(state.temp, { recursive: true, force: true });
    }
  }
}

export async function sandboxStart(o: SandboxOptions): Promise<{ child: ChildProcess; stop: () => Promise<void> }> {
  const state = await prepare(o);
  const child = spawn('docker', state.args, { env: state.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await run('docker', ['rm', '-f', state.name], { env: state.env, timeoutMs: 15_000 });
    killTree(child);
    fs.rmSync(state.temp, { recursive: true, force: true });
  };
  child.once('error', () => { void stop(); });
  child.once('close', () => { void stop(); });
  return { child, stop };
}
