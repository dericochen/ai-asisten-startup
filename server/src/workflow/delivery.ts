import type { Phase } from '../db/schema.js';
import type { Project } from '../services/projects.js';
import type { Task } from '../services/tasks.js';
import { EngineCore, isTerminal, type NewTask } from './core.js';
import { asString } from '../lib/extract.js';

const ENG_STAGES = ['engineering.scaffold', 'engineering.backend', 'engineering.frontend', 'engineering.integrate', 'engineering.fix'];
const live = (t: Task) => !t.result?.retriedBy && t.status !== 'CANCELLED';
const cycleOf = (p: Project) => p.counters.cycle ?? 0;

async function cycleTask(e: EngineCore, p: Project, stage: string): Promise<Task | undefined> {
  const c = cycleOf(p);
  return (await e.all(p, stage)).find((t) => (t.input.cycle ?? 0) === c && live(t));
}

async function engineeringAuthors(e: EngineCore, p: Project): Promise<string[]> {
  const ids = new Set<string>();
  for (const st of ENG_STAGES) for (const t of await e.all(p, st)) if (t.assigneeId) ids.add(t.assigneeId);
  return [...ids];
}

/** One system/agent check task per delivery cycle; PASS advances, FAIL enters the bounded fix loop. */
async function suitePhase(e: EngineCore, p: Project, o: { stage: string; role: string; title: string; phase: Phase; next: Phase; source: string; suite?: string; input?: () => Promise<Record<string, unknown>>; exclude?: string[]; nextReason: string }): Promise<Task | null> {
  const t = await cycleTask(e, p, o.stage);
  const spec = async (): Promise<NewTask> => ({ stage: o.stage, phase: o.phase, roleKey: o.role, title: o.title, input: { cycle: cycleOf(p), ...(o.input ? await o.input() : {}) }, exclude: o.exclude });
  if (!t) { await e.create(p, await spec()); return null; }
  if (t.status === 'FAILED') { const s = await spec(); await e.handleFailed(p, t, () => s); return null; }
  if (!isTerminal(t)) return null;
  if (t.result?.status === 'PASS' || t.result?.ownerAccepted) { await e.enter(p, o.next, o.nextReason); return t; }
  await e.fixLoop(p, t, o.source, asString(t.result?.report ?? t.result?.issues ?? t.result?.findings ?? t.result?.bugs ?? 'See checks'), o.phase, o.suite);
  return null;
}

