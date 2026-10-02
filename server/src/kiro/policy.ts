import path from 'node:path';
import fs from 'node:fs';
import type { RoleCapabilities } from '../db/schema.js';

export interface PermissionContext {
  caps: RoleCapabilities;
  /** The only directory tree this agent may touch (task worktree or project workspace). */
  root: string;
  /** Additional absolute paths that are always forbidden (company data, secrets, Kiro home). */
  forbidden: string[];
}

export interface PermissionDecision { allow: boolean; reason: string; tool: string }

const isWin = process.platform === 'win32';
const norm = (p: string) => { const r = path.resolve(p); return isWin ? r.toLowerCase() : r; };

export function isInside(root: string, target: string): boolean {
  const r = norm(root);
  const t = norm(path.isAbsolute(target) ? target : path.join(root, target));
  if (!(t === r || t.startsWith(r + path.sep))) return false;
  if (isWin && path.relative(r, t).split(/[\\/]/).some((part) => /[:]|[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return false;
  let current = t;
  while (current !== path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return false; }
    catch (e) { if (!['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return false; }
    current = path.dirname(current);
  }
  return true;
}

export function normalizeToolName(name: string | undefined, rawInput: Record<string, unknown> | undefined): string {
  const n = (name ?? '').toLowerCase();
  if (/^(fs_)?write$|^write$/.test(n)) return 'write';
  if (/^(fs_)?read$/.test(n)) return 'read';
  if (/shell|execute_(bash|cmd)|executebash/.test(n)) return 'shell';
  if (['glob', 'grep', 'code', 'web_search', 'web_fetch', 'todo_list'].includes(n)) return n;
  if (n) return n;
  // Infer from input shape when the tool name was not announced.
  const ri = rawInput ?? {};
  if (typeof ri.url === 'string') return 'web_fetch';
  if (typeof ri.query === 'string' && !('path' in ri)) return 'web_search';
  if (typeof ri.command === 'string' && ['create', 'strReplace', 'insert', 'append'].includes(ri.command)) return 'write';
  if (typeof ri.command === 'string') return 'shell';
  if (Array.isArray(ri.operations)) return 'read';
  return 'unknown';
}

function collectPaths(rawInput: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.push(v); };
  push(rawInput.path); push(rawInput.file_path); push(rawInput.working_dir); push(rawInput.cwd);
  if (Array.isArray(rawInput.operations)) for (const op of rawInput.operations as Record<string, unknown>[]) { push(op?.path); if (Array.isArray(op?.image_paths)) (op.image_paths as unknown[]).forEach(push); }
  if (Array.isArray(rawInput.image_paths)) (rawInput.image_paths as unknown[]).forEach(push);
  return out;
}

const DENY_SHELL: [RegExp, string][] = [
  [/\bgit\s+(push|reset\s+--hard|clean\s+-\w*f|rebase|commit|merge|checkout\s+(main|master|develop)\b|branch\s+-D|worktree|remote|tag|config)\b/i, 'Git history, branches and remotes are managed by the company system (commits are attributed automatically).'],
  [/--force\b/i, 'Force operations require Owner approval.'],
  [/\b(shutdown|reboot|format|mkfs|diskpart|bcdedit|reg\s+(add|delete)|netsh|sc\s+(stop|delete|config)|takeown|icacls|chmod\s+-R\s+777|chown\s+-R)\b/i, 'System-level commands are forbidden.'],
  [/\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i, 'Piping downloaded content into a shell is forbidden.'],
  [/\bnpm\s+(publish|adduser|login|logout|token|owner|deprecate|unpublish)\b/i, 'Publishing packages is forbidden.'],
  [/\b(vercel|netlify|railway|flyctl|heroku|wrangler)\b/i, 'Deployments are performed by DevOps through the deployment adapter after release gates.'],
  [/\b(drop\s+(database|schema|table)|truncate\s+table)\b/i, 'Destructive database statements require approval.'],
  [/\bnpm\s+(run\s+)?(start|dev|serve|preview)\b|\bnext\s+(dev|start)\b|\bvite(\s|$)|\bnodemon\b|\bpm2\b/i, 'Long-running servers are started by the QA/DevOps system. Run build and test commands instead.'],
  [/\b(sudo|runas|su\s)\b/i, 'Privilege escalation is forbidden.'],
  [/(?:^|[\s"'=;&|(])\.\.(?:[\\/]|\s|$)/, 'Commands may not leave the assigned workspace (path traversal).'],
  [/master\.key|kiro-home|pglite|[\\/]secrets[\\/]|\.ssh[\\/]|id_rsa|\.aws[\\/]credentials/i, 'Access to company secrets and credentials is forbidden.'],
  [/\b(env|printenv|set)\s*$|Get-ChildItem\s+env:|\$env:\w*(KEY|TOKEN|SECRET)/i, 'Dumping environment variables is forbidden.'],
];

const RECURSIVE_DELETE = /\b(rm\s+-\w*r\w*|rmdir\s+\/s|Remove-Item\b[^\n]*-Recurse|rd\s+\/s|del\s+\/s)\b/i;

function checkShell(command: string, ctx: PermissionContext): string | null {
  for (const [re, reason] of DENY_SHELL) if (re.test(command)) return reason;
  // Absolute paths must stay inside the workspace.
  const abs = command.match(/[A-Za-z]:[\\/][^\s"'|;&<>]*|(?<=\s|^|["'])\/(?!dev\/null)[^\s"'|;&<>]+/g) ?? [];
  for (const p of abs) if (!isInside(ctx.root, p)) return `Path ${p} is outside the assigned workspace.`;
  if (RECURSIVE_DELETE.test(command)) {
    const tokens = command.split(/\s+/).slice(1).filter((t) => !t.startsWith('-') && !t.startsWith('/') && !/^(rm|rmdir|rd|del|Remove-Item)$/i.test(t));
    const unsafe = tokens.filter((t) => t === '.' || t === '*' || t === '~' || t.includes('..') || /^[A-Za-z]:/.test(t) || t.startsWith('$'));
    if (!tokens.length || unsafe.length) return 'Recursive delete is only allowed for explicit relative paths inside the workspace.';
  }
  return null;
}

function checkUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'Invalid URL'; }
  if (!/^https?:$/.test(u.protocol)) return 'Only http(s) URLs are allowed.';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '0.0.0.0' || h === '[::1]' || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    return 'Requests to local/private network addresses are forbidden (protects the company control plane).';
  }
  return null;
}

/** Decide whether a Kiro tool call may run. Pure function — every decision is recorded by the caller. */
export function decidePermission(toolNameRaw: string | undefined, rawInput: Record<string, unknown> | undefined, ctx: PermissionContext): PermissionDecision {
  const ri = rawInput ?? {};
  const tool = normalizeToolName(toolNameRaw, ri);
  const deny = (reason: string): PermissionDecision => ({ allow: false, reason, tool });
  const allow = (reason: string): PermissionDecision => ({ allow: true, reason, tool });

  const paths = collectPaths(ri);
  if (['read', 'write', 'glob', 'grep', 'code'].includes(tool) && !paths.length) return deny('An explicit workspace path is required.');
  for (const p of paths) {
    if (!isInside(ctx.root, p)) return deny(`Path ${p} is outside the assigned workspace.`);
    if (ctx.forbidden.some((f) => isInside(f, path.isAbsolute(p) ? p : path.join(ctx.root, p)))) return deny('Path is a protected company location.');
  }

  switch (tool) {
    case 'read': case 'glob': case 'grep': case 'code': case 'todo_list':
      return allow('Read-only access inside the assigned workspace.');
    case 'write': {
      if (!ctx.caps.canWriteCode) return deny('This role is not permitted to modify files.');
      const target = typeof ri.path === 'string' ? ri.path : '';
      if (!target) return deny('Write without a target path.');
      const rel = path.relative(ctx.root, path.isAbsolute(target) ? target : path.join(ctx.root, target));
      if (rel.toLowerCase().split(/[\\/]/).includes('.git')) return deny('Direct edits to git internals are forbidden.');
      const base = path.basename(target);
      if (/^\.env(\..+)?$/i.test(base) && base !== '.env.example') return deny('Writing real environment/secret files is forbidden; use .env.example.');
      return allow('Write inside the assigned workspace.');
    }
    case 'shell': {
      return deny('Direct agent shell execution is disabled. The platform runs build, test and start in Docker.');
      /*
      if (!ctx.caps.canShell) return deny('This role is not permitted to run shell commands.');
      const cmd = typeof ri.command === 'string' ? ri.command : '';
      if (!cmd) return deny('Empty command.');
      const reason = checkShell(cmd, ctx);
      return reason ? deny(reason) : allow('Command passed policy checks.');
      */
    }
    case 'web_search':
      return ctx.caps.canWeb ? allow('Web research permitted for this role.') : deny('This role is not permitted to use the web.');
    case 'web_fetch': {
      if (!ctx.caps.canWeb) return deny('This role is not permitted to use the web.');
      const reason = typeof ri.url === 'string' ? checkUrl(ri.url) : 'Missing URL';
      return reason ? deny(reason) : allow('Web fetch permitted for this role.');
    }
    default:
      return deny(`Tool "${tool}" is not permitted for company agents.`);
  }
}
