import type { Project } from '../services/projects.js';
import type { Task } from '../services/tasks.js';
import { EngineCore, isTerminal, type NewTask } from './core.js';
import { asString } from '../lib/extract.js';

const TRACKS: { track: string; role: string }[] = [
  { track: 'user', role: 'user-researcher' }, { track: 'market', role: 'market-researcher' }, { track: 'competitor', role: 'competitor-researcher' },
  { track: 'technical', role: 'technical-researcher' }, { track: 'data', role: 'data-researcher' },
];

/** Shared critic loop: author → critic (independent) → bounded revisions. Returns true when the deliverable passed critique. */
async function critiqueLoop(e: EngineCore, p: Project, o: { authorStage: string; criticStage: string; criticRole: string; counter: string; author: (round: number, feedback?: unknown) => NewTask; criticTitle: string }): Promise<boolean> {
  const author = await e.latest(p, o.authorStage);
  if (!author) { await e.create(p, o.author(1)); return false; }
  if (author.status === 'FAILED') { await e.handleFailed(p, author, () => o.author(author.round, author.input.feedback)); return false; }
  if (!isTerminal(author)) return false;
  const critic = (await e.all(p, o.criticStage)).find((c) => c.input.authorTaskId === author.id && c.status !== 'FAILED');
  if (!critic) {
    const failedCritic = (await e.all(p, o.criticStage)).find((c) => c.input.authorTaskId === author.id && c.status === 'FAILED');
    if (failedCritic) { await e.handleFailed(p, failedCritic, () => ({ stage: o.criticStage, phase: p.phase, roleKey: o.criticRole, title: o.criticTitle, input: { authorTaskId: author.id }, exclude: author.assigneeId ? [author.assigneeId] : [] })); return false; }
    await e.create(p, { stage: o.criticStage, phase: p.phase, roleKey: o.criticRole, title: o.criticTitle, input: { authorTaskId: author.id }, exclude: author.assigneeId ? [author.assigneeId] : [], round: author.round });
    return false;
  }
  if (!isTerminal(critic)) return false;
  const rounds = (p.counters[o.counter] ?? 0) + 1; // critique rounds completed so far
  if (critic.result?.verdict === 'REVISE' && rounds < e.s.policies().limits.maxReviewRounds) {
    await e.s.projects.bumpCounter(p.id, o.counter);
    await e.create(p, { ...o.author(author.round + 1, { summary: critic.result?.summary, issues: critic.result?.issues }), assigneeId: author.assigneeId });
    return false;
  }
  return true;
}