export async function deliveryPhase(e: EngineCore, p: Project): Promise<boolean> {
  const s = e.s;
  switch (p.phase) {
    case 'DEVELOPMENT': {
      const arch = await s.artifacts.latest(p.id, 'ARCHITECTURE_DOC');
      const wb = ((arch?.data ?? {}) as Record<string, unknown>).workBreakdown as { scaffold: { title: string; description: string }; backend: { title: string; description: string; files?: string[] }[]; frontend: { title: string; description: string; files?: string[] }[] } | undefined;
      if (!wb) { await e.escalate(p, 'Architecture has no work breakdown', 'The approved architecture artifact lacks workBreakdown; engineering cannot be planned.', { stage: 'engineering.plan' }); return true; }
      const scaffoldSpec = (): NewTask => ({ stage: 'engineering.scaffold', phase: 'DEVELOPMENT', roleKey: 'backend-lead', title: wb.scaffold.title || 'Repository scaffold', input: { title: wb.scaffold.title, description: wb.scaffold.description } });
      const scaffold = (await e.all(p, 'engineering.scaffold')).find(live);
      if (!scaffold) { await e.create(p, scaffoldSpec()); return true; }
      if (scaffold.status === 'FAILED') { await e.handleFailed(p, scaffold, scaffoldSpec); return true; }
      if (!isTerminal(scaffold)) return true;
      const features = [...(await e.all(p, 'engineering.backend')), ...(await e.all(p, 'engineering.frontend'))];
      if (!features.length) {
        const assigned: string[] = [];
        for (const [area, items] of [['backend', wb.backend.slice(0, 2)], ['frontend', wb.frontend.slice(0, 2)]] as const) {
          for (const [i, item] of items.entries()) {
            const t = await e.create(p, { stage: `engineering.${area}`, phase: 'DEVELOPMENT', roleKey: `${area}-engineer`, title: item.title, input: { area, title: item.title, description: item.description, files: item.files ?? [], wbsIndex: i }, exclude: assigned });
            if (t.assigneeId) assigned.push(t.assigneeId);
          }
        }
        await s.bus.emit('SYSTEM', `Engineering started: ${wb.backend.length} backend + ${wb.frontend.length} frontend work items in parallel worktrees`, { projectId: p.id });
        return true;
      }
      for (const st of ENG_STAGES.filter((x) => x !== 'engineering.fix')) {
        for (const t of (await e.all(p, st)).filter(live)) {
          if (t.status === 'FAILED') {
            await e.handleFailed(p, t, () => ({ stage: t.stage, phase: 'DEVELOPMENT', roleKey: t.roleKey, title: t.title, input: { ...t.input, mergeStarted: false } }));
            return true;
          }
          if (!isTerminal(t)) return true;
          if (t.status === 'DONE' && t.result?.merged === false) {
            if (!t.result?.integrateTaskId) { await e.conflict(p, t); return true; }
            const it = await s.tasks.get(String(t.result.integrateTaskId));
            if (!isTerminal(it)) return true;
          }
        }
      }
      await e.enter(p, 'INTEGRATION', 'All engineering work items merged into develop');
      return true;
    }

    case 'INTEGRATION':
      await suitePhase(e, p, { stage: 'system.integration_checks', role: 'cicd-engineer', title: 'Build & test develop branch', phase: 'INTEGRATION', next: 'CODE_REVIEW', source: 'Integration build/tests', suite: 'INTEGRATION', nextReason: 'develop builds and all tests pass — independent code review requested' });
      return true;

    case 'CODE_REVIEW':
      await suitePhase(e, p, {
        stage: 'engineering.code_review', role: 'code-reviewer', title: 'Independent code review (develop vs main)', phase: 'CODE_REVIEW', next: 'QA', source: 'Code review', suite: 'CODE_REVIEW',
        exclude: await engineeringAuthors(e, p), nextReason: 'Code review approved — QA started',
        input: async () => { const d = await s.git.diff(p.workspacePath!, 'main', 'develop'); return { diffStat: d.stat, diff: d.patch, truncated: d.truncated }; },
      });
      return true;

    case 'QA': {
      const sys = await cycleTask(e, p, 'system.qa_suite');
      if (!sys || sys.status !== 'DONE') {
        if (!sys) await e.create(p, { stage: 'system.qa_suite', phase: 'QA', roleKey: 'functional-qa', title: 'Automated QA suite (build, tests, app, HTTP & API checks)', input: { cycle: cycleOf(p) } });
        else if (sys.status === 'FAILED') await e.handleFailed(p, sys, () => ({ stage: 'system.qa_suite', phase: 'QA', roleKey: 'functional-qa', title: sys.title, input: { cycle: cycleOf(p) } }));
        return true;
      }
      await suitePhase(e, p, { stage: 'qa.report', role: 'qa-lead', title: 'QA report against acceptance criteria', phase: 'QA', next: 'SECURITY', source: 'QA', suite: 'QA', exclude: await engineeringAuthors(e, p), input: async () => ({ automated: sys.result?.report }), nextReason: 'QA passed — Security review started' });
      return true;
    }

    case 'SECURITY': {
      const sys = await cycleTask(e, p, 'system.security_suite');
      if (!sys || sys.status !== 'DONE') {
        if (!sys) await e.create(p, { stage: 'system.security_suite', phase: 'SECURITY', roleKey: 'dependency-auditor', title: 'Automated security checks (secrets, dependencies, headers)', input: { cycle: cycleOf(p) } });
        else if (sys.status === 'FAILED') await e.handleFailed(p, sys, () => ({ stage: 'system.security_suite', phase: 'SECURITY', roleKey: 'dependency-auditor', title: sys.title, input: { cycle: cycleOf(p) } }));
        return true;
      }
      await suitePhase(e, p, { stage: 'security.review', role: 'appsec-engineer', title: 'Application security review', phase: 'SECURITY', next: 'PERFORMANCE_TEST', source: 'Security review', suite: 'SECURITY', exclude: await engineeringAuthors(e, p), input: async () => ({ automated: sys.result?.report }), nextReason: 'Security passed — performance test started' });
      return true;
    }

    case 'PERFORMANCE_TEST':
      await suitePhase(e, p, { stage: 'system.performance', role: 'performance-qa', title: 'Response time test', phase: 'PERFORMANCE_TEST', next: 'DEPLOYMENT_PREPARATION', source: 'Performance test', suite: 'PERFORMANCE', nextReason: 'Performance acceptable — release candidate preparation' });
      return true;

    case 'DEPLOYMENT_PREPARATION':
      await suitePhase(e, p, { stage: 'system.release_candidate', role: 'release-manager', title: 'Create release candidate (merge develop → main, tag)', phase: 'DEPLOYMENT_PREPARATION', next: 'STAGING', source: 'Release candidate', nextReason: 'Release candidate tagged — deploying to staging' });
      return true;

    case 'STAGING':
      await suitePhase(e, p, { stage: 'system.deploy_staging', role: 'cloud-engineer', title: 'Deploy release to staging', phase: 'STAGING', next: 'STAGING_VALIDATION', source: 'Staging deployment', nextReason: 'Staging deployed — validating staging' });
      return true;

    case 'STAGING_VALIDATION':
      await suitePhase(e, p, { stage: 'system.staging_validation', role: 'browser-qa', title: 'Validate staging (health, pages, assets, API, headers)', phase: 'STAGING_VALIDATION', next: 'RELEASE_REVIEW', source: 'Staging validation', suite: 'STAGING', nextReason: 'Staging validated — release board convened' });
      return true;

    case 'RELEASE_REVIEW': {
      const evidence = async () => releaseEvidence(e, p);
      const rel = await s.deploy.latestRelease(p.id);
      const boardSpec = async (round = 1, feedback?: unknown): Promise<NewTask> => ({ stage: 'devops.release_board', phase: 'RELEASE_REVIEW', roleKey: 'release-manager', title: `Release board: v${rel?.version}`, input: { cycle: cycleOf(p), version: rel?.version, commit: rel?.commit, evidence: await evidence(), feedback }, round });
      const board = await cycleTask(e, p, 'devops.release_board');
      if (!board) { await e.create(p, await boardSpec()); return true; }
      if (board.status === 'FAILED') { const sp = await boardSpec(board.round); await e.handleFailed(p, board, () => sp); return true; }
      if (!isTerminal(board)) return true;
      if (board.result?.verdict !== 'GO') { await e.fixLoop(p, board, 'Release board (NO-GO)', `Risks: ${asString(board.result?.risks)}`, 'RELEASE_REVIEW'); return true; }
      const ev = await evidence();
      const g = await e.gateStep(p, { gate: 'RELEASE', authorStage: 'devops.release_board', reviewStage: 'executive.release_review', phase: 'RELEASE_REVIEW', evidence: async () => ev, reviseAuthor: (a, fb, r) => ({ stage: 'devops.release_board', phase: 'RELEASE_REVIEW', roleKey: 'release-manager', assigneeId: a.assigneeId, title: `Release board: v${rel?.version} (revision ${r})`, input: { ...a.input, feedback: fb }, round: r }) });
      if (g === 'approved') await e.enter(p, 'OWNER_APPROVAL', 'Release board GO and CEO approved the release');
      return true;
    }

    case 'OWNER_APPROVAL': {
      const mode = s.policies().deploymentMode;
      const rel = await s.deploy.latestRelease(p.id);
      if (!rel) return true;
      if (mode === 'CEO_APPROVAL' || mode === 'AUTO_AFTER_CHECKS') { await e.enter(p, 'PRODUCTION_DEPLOYMENT', `Deployment policy ${mode}: CEO approval and all checks satisfied`); return true; }
      const relAppr = await s.approvals.latest(p.id, 'RELEASE');
      if (mode === 'OWNER_APPROVAL' && s.policies().gateApprover === 'OWNER' && relAppr?.status === 'APPROVED' && relAppr.decidedBy === 'OWNER') {
        await e.enter(p, 'PRODUCTION_DEPLOYMENT', `Owner approved release ${relAppr.code}, which authorises production deployment`);
        return true;
      }
      const appr = await s.approvals.latest(p.id, 'PRODUCTION_DEPLOY');
      if (!appr || appr.createdAt < rel.createdAt) {
        await s.approvals.request({
          projectId: p.id, gate: 'PRODUCTION_DEPLOY', title: `${mode === 'MANUAL' ? 'Manual production deploy' : 'Deploy to production'}: ${p.name} v${rel.version}`,
          reason: `All mandatory gates passed. Deployment policy is ${mode}: the Owner must ${mode === 'MANUAL' ? 'trigger' : 'approve'} production deployment.`,
          evidence: [{ label: `Staging ${p.stagingUrl ?? ''}`, kind: 'url', ref: p.stagingUrl ?? undefined }, { label: 'Release gates', kind: 'text', ref: JSON.stringify(rel.gates) }],
          impact: `Production at http://localhost:${p.deployment.productionPort} will serve v${rel.version}.`, risks: 'Production health is verified after deploy; failure triggers rollback and an incident.',
          recommendation: 'Approve — release board GO and CEO approved.', payload: { releaseId: rel.id },
        });
        return true;
      }
      if (appr.status === 'APPROVED') await e.enter(p, 'PRODUCTION_DEPLOYMENT', 'Owner approved production deployment');
      else if (appr.status === 'REJECTED') await s.projects.setStatus(p.id, 'PAUSED', `Owner rejected production deployment: ${appr.decisionNote ?? ''}`, { type: 'SYSTEM', name: 'WorkflowEngine' });
      else if (appr.status === 'REVISION_REQUESTED') { const board = await cycleTask(e, p, 'devops.release_board'); if (board) await e.fixLoop(p, board, 'Owner revision request', appr.decisionNote ?? '', 'OWNER_APPROVAL'); }
      return true;
    }

    case 'PRODUCTION_DEPLOYMENT': {
      const t = await cycleTask(e, p, 'system.deploy_production');
      if (!t) { await e.create(p, { stage: 'system.deploy_production', phase: 'PRODUCTION_DEPLOYMENT', roleKey: 'release-manager', title: 'Deploy release to production', input: { cycle: cycleOf(p) } }); return true; }
      if (!isTerminal(t)) return true;
      if (t.status === 'DONE' && t.result?.status === 'PASS') { await e.enter(p, 'PRODUCTION_VALIDATION', 'Production deployment finished — verifying the real application'); return true; }
      await productionFailure(e, p, 'Production deployment failed', asString(t.result?.report ?? t.blockedReason));
      return true;
    }

    case 'PRODUCTION_VALIDATION': {
      const t = await cycleTask(e, p, 'system.production_validation');
      if (!t) { await e.create(p, { stage: 'system.production_validation', phase: 'PRODUCTION_VALIDATION', roleKey: 'sre', title: 'Production health & smoke tests', input: { cycle: cycleOf(p) } }); return true; }
      if (!isTerminal(t)) return true;
      if (t.status === 'DONE' && t.result?.status === 'PASS') { await e.enter(p, 'MONITORING', 'Production verified healthy — monitoring'); return true; }
      await productionFailure(e, p, 'Production validation failed', asString(t.result?.report ?? t.blockedReason));
      return true;
    }

    case 'MONITORING': {
      const prod = await s.deploy.active(p.id, 'PRODUCTION');
      if (!prod?.url) { await productionFailure(e, p, 'No active production deployment during monitoring', ''); return true; }
      const samples = await s.monitoring.recent(p.id, 20);
      const enteredAt = (await s.db.query.events.findFirst({ where: (ev, { and, eq }) => and(eq(ev.projectId, p.id), eq(ev.type, 'PROJECT_PHASE_CHANGED')), orderBy: (ev, { desc }) => [desc(ev.id)] }))?.createdAt ?? new Date(0);
      const since = samples.filter((x) => x.environment === 'PRODUCTION' && x.createdAt >= enteredAt);
      const need = s.policies().monitoring.samplesBeforeComplete;
      let streak = 0;
      for (const x of since) { if (x.ok) streak++; else break; }
      if (streak < need) return true; // samples are taken by the monitoring loop
      const report = await e.latest(p, 'executive.completion_report');
      if (!report || report.result?.retriedBy) {
        await e.create(p, { stage: 'executive.completion_report', phase: 'MONITORING', roleKey: 'ceo', title: 'CEO completion report', input: { evidence: await releaseEvidence(e, p) + `\nProduction monitoring: ${streak} consecutive healthy probes of ${prod.url}${p.deployment.healthPath}.` } });
        return true;
      }
      if (report.status === 'FAILED') { await e.handleFailed(p, report, () => ({ stage: 'executive.completion_report', phase: 'MONITORING', roleKey: 'ceo', title: report.title, input: report.input })); return true; }
      if (!isTerminal(report)) return true;
      await e.enter(p, 'COMPLETED', 'Production healthy, completion report delivered');
      await s.projects.setStatus(p.id, 'COMPLETED', 'All completion criteria met', { type: 'SYSTEM', name: 'WorkflowEngine' });
      await s.notify.notifyOwner({ projectId: p.id, category: 'COMPLETION', title: `${p.name} is complete and healthy in production`, body: `Production: ${prod.url}` });
      return true;
    }
    default:
      return false;
  }
}

