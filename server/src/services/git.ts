import fs from 'node:fs';
import path from 'node:path';
import { run, type RunResult } from '../lib/proc.js';

export interface GitAuthor { name: string; email: string }
export const SYSTEM_AUTHOR: GitAuthor = { name: 'AI Company OS', email: 'system@company.local' };

const DEFAULT_GITIGNORE = `node_modules/
dist/
build/
.next/
coverage/
*.log
.env
.env.*
!.env.example
data/
*.sqlite
*.db
`;

async function git(cwd: string, args: string[], author?: GitAuthor): Promise<RunResult> {
  const pre = author ? ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`] : ['-c', `user.name=${SYSTEM_AUTHOR.name}`, '-c', `user.email=${SYSTEM_AUTHOR.email}`];
  return run('git', [...pre, '-c', 'core.autocrlf=false', '-c', 'advice.detachedHead=false', ...args], { cwd, timeoutMs: 120_000 });
}

function must(r: RunResult, what: string): string {
  if (r.code !== 0) throw new Error(`git ${what} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
  return r.stdout.trim();
}

export function authorFor(employee: { name: string; code: string }): GitAuthor {
  return { name: `${employee.name} (AI)`, email: `${employee.code.toLowerCase()}@agents.company.local` };
}

export class GitService {
  async available(): Promise<{ ok: boolean; version: string | null }> {
    const r = await run('git', ['--version'], { timeoutMs: 10_000 });
    return { ok: r.code === 0, version: r.code === 0 ? r.stdout.trim() : null };
  }

  /** Creates the project repository with main + develop branches. */
  async init(repo: string, project: { code: string; name: string; objective: string }): Promise<void> {
    fs.mkdirSync(repo, { recursive: true });
    if (fs.existsSync(path.join(repo, '.git'))) return;
    must(await git(repo, ['init', '-b', 'main']), 'init');
    fs.writeFileSync(path.join(repo, '.gitignore'), DEFAULT_GITIGNORE);
    fs.writeFileSync(path.join(repo, 'COMPANY_PROJECT.md'), `# ${project.name}\n\nProject ${project.code} — managed by AI Startup Company OS.\n\nObjective: ${project.objective}\n`);
    must(await git(repo, ['add', '-A']), 'add');
    must(await git(repo, ['commit', '-m', `chore: initialise ${project.code} repository`]), 'commit');
    must(await git(repo, ['checkout', '-b', 'develop']), 'checkout develop');
  }

  async head(cwd: string, ref = 'HEAD'): Promise<string> { return must(await git(cwd, ['rev-parse', ref]), 'rev-parse'); }
  async currentBranch(cwd: string): Promise<string> { return must(await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), 'branch'); }

  async addWorktree(repo: string, wtPath: string, branch: string, base = 'develop'): Promise<void> {
    if (fs.existsSync(wtPath)) return;
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    const exists = (await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0;
    must(await git(repo, exists ? ['worktree', 'add', wtPath, branch] : ['worktree', 'add', '-b', branch, wtPath, base]), 'worktree add');
  }

  async addDetachedWorktree(repo: string, wtPath: string, ref: string): Promise<void> {
    if (fs.existsSync(wtPath)) { await this.removeWorktree(repo, wtPath); }
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    must(await git(repo, ['worktree', 'add', '--detach', wtPath, ref]), 'worktree add detached');
  }

  async removeWorktree(repo: string, wtPath: string): Promise<void> {
    await git(repo, ['worktree', 'remove', '--force', wtPath]);
    if (fs.existsSync(wtPath)) fs.rmSync(wtPath, { recursive: true, force: true });
    await git(repo, ['worktree', 'prune']);
  }

  /** Stages everything and commits with agent attribution. Returns the commit hash or null when nothing changed. */
  async commitAll(cwd: string, message: string, author: GitAuthor): Promise<string | null> {
    must(await git(cwd, ['add', '-A']), 'add');
    const status = must(await git(cwd, ['status', '--porcelain']), 'status');
    if (!status) return null;
    must(await git(cwd, ['commit', '-m', message], author), 'commit');
    return this.head(cwd);
  }

  async changedFiles(cwd: string, base: string, head = 'HEAD'): Promise<string[]> {
    const out = must(await git(cwd, ['diff', '--name-only', `${base}...${head}`]), 'diff --name-only');
    return out ? out.split(/\r?\n/) : [];
  }

  async diff(cwd: string, base: string, head = 'HEAD', maxChars = 60_000): Promise<{ stat: string; patch: string; truncated: boolean }> {
    const stat = must(await git(cwd, ['diff', '--stat', `${base}...${head}`]), 'diff --stat');
    const r = await run('git', ['diff', `${base}...${head}`, '--', '.', ':(exclude)package-lock.json'], { cwd, timeoutMs: 60_000, maxOutput: maxChars + 1000 });
    return { stat, patch: r.stdout.slice(0, maxChars), truncated: r.stdout.length > maxChars };
  }

  /** Merges `branch` into the branch checked out at `repo` (develop). Aborts on conflict. */
  async merge(repo: string, branch: string, message: string): Promise<{ ok: true; commit: string } | { ok: false; conflicts: string[]; error: string }> {
    const r = await git(repo, ['merge', '--no-ff', branch, '-m', message]);
    if (r.code === 0) return { ok: true, commit: await this.head(repo) };
    const conflicts = (await git(repo, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim().split(/\r?\n/).filter(Boolean);
    await git(repo, ['merge', '--abort']);
    return { ok: false, conflicts, error: (r.stdout + r.stderr).trim().slice(0, 1000) };
  }

  /** Starts a merge inside a worktree and leaves conflict markers for an integration engineer. */
  async startConflictedMerge(wt: string, branch: string): Promise<string[]> {
    await git(wt, ['merge', '--no-ff', '--no-commit', branch]);
    return (await git(wt, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim().split(/\r?\n/).filter(Boolean);
  }

  async checkout(repo: string, branch: string): Promise<void> { must(await git(repo, ['checkout', branch]), `checkout ${branch}`); }

  /** Fast-forward/merge develop into main for a release, tag it, return commit. */
  async release(repo: string, version: string, notes: string): Promise<string> {
    must(await git(repo, ['checkout', 'main']), 'checkout main');
    const m = await git(repo, ['merge', '--no-ff', 'develop', '-m', `release: v${version}`]);
    if (m.code !== 0) { await git(repo, ['merge', '--abort']); await git(repo, ['checkout', 'develop']); throw new Error(`Release merge failed: ${(m.stderr || m.stdout).slice(0, 400)}`); }
    must(await git(repo, ['tag', '-a', `v${version}`, '-m', notes.slice(0, 2000) || `Release ${version}`]), 'tag');
    const commit = await this.head(repo);
    must(await git(repo, ['checkout', 'develop']), 'checkout develop');
    return commit;
  }

  async log(cwd: string, n = 30): Promise<{ hash: string; author: string; date: string; subject: string }[]> {
    const r = await git(cwd, ['log', '--all', `-n${n}`, '--date=iso-strict', '--pretty=format:%H%x1f%an%x1f%ad%x1f%s']);
    if (r.code !== 0 || !r.stdout.trim()) return [];
    return r.stdout.trim().split(/\r?\n/).map((l) => { const [hash, author, date, subject] = l.split('\x1f'); return { hash, author, date, subject }; });
  }

  async branches(cwd: string): Promise<string[]> {
    const r = await git(cwd, ['branch', '--format=%(refname:short)']);
    return r.code === 0 ? r.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  }
}