export async function planningPhase(e: EngineCore, p: Project): Promise<boolean> {
  const s = e.s;
  switch (p.phase) {
    case 'INTAKE':
      await e.enter(p, 'DISCOVERY', 'CEO accepted the Owner request and assigned the Research Director');
      return true;

    case 'DISCOVERY': {
      const tracks = TRACKS.slice(0, Math.min(5, Math.max(1, s.policies().research.researcherCount))).map((t) => t.track);
      const brief = await e.latest(p, 'research.brief');
      const spec = (): NewTask => ({ stage: 'research.brief', phase: 'DISCOVERY', roleKey: 'research-director', title: 'Frame research questions', input: { tracks } });
      if (!brief) await e.create(p, spec());
      else if (brief.status === 'FAILED') await e.handleFailed(p, brief, spec);
      else if (brief.status === 'DONE') await e.enter(p, 'RESEARCH', 'Research brief ready — researchers assigned');
      return true;
    }

    case 'RESEARCH': {
      const pol = s.policies();
      const brief = await e.latest(p, 'research.brief');
      const questions = (brief?.result?.questions ?? {}) as Record<string, string[]>;
      const tracks = TRACKS.slice(0, Math.min(5, Math.max(1, pol.research.researcherCount)));
      const round = p.counters.researchRound ?? 0;
      const invSpec = (t: { track: string; role: string }, r: number, feedback?: unknown): NewTask => ({
        stage: 'research.investigate', phase: 'RESEARCH', roleKey: t.role, title: `${t.track[0].toUpperCase()}${t.track.slice(1)} research${r > 1 ? ` (revision ${r})` : ''}`,
        input: { track: t.track, questions: questions[t.track] ?? [], feedback }, round: r,
      });
      if (round === 0) {
        await s.projects.bumpCounter(p.id, 'researchRound');
        for (const t of tracks) await e.create(p, invSpec(t, 1));
        await s.bus.emit('SYSTEM', `${tracks.length} researchers started independent research`, { projectId: p.id });
        return true;
      }
      const inv = (await e.all(p, 'research.investigate')).filter((t) => t.round === round);
      const failed = inv.find((t) => t.status === 'FAILED' && !inv.some((x) => x.input.track === t.input.track && x.status !== 'FAILED' && x.createdAt > t.createdAt));
      if (failed) { await e.handleFailed(p, failed, () => invSpec(tracks.find((x) => x.track === failed.input.track) ?? tracks[0], round, failed.input.feedback)); return true; }
      const active = inv.filter((t) => t.status !== 'FAILED');
      if (active.some((t) => !isTerminal(t))) return true;
      const reviewers: { stage: string; role: string; title: string }[] = [
        { stage: 'research.critique', role: 'research-critic', title: `Challenge research findings (round ${round})` },
        { stage: 'research.factcheck', role: 'fact-checker', title: `Fact-check research findings (round ${round})` },
      ];
      const authors = active.map((t) => t.assigneeId!).filter(Boolean);
      let reviewsDone = true;
      const reviews: Task[] = [];
      for (const r of reviewers) {
        const t = (await e.all(p, r.stage)).find((x) => x.round === round && x.status !== 'FAILED');
        if (!t) {
          const f = (await e.all(p, r.stage)).find((x) => x.round === round);
          if (f) await e.handleFailed(p, f, () => ({ stage: r.stage, phase: 'RESEARCH', roleKey: r.role, title: r.title, exclude: authors, round }));
          else await e.create(p, { stage: r.stage, phase: 'RESEARCH', roleKey: r.role, title: r.title, exclude: authors, round, dependsOn: active.map((x) => x.id) });
          reviewsDone = false;
        } else if (!isTerminal(t)) reviewsDone = false;
        else reviews.push(t);
      }
      if (!reviewsDone) return true;
      const challenged = new Set<string>();
      for (const r of reviews) for (const i of (r.result?.issues as Record<string, unknown>[] | undefined) ?? []) {
        if (/high/i.test(String(i.severity ?? '')) || /incorrect/i.test(String(i.status ?? ''))) challenged.add(String(i.track ?? ''));
      }
      const revise = reviews.some((r) => r.result?.verdict === 'REVISE');
      const synth = await e.latest(p, 'research.synthesize');
      if (revise && round < pol.limits.maxResearchRounds && !synth) {
        const targets = tracks.filter((t) => challenged.has(t.track));
        const toRevise = targets.length ? targets : tracks;
        await s.projects.bumpCounter(p.id, 'researchRound');
        await s.meetings.record({
          projectId: p.id, type: 'Research Review', title: `Research cross-review round ${round}`, participants: reviews.map((r) => r.code),
          agenda: ['Critique', 'Fact check'], positions: reviews.map((r) => ({ who: r.title, position: asString(r.result?.summary).slice(0, 600) || String(r.result?.verdict) })),
          objections: [...challenged].map((c) => `${c} track challenged`), decision: `Revise ${toRevise.map((t) => t.track).join(', ')} research`, actionItems: toRevise.map((t) => `${t.track} researcher revises findings`),
        });
        await s.bus.emit('SYSTEM', `Research Critic challenged findings — ${toRevise.length} track(s) revising`, { projectId: p.id });
        const feedback = reviews.map((r) => ({ reviewer: r.title, summary: r.result?.summary, issues: r.result?.issues }));
        for (const t of toRevise) await e.create(p, invSpec(t, round + 1, feedback));
        // Unchallenged tracks carry forward unchanged into the new round.
        for (const t of tracks.filter((x) => !toRevise.includes(x))) {
          const prev = active.find((x) => x.input.track === t.track);
          if (prev) await s.tasks.update(prev.id, { round: round + 1 });
        }
        return true;
      }
      const synthSpec = (r: number, feedback?: unknown): NewTask => ({ stage: 'research.synthesize', phase: 'RESEARCH', roleKey: 'research-synthesizer', title: `Synthesize research report${r > 1 ? ` (revision ${r})` : ''}`, input: { feedback }, round: r, exclude: authors });
      if (!synth) { await e.create(p, synthSpec(1)); return true; }
      if (synth.status === 'FAILED') { await e.handleFailed(p, synth, () => synthSpec(synth.round, synth.input.feedback)); return true; }
      const g = await e.gateStep(p, { gate: 'RESEARCH', authorStage: 'research.synthesize', reviewStage: 'research.ceo_review', phase: 'RESEARCH', reviseAuthor: (_a, fb, r) => synthSpec(r, fb) });
      if (g === 'approved') await e.enter(p, 'PRODUCT_PLANNING', 'Research approved — Product department activated');
      return true;
    }

    case 'PRODUCT_PLANNING': {
      const prdSpec = (r: number, feedback?: unknown): NewTask => ({ stage: 'product.prd', phase: 'PRODUCT_PLANNING', roleKey: 'product-manager', assigneeId: p.projectManagerId, title: `Write PRD${r > 1 ? ` (revision ${r})` : ''}`, input: { feedback }, round: r });
      const ok = await critiqueLoop(e, p, { authorStage: 'product.prd', criticStage: 'product.critique', criticRole: 'product-critic', counter: 'productRounds', author: prdSpec, criticTitle: 'Critique PRD' });
      if (ok) await e.enter(p, 'FEATURE_DEFINITION', 'PRD passed independent critique');
      return true;
    }

    case 'FEATURE_DEFINITION': {
      const prd = await e.latest(p, 'product.prd');
      if (prd?.status === 'DONE') {
        const art = await s.db.query.artifacts.findFirst({ where: (a, { and, eq }) => and(eq(a.taskId, prd.id), eq(a.kind, 'PRD')) });
        const existing = await s.db.query.artifacts.findFirst({ where: (a, { and, eq }) => and(eq(a.projectId, p.id), eq(a.title, 'Feature specification'), eq(a.taskId, prd.id)) });
        if (art && !existing) {
          const features = (art.data?.mvpFeatures as { id: string; name: string; description: string; priority: string; acceptanceCriteria: string[] }[] | undefined) ?? [];
          const md = features.map((f) => `### ${f.id} ${f.name} (${f.priority})\n${f.description}\n\nAcceptance criteria:\n${(f.acceptanceCriteria ?? []).map((a) => `- [ ] ${a}`).join('\n')}`).join('\n\n');
          await s.artifacts.save({ projectId: p.id, taskId: prd.id, kind: 'PRD', title: 'Feature specification', content: md || 'No structured features provided.', data: { features }, authorId: prd.assigneeId });
        }
      }
      const g = await e.gateStep(p, {
        gate: 'PRODUCT', authorStage: 'product.prd', reviewStage: 'product.ceo_review', phase: 'FEATURE_DEFINITION',
        reviseAuthor: (a, fb, r) => ({ stage: 'product.prd', phase: 'PRODUCT_PLANNING', roleKey: 'product-manager', assigneeId: a.assigneeId, title: `Write PRD (revision ${r})`, input: { feedback: fb }, round: r }),
      });
      if (g === 'approved') await e.enter(p, 'DESIGN', 'Product scope approved by CEO — Design department activated');
      return true;
    }

    case 'DESIGN': {
      const spec = (r: number, feedback?: unknown): NewTask => ({ stage: 'design.spec', phase: 'DESIGN', roleKey: 'ux-designer', title: `Design specification${r > 1 ? ` (revision ${r})` : ''}`, input: { feedback }, round: r });
      const ok = await critiqueLoop(e, p, { authorStage: 'design.spec', criticStage: 'design.critique', criticRole: 'design-critic', counter: 'designRounds', author: spec, criticTitle: 'Critique design' });
      if (!ok) return true;
      const g = await e.gateStep(p, { gate: 'DESIGN', authorStage: 'design.spec', reviewStage: 'design.ceo_review', phase: 'DESIGN', reviseAuthor: (a, fb, r) => ({ ...spec(r, fb), assigneeId: a.assigneeId }) });
      if (g === 'approved') await e.enter(p, 'ARCHITECTURE', 'CEO approved design — Architecture started');
      return true;
    }

    case 'ARCHITECTURE': {
      const spec = (r: number, feedback?: unknown): NewTask => ({ stage: 'architecture.design', phase: 'ARCHITECTURE', roleKey: 'software-architect', title: `System architecture & work breakdown${r > 1 ? ` (revision ${r})` : ''}`, input: { feedback }, round: r });
      const ok = await critiqueLoop(e, p, { authorStage: 'architecture.design', criticStage: 'architecture.review', criticRole: 'architecture-reviewer', counter: 'architectureRounds', author: spec, criticTitle: 'Independent architecture review' });
      if (!ok) return true;
      const g = await e.gateStep(p, { gate: 'ARCHITECTURE', authorStage: 'architecture.design', reviewStage: 'architecture.cto_review', phase: 'ARCHITECTURE', reviseAuthor: (a, fb, r) => ({ ...spec(r, fb), assigneeId: a.assigneeId }) });
      if (g !== 'approved') return true;
      await adoptArchitecture(e, p);
      await e.enter(p, 'DEVELOPMENT', 'Architecture approved by CTO — ENGINEERING UNLOCKED');
      return true;
    }
    default:
      return false;
  }
}