async function productionFailure(e: EngineCore, p: Project, title: string, details: string): Promise<void> {
  const s = e.s;
  await s.projects.setStatus(p.id, 'BLOCKED', title, { type: 'SYSTEM', name: 'WorkflowEngine' });
  const open = await s.incidents.openFor(p.id);
  if (!open.length) await s.incidents.open({ projectId: p.id, severity: 'SEV2', title: `${title} — ${p.name}`, description: details.slice(0, 3000) });
  for (const role of ['cto', 'ceo', 'sre']) {
    const emp = await s.org.firstOfRole(role);
    await s.messages.send({ projectId: p.id, fromEmployeeId: null, toEmployeeId: emp?.id ?? null, type: 'INCIDENT', subject: title, body: details.slice(0, 2000) });
  }
}

/** Compact, factual evidence pack from DB records (check summaries, artifacts, release). */
export async function releaseEvidence(e: EngineCore, p: Project): Promise<string> {
  const s = e.s;
  const lines: string[] = [];
  for (const suite of ['INTEGRATION', 'CODE_REVIEW', 'QA_AUTOMATED', 'QA', 'SECURITY_AUTOMATED', 'SECURITY', 'PERFORMANCE', 'STAGING', 'PRODUCTION']) {
    const c = await s.guard.latestSuite(p.id, suite);
    if (c) lines.push(`- ${suite}: ${c.status} (${c.details})`);
  }
  const rel = await s.deploy.latestRelease(p.id);
  if (rel) lines.push(`- Release v${rel.version} @ ${rel.commit.slice(0, 10)} status ${rel.status}; gates ${JSON.stringify(rel.gates)}`);
  if (p.stagingUrl) lines.push(`- Staging URL: ${p.stagingUrl}`);
  const prod = await s.deploy.active(p.id, 'PRODUCTION');
  if (prod?.url) lines.push(`- Production URL: ${prod.url} (${prod.status})`);
  for (const kind of ['CODE_REVIEW', 'QA_REPORT', 'SECURITY_REPORT'] as const) {
    const a = await s.artifacts.latest(p.id, kind);
    if (a) lines.push(`\n### ${a.title}\n${a.content.slice(0, 2500)}`);
  }
  return lines.join('\n');
}
