import { spawn, type ChildProcess } from 'node:child_process';

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number }

const isWindows = process.platform === 'win32';

/**
 * Run a command with an argument array. `npm`/`npx` need a shell on Windows (they are .cmd shims),
 * so for those only we enable the shell — arguments are validated by callers and never contain
 * user-provided free text.
 */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxOutput?: number } = {}): Promise<RunResult> {
  const started = Date.now();
  const maxOutput = opts.maxOutput ?? 200_000;
  return new Promise((resolve) => {
    const needsShell = isWindows && /^(npm|npx|pnpm|yarn)$/.test(cmd);
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, shell: needsShell, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e), timedOut: false, durationMs: 0 });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, opts.timeoutMs) : null;
    child.stdout?.on('data', (d) => { if (stdout.length < maxOutput) stdout += d.toString(); });
    child.stderr?.on('data', (d) => { if (stderr.length < maxOutput) stderr += d.toString(); });
    child.on('error', (e) => { stderr += String(e); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

export function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
}

export function npmSpawn(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  return spawn('npm', args, { cwd: opts.cwd, env: opts.env ?? process.env, shell: isWindows, windowsHide: true, detached: !isWindows });
}

export function tail(s: string, n = 4000): string {
  return s.length > n ? '…' + s.slice(-n) : s;
}