/** On architecture approval: record ADRs in the decision ledger and adopt the acceptance contract. */
async function adoptArchitecture(e: EngineCore, p: Project): Promise<void> {
  const s = e.s;
  if (p.counters.architectureAdopted) return;
  const arch = await s.db.query.artifacts.findFirst({ where: (a, { and, eq }) => and(eq(a.projectId, p.id), eq(a.kind, 'ARCHITECTURE_DOC')), orderBy: (a, { desc }) => [desc(a.createdAt)] });
  const data = (arch?.data ?? {}) as Record<string, unknown>;
  const author = arch?.authorId ? await s.org.employee(arch.authorId) : undefined;
  const reviewer = (await e.latest(p, 'architecture.review'));
  const reviewerEmp = reviewer?.assigneeId ? await s.org.employee(reviewer.assigneeId) : undefined;
  const cto = await s.org.firstOfRole('cto');
  for (const adr of (data.adrs as { title: string; decision: string; reason: string; alternatives?: string }[] | undefined) ?? []) {
    await s.decisions.record({ projectId: p.id, title: adr.title, decision: adr.decision, reason: `${adr.reason}${adr.alternatives ? `\nAlternatives considered: ${adr.alternatives}` : ''}`, proposedBy: author?.name ?? 'Software Architect', reviewedBy: [reviewerEmp?.name ?? 'Architecture Critic', 'CTO'], approvedBy: cto?.name ?? 'CTO' });
    await s.artifacts.save({ projectId: p.id, kind: 'ADR', title: `ADR: ${adr.title}`, content: `# ${adr.title}\n\n## Decision\n${adr.decision}\n\n## Reason\n${adr.reason}\n\n## Alternatives\n${adr.alternatives ?? '—'}`, authorId: arch?.authorId ?? null });
  }
  const contract = (data.contract ?? {}) as { routes?: string[]; apiChecks?: { method: string; path: string; body?: unknown; expectStatus: number; name?: string }[] };
  const routes = Array.from(new Set(['/', ...((contract.routes ?? []).filter((r) => typeof r === 'string' && r.startsWith('/') && !r.includes(':')))])).slice(0, 15);
  const apiChecks = (contract.apiChecks ?? []).filter((c) => c && typeof c.path === 'string' && c.path.startsWith('/') && Number.isInteger(c.expectStatus) && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(c.method)).slice(0, 25);
  await s.projects.update(p.id, { deployment: { ...p.deployment, routes, apiChecks }, counters: { ...p.counters, architectureAdopted: 1 } });
  await s.memory.remember({ scope: 'PROJECT', projectId: p.id, kind: 'ARCHITECTURE', content: `Approved stack for ${p.name}: ${JSON.stringify(data.stack ?? {})}` });
}
