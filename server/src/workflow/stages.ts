import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { artifacts, type ArtifactKind, type Gate } from '../db/schema.js';
import type { Services } from '../core/container.js';
import type { Task } from '../services/tasks.js';
import type { Project } from '../services/projects.js';
import type { Employee, Role } from '../org/service.js';
import { RuntimeBlockedError, type ExecuteResult } from '../services/executor.js';
import { GateLockedError } from './guard.js';
import { PROMPTS, CONTEXT_DIR, contextFileName, type PromptContext } from './prompts.js';
import { authorFor } from '../services/git.js';
import { asString, asStringArray } from '../lib/extract.js';
import { dependencyAudit, httpSmoke, npmInstall, npmScript, performance, secretScan, securityHeaders, startApp, type CheckResult, type RuntimeContract } from '../services/quality.js';
import { config } from '../config.js';
import { tail } from '../lib/proc.js';

type Workspace = 'scratch' | 'repo' | 'worktree' | 'qa-checkout';
interface StageCtx { s: Services; task: Task; project: Project; employee: Employee; role: Role }
interface AgentStage {
  kind: 'agent';
  prompt: string;
  workspace: Workspace;
  docs: (c: StageCtx) => Promise<Record<string, string>>;
  fallbackOutput?: 'files';
  onResult: (c: StageCtx, r: ExecuteResult, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
interface SystemStage { kind: 'system'; run: (c: StageCtx) => Promise<Record<string, unknown>> }
type StageDef = AgentStage | SystemStage;

export const GATE_LABEL: Record<string, string> = { RESEARCH: 'Research', PRODUCT: 'Product scope', DESIGN: 'Design', ARCHITECTURE: 'Architecture', RELEASE: 'Release' };

// ───────── helpers ─────────

async function doc(s: Services, projectId: string, kind: ArtifactKind, title?: string): Promise<string> {
  const rows = await s.db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.kind, kind), ...(title ? [eq(artifacts.title, title)] : []))).orderBy(desc(artifacts.createdAt)).limit(1);
  return rows[0]?.content ?? '';
}

async function findingsFor(s: Services, projectId: string): Promise<string> {
  const rows = await s.db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.kind, 'RESEARCH_FINDINGS'))).orderBy(desc(artifacts.createdAt));
  const latestByTitle = new Map<string, string>();
  for (const r of rows) if (!latestByTitle.has(r.title)) latestByTitle.set(r.title, `#### ${r.title} (v${r.version})\n${r.content.slice(0, 9000)}`);
  return [...latestByTitle.values()].join('\n\n');
}

function verdictOf(data: Record<string, unknown>, key = 'verdict'): string { return asString(data[key]).toUpperCase().trim(); }

const severe = (items: unknown, key = 'severity') => (Array.isArray(items) ? items : []).filter((i) => /critical|high/i.test(String((i as Record<string, unknown>)?.[key] ?? '')));

export function contractOf(p: Project): RuntimeContract {
  return { healthPath: p.deployment.healthPath || '/api/health', routes: p.deployment.routes?.length ? p.deployment.routes : ['/'], apiChecks: p.deployment.apiChecks ?? [] };
}

function projectNumber(p: Project): number { return Number(p.code.split('-')[1]); }

function formatChecks(results: CheckResult[]): string {
  return results.map((r) => `- [${r.status}] ${r.name} (${r.durationMs}ms): ${tail(r.details, 600).replace(/\n/g, '\n    ')}`).join('\n');
}

/** Adds a pattern to <repo>/.git/info/exclude (applies to every worktree of the repo). */
function ensureGitExclude(repo: string, pattern: string): void {
  const file = path.join(repo, '.git', 'info', 'exclude');
  try {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!cur.split(/\r?\n/).includes(pattern)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${cur && !cur.endsWith('\n') ? '\n' : ''}${pattern}\n`); }
  } catch { /* repo not initialised yet */ }
}

/** Per-project serialisation of git operations in the main repository. */
const gitLocks = new Map<string, Promise<unknown>>();
async function withGitLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = gitLocks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  gitLocks.set(projectId, next);
  return next;
}

// ───────── stage definitions ─────────

const gateReview = (gate: Gate, docKeys: (c: StageCtx) => Promise<Record<string, string>>): AgentStage => ({
  kind: 'agent', prompt: 'executive.gate_review', workspace: 'scratch', docs: docKeys,
  onResult: async (c, r, data) => {
    const decision = verdictOf(data, 'decision') === 'APPROVE' ? 'APPROVED' : 'REVISION_REQUESTED';
    const note = [asString(data.rationale), ...asStringArray(data.requiredChanges).map((x) => `- ${x}`)].filter(Boolean).join('\n');
    await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'EXECUTIVE_REVIEW', title: `${GATE_LABEL[gate]} gate review`, content: r.extracted.body, data, authorId: c.employee.id });
    const approvalId = String(c.task.input.approvalId ?? '');
    try {
      await c.s.approvals.decide(approvalId, { type: 'AGENT', employeeId: c.employee.id, name: c.employee.name }, decision, note || (decision === 'APPROVED' ? 'Approved' : 'Revision requested'));
    } catch (e) {
      // Owner may have decided first, or authority checks rejected the agent — both are recorded, never bypassed.
      await c.s.bus.emit('SYSTEM', `${c.employee.name} could not record ${gate} decision: ${(e as Error).message}`, { projectId: c.project.id, taskId: c.task.id });
    }
    await c.s.meetings.record({
      projectId: c.project.id, type: `${GATE_LABEL[gate]} Review`, title: `${GATE_LABEL[gate]} gate review — ${c.project.name}`,
      participants: [c.employee.name], agenda: [`Decide ${GATE_LABEL[gate]} gate`], positions: [{ who: c.employee.name, position: asString(data.rationale).slice(0, 1000) }],
      objections: asStringArray(data.concerns), decision: decision === 'APPROVED' ? 'Approved' : 'Revision requested', actionItems: asStringArray(data.requiredChanges),
    });
    return { decision, rationale: asString(data.rationale) };
  },
});

const reviewArtifact = (kind: ArtifactKind, title: string): AgentStage['onResult'] => async (c, r, data) => {
  await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind, title, content: r.extracted.body, data, authorId: c.employee.id });
  return { verdict: verdictOf(data) === 'REVISE' ? 'REVISE' : 'PASS', summary: asString(data.summary), issues: data.issues ?? data.challenges ?? data.checked ?? [] };
};

export const STAGES: Record<string, StageDef> = {
  'research.brief': {
    kind: 'agent', prompt: 'research.brief', workspace: 'scratch', docs: async () => ({}),
    onResult: async (c, r, data) => { await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'RESEARCH_BRIEF', title: 'Research brief', content: r.extracted.body, data, authorId: c.employee.id }); return { questions: data.questions ?? {} }; },
  },
  'research.investigate': {
    kind: 'agent', prompt: 'research.investigate', workspace: 'scratch',
    docs: async (c) => ({ 'Research brief': await doc(c.s, c.project.id, 'RESEARCH_BRIEF'), 'Previous findings': c.task.round > 1 ? await doc(c.s, c.project.id, 'RESEARCH_FINDINGS', `${String(c.task.input.track)} research`) : '' }),
    onResult: async (c, r, data) => { await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'RESEARCH_FINDINGS', title: `${String(c.task.input.track)} research`, content: r.extracted.body, data, authorId: c.employee.id }); return { findings: Array.isArray(data.keyFindings) ? data.keyFindings.length : 0 }; },
  },
  'research.critique': { kind: 'agent', prompt: 'research.critique', workspace: 'scratch', docs: async (c) => ({ 'Research findings': await findingsFor(c.s, c.project.id) }), onResult: reviewArtifact('RESEARCH_CRITIQUE', 'Research critique') },
  'research.factcheck': { kind: 'agent', prompt: 'research.factcheck', workspace: 'scratch', docs: async (c) => ({ 'Research findings': await findingsFor(c.s, c.project.id) }), onResult: reviewArtifact('RESEARCH_CRITIQUE', 'Fact check') },
  'research.synthesize': {
    kind: 'agent', prompt: 'research.synthesize', workspace: 'scratch',
    docs: async (c) => ({ 'Research findings': await findingsFor(c.s, c.project.id), 'Research critique': await doc(c.s, c.project.id, 'RESEARCH_CRITIQUE', 'Research critique'), 'Fact check': await doc(c.s, c.project.id, 'RESEARCH_CRITIQUE', 'Fact check') }),
    onResult: async (c, r, data) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'RESEARCH_REPORT', title: 'Research report', content: r.extracted.body, data, authorId: c.employee.id });
      if (data.recommendation) await c.s.memory.remember({ scope: 'PROJECT', projectId: c.project.id, kind: 'DECISION', content: `Research recommendation for ${c.project.name}: ${asString(data.recommendation)}` });
      return { recommendation: asString(data.recommendation) };
    },
  },
  'research.ceo_review': gateReview('RESEARCH', async (c) => ({ 'Research report': await doc(c.s, c.project.id, 'RESEARCH_REPORT'), 'Research critique': await doc(c.s, c.project.id, 'RESEARCH_CRITIQUE', 'Research critique') })),

  'product.prd': {
    kind: 'agent', prompt: 'product.prd', workspace: 'scratch',
    docs: async (c) => ({ 'Research report': await doc(c.s, c.project.id, 'RESEARCH_REPORT'), 'Previous PRD': c.task.round > 1 ? await doc(c.s, c.project.id, 'PRD', 'Product requirements') : '' }),
    onResult: async (c, r, data) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'PRD', title: 'Product requirements', content: r.extracted.body, data, authorId: c.employee.id });
      return { features: Array.isArray(data.mvpFeatures) ? data.mvpFeatures.length : 0 };
    },
  },
  'product.critique': { kind: 'agent', prompt: 'product.critique', workspace: 'scratch', docs: async (c) => ({ PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements'), 'Research report': await doc(c.s, c.project.id, 'RESEARCH_REPORT') }), onResult: reviewArtifact('PRODUCT_REVIEW', 'Product critique') },
  'product.ceo_review': gateReview('PRODUCT', async (c) => ({ PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements'), 'Feature specification': await doc(c.s, c.project.id, 'PRD', 'Feature specification'), 'Product critique': await doc(c.s, c.project.id, 'PRODUCT_REVIEW') })),

  'design.spec': {
    kind: 'agent', prompt: 'design.spec', workspace: 'scratch',
    docs: async (c) => ({ PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements'), 'Research report': (await doc(c.s, c.project.id, 'RESEARCH_REPORT')).slice(0, 5000), 'Previous design': c.task.round > 1 ? await doc(c.s, c.project.id, 'DESIGN_DOC') : '' }),
    onResult: async (c, r, data) => { await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'DESIGN_DOC', title: 'Design specification', content: r.extracted.body, data, authorId: c.employee.id }); return { screens: Array.isArray(data.screens) ? data.screens.length : 0 }; },
  },
  'design.critique': { kind: 'agent', prompt: 'design.critique', workspace: 'scratch', docs: async (c) => ({ 'Design specification': await doc(c.s, c.project.id, 'DESIGN_DOC'), PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements') }), onResult: reviewArtifact('DESIGN_REVIEW', 'Design critique') },
  'design.ceo_review': gateReview('DESIGN', async (c) => ({ 'Design specification': await doc(c.s, c.project.id, 'DESIGN_DOC'), 'Design critique': await doc(c.s, c.project.id, 'DESIGN_REVIEW'), PRD: (await doc(c.s, c.project.id, 'PRD', 'Product requirements')).slice(0, 6000) })),

  'architecture.design': {
    kind: 'agent', prompt: 'architecture.design', workspace: 'scratch',
    docs: async (c) => ({ PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements'), 'Design specification': await doc(c.s, c.project.id, 'DESIGN_DOC'), 'Previous architecture': c.task.round > 1 ? await doc(c.s, c.project.id, 'ARCHITECTURE_DOC') : '' }),
    onResult: async (c, r, data) => {
      const wb = (data.workBreakdown ?? {}) as Record<string, unknown>;
      if (!wb.scaffold || !Array.isArray(wb.backend) || !Array.isArray(wb.frontend)) throw new Error('Architecture result is missing workBreakdown.scaffold/backend/frontend');
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'ARCHITECTURE_DOC', title: 'Architecture', content: r.extracted.body, data, authorId: c.employee.id });
      return { stack: data.stack ?? {} };
    },
  },
  'architecture.review': { kind: 'agent', prompt: 'architecture.review', workspace: 'scratch', docs: async (c) => ({ Architecture: await doc(c.s, c.project.id, 'ARCHITECTURE_DOC'), PRD: (await doc(c.s, c.project.id, 'PRD', 'Product requirements')).slice(0, 6000) }), onResult: reviewArtifact('ARCHITECTURE_REVIEW', 'Architecture review') },
  'architecture.cto_review': gateReview('ARCHITECTURE', async (c) => ({ Architecture: await doc(c.s, c.project.id, 'ARCHITECTURE_DOC'), 'Architecture review': await doc(c.s, c.project.id, 'ARCHITECTURE_REVIEW'), PRD: (await doc(c.s, c.project.id, 'PRD', 'Product requirements')).slice(0, 5000) })),

  ...Object.fromEntries(['engineering.scaffold', 'engineering.backend', 'engineering.frontend', 'engineering.fix', 'engineering.integrate'].map((stage) => [stage, {
    kind: 'agent', prompt: stage === 'engineering.backend' || stage === 'engineering.frontend' ? 'engineering.implement' : stage, workspace: 'worktree', fallbackOutput: 'files',
    docs: async (c: StageCtx) => ({ Architecture: await doc(c.s, c.project.id, 'ARCHITECTURE_DOC'), 'Design specification': await doc(c.s, c.project.id, 'DESIGN_DOC'), PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements') }),
    onResult: async (c: StageCtx, r: ExecuteResult, data: Record<string, unknown>) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'ENGINEERING_REPORT', title: `${c.task.code} ${c.task.title}`, content: r.extracted.body, data, authorId: c.employee.id });
      return { summary: asString(data.summary), filesChanged: asStringArray(data.filesChanged), testsRun: asString(data.testsRun) };
    },
  } satisfies AgentStage])),

  'engineering.code_review': {
    kind: 'agent', prompt: 'engineering.code_review', workspace: 'repo',
    docs: async (c) => ({ Architecture: await doc(c.s, c.project.id, 'ARCHITECTURE_DOC'), PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements') }),
    onResult: async (c, r, data) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'CODE_REVIEW', title: 'Code review', content: r.extracted.body, data, authorId: c.employee.id });
      const blocking = severe(data.issues);
      const approve = verdictOf(data) === 'APPROVE' && blocking.length === 0;
      const results: CheckResult[] = [
        { name: `Independent review by ${c.employee.name}`, status: approve ? 'PASS' : 'FAIL', details: asString(data.summary), durationMs: 0 },
        ...blocking.map((i) => ({ name: `[${String((i as Record<string, unknown>).severity)}] ${String((i as Record<string, unknown>).file ?? '')}`, status: 'FAIL' as const, details: `${String((i as Record<string, unknown>).issue)} — ${String((i as Record<string, unknown>).suggestion ?? '')}`, durationMs: 0 })),
      ];
      const rec = await c.s.checks.record(c.project.id, 'CODE_REVIEW', results, { taskId: c.task.id });
      return { status: rec.status, verdict: verdictOf(data), issues: data.issues ?? [], blocking: blocking.length };
    },
  },

  'system.integration_checks': {
    kind: 'system', run: async (c) => {
      const dir = c.project.workspacePath!;
      const results: CheckResult[] = [];
      results.push(await npmInstall(dir));
      if (results[0].status !== 'FAIL') {
        results.push(await npmScript(dir, 'build', false));
        results.push(await npmScript(dir, 'typecheck', false));
        results.push(await npmScript(dir, 'lint', false));
        results.push(await npmScript(dir, 'test', true));
      }
      const rec = await c.s.checks.record(c.project.id, 'INTEGRATION', results, { taskId: c.task.id });
      await c.s.bus.emit(rec.status === 'PASS' ? 'BUILD_PASSED' : 'BUILD_FAILED', `${c.project.code} develop build/tests ${rec.status}`, { projectId: c.project.id, taskId: c.task.id });
      return { status: rec.status, report: formatChecks(results) };
    },
  },

  'system.qa_suite': {
    kind: 'system', run: async (c) => {
      const dir = c.project.workspacePath!;
      const results: CheckResult[] = [await npmInstall(dir)];
      if (results[0].status !== 'FAIL') {
        results.push(await npmScript(dir, 'build', false));
        results.push(await npmScript(dir, 'test', true));
        const port = config.qaPortBase + projectNumber(c.project);
        const dataDir = path.join(config.workspacesDir, c.project.code, `qa-data-${Date.now()}`);
        try {
          const app = await startApp(dir, port, contractOf(c.project).healthPath, { NODE_ENV: 'test', DATA_DIR: dataDir });
          try { results.push({ name: 'App starts and answers health checks', status: 'PASS', details: `Started on ${app.baseUrl}`, durationMs: 0 }, ...(await httpSmoke(app.baseUrl, contractOf(c.project)))); }
          finally { await app.stop(); }
        } catch (e) { results.push({ name: 'App starts and answers health checks', status: 'FAIL', details: String((e as Error).message), durationMs: 0 }); }
        finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
      }
      const rec = await c.s.checks.record(c.project.id, 'QA_AUTOMATED', results, { taskId: c.task.id });
      return { status: rec.status, report: formatChecks(results) };
    },
  },

  'qa.report': {
    kind: 'agent', prompt: 'qa.report', workspace: 'qa-checkout',
    docs: async (c) => ({ PRD: await doc(c.s, c.project.id, 'PRD', 'Product requirements'), 'Design specification': (await doc(c.s, c.project.id, 'DESIGN_DOC')).slice(0, 4000) }),
    onResult: async (c, r, data) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'QA_REPORT', title: 'QA report', content: r.extracted.body, data, authorId: c.employee.id });
      const automated = await c.s.guard.latestSuite(c.project.id, 'QA_AUTOMATED');
      const blocking = severe(data.bugs);
      const results: CheckResult[] = [
        { name: 'Automated QA suite', status: automated?.status === 'PASS' ? 'PASS' : 'FAIL', details: automated?.details ?? 'not run', durationMs: 0 },
        { name: `QA lead verdict (${c.employee.name})`, status: verdictOf(data) === 'PASS' && blocking.length === 0 ? 'PASS' : 'FAIL', details: `${Array.isArray(data.bugs) ? data.bugs.length : 0} bug(s) reported, ${blocking.length} critical/high`, durationMs: 0 },
        ...blocking.map((b) => ({ name: `BUG [${String((b as Record<string, unknown>).severity)}] ${String((b as Record<string, unknown>).title)}`, status: 'FAIL' as const, details: `Steps: ${String((b as Record<string, unknown>).steps ?? '')}\nExpected: ${String((b as Record<string, unknown>).expected ?? '')}\nActual: ${String((b as Record<string, unknown>).actual ?? '')}`, durationMs: 0 })),
      ];
      const rec = await c.s.checks.record(c.project.id, 'QA', results, { taskId: c.task.id });
      return { status: rec.status, bugs: data.bugs ?? [], coverage: data.coverage ?? [] };
    },
  },

  'system.security_suite': {
    kind: 'system', run: async (c) => {
      const dir = c.project.workspacePath!;
      const results: CheckResult[] = [await secretScan(dir)];
      const audit = await dependencyAudit(dir);
      results.push(audit);
      const port = config.qaPortBase + projectNumber(c.project);
      const dataDir = path.join(config.workspacesDir, c.project.code, `sec-data-${Date.now()}`);
      try {
        const app = await startApp(dir, port, contractOf(c.project).healthPath, { NODE_ENV: 'production', DATA_DIR: dataDir });
        try { results.push(await securityHeaders(app.baseUrl)); } finally { await app.stop(); }
      } catch (e) { results.push({ name: 'Security headers', status: 'FAIL', details: `App failed to start: ${String((e as Error).message).slice(0, 800)}`, durationMs: 0 }); }
      finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
      const rec = await c.s.checks.record(c.project.id, 'SECURITY_AUTOMATED', results, { taskId: c.task.id });
      return { status: rec.status, report: formatChecks(results) };
    },
  },

  'security.review': {
    kind: 'agent', prompt: 'security.review', workspace: 'repo',
    docs: async (c) => ({ Architecture: (await doc(c.s, c.project.id, 'ARCHITECTURE_DOC')).slice(0, 6000) }),
    onResult: async (c, r, data) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'SECURITY_REPORT', title: 'Security report', content: r.extracted.body, data, authorId: c.employee.id });
      const automated = await c.s.guard.latestSuite(c.project.id, 'SECURITY_AUTOMATED');
      const blocking = severe(data.findings);
      const results: CheckResult[] = [
        { name: 'Automated security checks', status: automated?.status === 'PASS' ? 'PASS' : 'FAIL', details: automated?.details ?? 'not run', durationMs: 0 },
        { name: `AppSec review (${c.employee.name})`, status: verdictOf(data) === 'PASS' && blocking.length === 0 ? 'PASS' : 'FAIL', details: `${Array.isArray(data.findings) ? data.findings.length : 0} finding(s), ${blocking.length} critical/high`, durationMs: 0 },
        ...blocking.map((f) => ({ name: `FINDING [${String((f as Record<string, unknown>).severity)}] ${String((f as Record<string, unknown>).title)}`, status: 'FAIL' as const, details: `${String((f as Record<string, unknown>).file ?? '')}: ${String((f as Record<string, unknown>).recommendation ?? '')}`, durationMs: 0 })),
      ];
      const rec = await c.s.checks.record(c.project.id, 'SECURITY', results, { taskId: c.task.id });
      return { status: rec.status, findings: data.findings ?? [] };
    },
  },

  'system.performance': {
    kind: 'system', run: async (c) => {
      const dir = c.project.workspacePath!;
      const port = config.qaPortBase + projectNumber(c.project);
      const dataDir = path.join(config.workspacesDir, c.project.code, `perf-data-${Date.now()}`);
      let results: CheckResult[];
      try {
        const app = await startApp(dir, port, contractOf(c.project).healthPath, { NODE_ENV: 'production', DATA_DIR: dataDir });
        try { results = [await performance(app.baseUrl, contractOf(c.project))]; } finally { await app.stop(); }
      } catch (e) { results = [{ name: 'Response time p95', status: 'FAIL', details: String((e as Error).message).slice(0, 800), durationMs: 0 }]; }
      finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
      const rec = await c.s.checks.record(c.project.id, 'PERFORMANCE', results, { taskId: c.task.id });
      return { status: rec.status, report: formatChecks(results) };
    },
  },

  'system.release_candidate': {
    kind: 'system', run: async (c) => {
      const log = (await c.s.git.log(c.project.workspacePath!, 40)).map((l) => `- ${l.subject} (${l.author})`).join('\n');
      const rel = await withGitLock(c.project.id, () => c.s.deploy.createRelease(c.project, `Release candidate for ${c.project.name}\n\n${log}`));
      return { status: 'PASS', releaseId: rel.id, version: rel.version, commit: rel.commit };
    },
  },

  'system.deploy_staging': {
    kind: 'system', run: async (c) => {
      const rel = await c.s.deploy.latestRelease(c.project.id);
      if (!rel) throw new Error('No release candidate');
      const dep = await c.s.deploy.deploy(c.project, rel, 'STAGING');
      await c.s.deploy.setReleaseStatus(rel.id, dep.status === 'RUNNING' ? 'STAGING' : 'STAGING_FAILED', ['staging_deploy', dep.status === 'RUNNING' ? 'PASS' : 'FAIL']);
      if (dep.url) await c.s.projects.update(c.project.id, { stagingUrl: dep.url });
      return { status: dep.status === 'RUNNING' ? 'PASS' : 'FAIL', deploymentId: dep.id, url: dep.url, report: tail(dep.log, 4000) };
    },
  },

  'system.staging_validation': {
    kind: 'system', run: async (c) => {
      const rel = await c.s.deploy.latestRelease(c.project.id);
      const dep = await c.s.deploy.active(c.project.id, 'STAGING');
      if (!rel || !dep?.url) throw new Error('No active staging deployment');
      const results = [...(await httpSmoke(dep.url, contractOf(c.project))), await securityHeaders(dep.url)];
      const rec = await c.s.checks.record(c.project.id, 'STAGING', results, { taskId: c.task.id, releaseId: rel.id });
      await c.s.deploy.markHealth(dep.id, rec.status === 'PASS');
      await c.s.deploy.setReleaseStatus(rel.id, rec.status === 'PASS' ? 'STAGING_PASSED' : 'STAGING_FAILED', ['staging_validation', rec.status]);
      return { status: rec.status, report: formatChecks(results) };
    },
  },

  'devops.release_board': {
    kind: 'agent', prompt: 'devops.release_board', workspace: 'scratch', docs: async (c) => ({ PRD: (await doc(c.s, c.project.id, 'PRD', 'Product requirements')).slice(0, 4000) }),
    onResult: async (c, r, data) => {
      const rel = await c.s.deploy.latestRelease(c.project.id);
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'RELEASE_NOTES', title: `Release ${rel?.version ?? ''} board`, content: r.extracted.body, data, authorId: c.employee.id });
      if (rel) await c.s.deploy.setReleaseStatus(rel.id, rel.status, ['release_board', verdictOf(data) === 'GO' ? 'GO' : 'NO_GO']);
      return { verdict: verdictOf(data) === 'GO' ? 'GO' : 'NO_GO', risks: data.risks ?? [], rollbackPlan: asString(data.rollbackPlan) };
    },
  },
  'executive.release_review': gateReview('RELEASE', async (c) => ({ 'Release board minutes': await doc(c.s, c.project.id, 'RELEASE_NOTES'), Evidence: String(c.task.input.evidence ?? '') })),

  'system.deploy_production': {
    kind: 'system', run: async (c) => {
      const rel = await c.s.deploy.latestRelease(c.project.id);
      if (!rel) throw new Error('No release');
      await c.s.deploy.setReleaseStatus(rel.id, 'DEPLOYING');
      const dep = await c.s.deploy.deploy(c.project, rel, 'PRODUCTION');
      if (dep.status !== 'RUNNING') await c.s.deploy.setReleaseStatus(rel.id, 'FAILED', ['production_deploy', 'FAIL']);
      else await c.s.deploy.setReleaseStatus(rel.id, 'DEPLOYING', ['production_deploy', 'PASS']);
      return { status: dep.status === 'RUNNING' ? 'PASS' : 'FAIL', deploymentId: dep.id, url: dep.url, report: tail(dep.log, 4000) };
    },
  },

  'system.production_validation': {
    kind: 'system', run: async (c) => {
      const rel = await c.s.deploy.latestRelease(c.project.id);
      const dep = await c.s.deploy.active(c.project.id, 'PRODUCTION');
      if (!rel || !dep?.url) throw new Error('No active production deployment');
      const results = [...(await httpSmoke(dep.url, contractOf(c.project))), await securityHeaders(dep.url)];
      const rec = await c.s.checks.record(c.project.id, 'PRODUCTION', results, { taskId: c.task.id, releaseId: rel.id });
      await c.s.deploy.markHealth(dep.id, rec.status === 'PASS');
      if (rec.status === 'PASS') {
        await c.s.deploy.setReleaseStatus(rel.id, 'HEALTHY', ['production_health', 'PASS']);
        await c.s.projects.update(c.project.id, { productionUrl: dep.url });
        return { status: 'PASS', report: formatChecks(results) };
      }
      // Provider "success" is not success: mark degraded, roll back where possible, open an incident. No redeploy loop.
      await c.s.deploy.setReleaseStatus(rel.id, 'DEGRADED', ['production_health', 'FAIL']);
      const rolled = await c.s.deploy.rollback(c.project, dep);
      await c.s.deploy.setReleaseStatus(rel.id, rolled ? 'ROLLED_BACK' : 'FAILED');
      await c.s.incidents.open({ projectId: c.project.id, severity: 'SEV2', title: `Release ${rel.version} failed production validation`, description: `${rec.failed.map((f) => `${f.name}: ${f.details}`).join('\n').slice(0, 2000)}\n\nRollback: ${rolled ? `restored previous release (${rolled.status})` : 'no previous healthy release; production stopped'}` });
      return { status: 'FAIL', report: formatChecks(results), rolledBack: !!rolled };
    },
  },

  'executive.completion_report': {
    kind: 'agent', prompt: 'executive.completion_report', workspace: 'scratch', docs: async (c) => ({ PRD: (await doc(c.s, c.project.id, 'PRD', 'Product requirements')).slice(0, 5000) }),
    onResult: async (c, r, data) => {
      await c.s.artifacts.save({ projectId: c.project.id, taskId: c.task.id, kind: 'COMPLETION_REPORT', title: 'Completion report', content: r.extracted.body, data, authorId: c.employee.id });
      await c.s.memory.remember({ scope: 'COMPANY', projectId: c.project.id, kind: 'LESSON', content: `${c.project.name} completed. Known issues: ${asStringArray(data.knownIssues).join('; ') || 'none'}. Recommendations: ${asStringArray(data.recommendations).join('; ')}` });
      return { summary: asString(data.summary) };
    },
  },
};

// ───────── runner ─────────

export class StageRunner {
  constructor(private s: Services) {}

  private async ctx(task: Task): Promise<StageCtx> {
    const project = task.projectId ? await this.s.projects.get(task.projectId) : undefined;
    const employee = task.assigneeId ? await this.s.org.employee(task.assigneeId) : undefined;
    const role = await this.s.org.role(task.roleKey);
    if (!project || !employee || !role) throw new Error(`Task ${task.code} is missing project/assignee/role`);
    return { s: this.s, task, project, employee, role };
  }

  /** Executes one task end-to-end. Never throws: outcomes are written to the task row. */
  async run(taskId: string): Promise<void> {
    let task = await this.s.tasks.get(taskId);
    if (!task) return;
    const def = STAGES[task.stage];
    if (!def) { await this.s.tasks.fail(taskId, `Unknown stage ${task.stage}`); return; }
    try {
      task = await this.s.tasks.start(taskId);
      const c = await this.ctx(task);
      if (def.kind === 'system') {
        await this.s.tasks.update(task.id, { runtime: 'SYSTEM', steps: task.steps.map((st) => (st.key === 'context' ? { ...st, status: 'DONE' } : st.key === 'working' ? { ...st, status: 'ACTIVE' } : st)) });
        await this.s.org.setStatus(c.employee.id, 'WORKING', task.title, task.id);
        const result = await def.run(c);
        await this.s.tasks.complete(task.id, result);
        return;
      }
      await this.runAgent(def, c);
    } catch (e) {
      const t = await this.s.tasks.get(taskId);
      if (e instanceof RuntimeBlockedError) { await this.s.tasks.fail(taskId, `RUNTIME: ${e.message}`, { block: true }); return; }
      if (e instanceof GateLockedError) { await this.s.tasks.fail(taskId, `GATE: ${e.message}`, { block: true }); return; }
      await this.s.tasks.fail(taskId, String((e as Error).message ?? e).slice(0, 2000));
      if (t?.assigneeId) await this.s.messages.send({ projectId: t.projectId, fromEmployeeId: t.assigneeId, toEmployeeId: null, type: 'BLOCKER', subject: `${t.code} failed`, body: String((e as Error).message).slice(0, 2000), taskId: t.id });
    }
  }

  private async prepareRoot(c: StageCtx, ws: Workspace): Promise<{ root: string; cleanup?: () => Promise<void> }> {
    const base = path.join(config.workspacesDir, c.project.code);
    const repo = c.project.workspacePath!;
    if (ws !== 'scratch') ensureGitExclude(repo, `${CONTEXT_DIR}/`);
    if (ws === 'scratch') return { root: path.join(base, 'scratch', c.task.code) };
    if (ws === 'repo') return { root: repo };
    if (ws === 'qa-checkout') {
      const dir = path.join(base, 'qa', c.task.code);
      await withGitLock(c.project.id, () => this.s.git.addDetachedWorktree(repo, dir, 'develop'));
      return { root: dir, cleanup: () => withGitLock(c.project.id, () => this.s.git.removeWorktree(repo, dir)) };
    }
    const branch = `agent/${c.task.code}`;
    const dir = path.join(base, 'worktrees', c.task.code);
    await withGitLock(c.project.id, () => this.s.git.addWorktree(repo, dir, branch, 'develop'));
    if (c.task.stage === 'engineering.integrate' && c.task.input.branch && !c.task.input.mergeStarted) {
      const conflicts = await this.s.git.startConflictedMerge(dir, String(c.task.input.branch));
      await this.s.tasks.update(c.task.id, { input: { ...c.task.input, mergeStarted: true, conflicts } });
      c.task = { ...c.task, input: { ...c.task.input, mergeStarted: true, conflicts } };
    }
    await this.s.tasks.update(c.task.id, { branch });
    return { root: dir };
  }

  private async runAgent(def: AgentStage, c: StageCtx): Promise<void> {
    const { s, task, project, employee, role } = c;
    const { root, cleanup } = await this.prepareRoot(c, def.workspace);
    try {
      const companyRow = (await s.db.query.company.findFirst()) ?? { name: 'AI Startup Company' };
      const memories = (await s.memory.retrieve(`${task.title} ${project.objective}`, { projectId: project.id })).map((m) => `[${m.kind}] ${m.content}`);
      const docs = await def.docs(c);
      const ctxDir = path.join(root, CONTEXT_DIR);
      fs.rmSync(ctxDir, { recursive: true, force: true });
      const nonEmpty = Object.entries(docs).filter(([, v]) => v);
      if (nonEmpty.length) {
        fs.mkdirSync(ctxDir, { recursive: true });
        for (const [label, content] of nonEmpty) fs.writeFileSync(path.join(ctxDir, contextFileName(label)), content);
      }
      const pctx: PromptContext = {
        companyName: companyRow.name, project, employeeName: employee.name, roleTitle: role.title, taskCode: task.code, round: task.round,
        input: task.input, docs, memories,
      };
      const prompt = PROMPTS[def.prompt](pctx);
      await s.tasks.update(task.id, { steps: task.steps.map((st) => (st.key === 'context' ? { ...st, status: 'DONE' } : st.key === 'working' ? { ...st, status: 'ACTIVE' } : st)) });
      const res = await s.executor.execute({
        task, employee, role, prompt, root, label: task.title, expectJson: true, fallbackOutput: def.fallbackOutput,
        allowFallback: task.input.allowFallback === true,
      });
      const cur = (await s.tasks.get(task.id))!;
      await s.tasks.update(task.id, {
        runtime: res.runtime, costCredits: cur.costCredits + res.credits, costUsd: cur.costUsd + res.costUsd,
        steps: cur.steps.map((st) => (st.key === 'working' ? { ...st, status: 'DONE' } : st.key === 'validated' ? { ...st, status: 'ACTIVE' } : st)),
      });
      if (!res.extracted.data) throw new Error(`Agent output did not contain the required structured result (${res.extracted.error ?? 'unparseable'})`);
      const result = await def.onResult(c, res, res.extracted.data as Record<string, unknown>);
      if (def.workspace === 'worktree') Object.assign(result, await this.commitAndMerge(c, root));
      await s.tasks.complete(task.id, { ...result, runtime: res.runtime, provider: res.provider, runId: res.runId });
    } finally {
      fs.rmSync(path.join(root, CONTEXT_DIR), { recursive: true, force: true });
      if (cleanup) await cleanup().catch(() => undefined);
    }
  }

  /** Commits the agent's work with attribution and merges its branch into develop (never main). */
  private async commitAndMerge(c: StageCtx, worktree: string): Promise<Record<string, unknown>> {
    const { s, task, project, employee } = c;
    const repo = project.workspacePath!;
    const branch = `agent/${task.code}`;
    const msg = `${task.stage === 'engineering.fix' ? 'fix' : task.stage === 'engineering.integrate' ? 'merge' : 'feat'}(${task.code}): ${task.title}`;
    const commit = await s.git.commitAll(worktree, msg, authorFor(employee));
    if (!commit && task.stage !== 'engineering.fix') throw new Error('The agent reported completion but made no changes in its workspace');
    if (commit) await s.bus.emit('GIT_COMMIT', `${employee.name} committed ${commit.slice(0, 8)} on ${branch}: ${msg}`, { projectId: project.id, taskId: task.id, employeeId: employee.id });
    await s.audit.log({ type: 'AGENT', id: employee.id, name: employee.name }, 'git.commit', `${project.code}/${branch}`, { commit, message: msg });
    const merged = await withGitLock(project.id, async () => {
      const m = await s.git.merge(repo, branch, `Merge ${branch} into develop (${task.code})`);
      if (m.ok) await s.git.removeWorktree(repo, worktree);
      return m;
    });
    if (merged.ok) {
      await s.bus.emit('GIT_MERGE', `${branch} merged into develop (${merged.commit.slice(0, 8)})`, { projectId: project.id, taskId: task.id });
      return { commit, merged: true, mergeCommit: merged.commit };
    }
    return { commit, merged: false, conflicts: merged.conflicts, mergeError: merged.error };
  }
}
