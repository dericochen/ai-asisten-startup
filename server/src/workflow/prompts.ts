/**
 * Prompt builders for every agent stage. Each prompt carries: the assignment, only the relevant context
 * (retrieved artifacts + memories — never the whole company memory), and a strict output contract
 * (Markdown deliverable + final ```json block). The platform parses the JSON; agents never mutate state.
 */
export interface PromptContext {
  companyName: string;
  project: { code: string; name: string; objective: string; description: string; ownerRequest: string; type: string };
  employeeName: string;
  roleTitle: string;
  taskCode: string;
  round: number;
  input: Record<string, unknown>;
  docs: Record<string, string>;   // upstream artifacts by label
  memories: string[];
}

export const RUNTIME_CONTRACT = `COMPANY RUNTIME CONTRACT — mandatory so automated QA, staging and production can operate the app:
1. Node.js (>=22) project at the repository root with a package.json.
2. npm scripts: "start" runs the production server; "test" runs automated tests and exits non-zero on failure (tests must not require network access or an already-running server — start the server on an ephemeral port inside the test if needed, then close it); "build" prepares assets (a fast no-op such as \`node -e "console.log('no build step')"\` is acceptable when nothing needs building).
3. The server listens on process.env.PORT (default 3000) and process.env.HOST (default '0.0.0.0'), serves the frontend at GET / as HTML, and the API under /api/*.
4. GET /api/health returns HTTP 200 with JSON {"status":"ok"}.
5. Persist data under process.env.DATA_DIR (default ./data, which must be gitignored). Prefer Node built-ins (node:http, node:fs, node:sqlite, node:test) or a few small, well-known npm packages with exact pinned versions. No external services, database servers or API keys may be required to run.
6. Every response sets: X-Content-Type-Options: nosniff; X-Frame-Options: DENY (or CSP frame-ancestors 'none'); Referrer-Policy: strict-origin-when-cross-origin.
7. Validate all input server-side and return JSON errors with correct HTTP status codes. Never log secrets, never hardcode credentials, never commit .env files (provide .env.example if configuration exists). Escape/encode user content rendered in HTML to prevent XSS.
8. The UI must be responsive (mobile and desktop) and accessible (semantic HTML, labels, keyboard navigation, sufficient contrast).
9. README.md documents what the app does, how to run it, scripts, and the API.`;

const json = (o: unknown) => JSON.stringify(o, null, 2);

function header(c: PromptContext, title: string): string {
  return [
    `# Assignment ${c.taskCode}: ${title}`,
    `You are ${c.employeeName}, ${c.roleTitle} at ${c.companyName}.`,
    `Project ${c.project.code} — "${c.project.name}" (${c.project.type.replace(/_/g, ' ').toLowerCase()}).`,
    `Objective: ${c.project.objective}`,
    c.project.ownerRequest ? `Owner's original request: "${c.project.ownerRequest}"` : '',
    c.round > 1 ? `This is revision round ${c.round}. Address all feedback below explicitly.` : '',
  ].filter(Boolean).join('\n');
}

export const CONTEXT_DIR = '.aco-context';
export const contextFileName = (label: string) => `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'doc'}.md`;

function contextBlock(c: PromptContext, keys: string[], maxEach = 14_000): string {
  const parts: string[] = [];
  const files: string[] = [];
  for (const k of keys) {
    const v = c.docs[k];
    if (!v) continue;
    const file = `${CONTEXT_DIR}/${contextFileName(k)}`;
    files.push(`- ${k}: \`${file}\` (${v.length} characters)`);
    parts.push(`### ${k}\n${v.length > maxEach ? `${v.slice(0, maxEach)}\n\n…(excerpt truncated here — the COMPLETE document is in \`${file}\`; read the full file before judging completeness)` : v}`);
  }
  if (c.memories.length) parts.push(`### Relevant company memory\n${c.memories.map((m) => `- ${m}`).join('\n')}`);
  if (files.length) parts.unshift(`Full, untruncated copies of every context document are available as files in your working directory (read them with your read tool; they are not part of the product and must not be modified or committed):\n${files.join('\n')}`);
  return parts.length ? `## Context\n${parts.join('\n\n')}` : '';
}

function contract(deliverable: string, schema: unknown): string {
  return `## Output format (required)\n${deliverable}\nThen END your reply with exactly one fenced \`\`\`json block (no other json blocks) matching this schema:\n\`\`\`json\n${json(schema)}\n\`\`\``;
}

function feedback(c: PromptContext): string {
  const f = c.input.feedback;
  if (!f) return '';
  return `## Feedback to address (from reviewers / leadership)\n${typeof f === 'string' ? f : json(f)}`;
}

type Builder = (c: PromptContext) => string;

const TRACK_FOCUS: Record<string, string> = {
  user: 'target users and segments, their jobs-to-be-done, pain points, current workarounds, and what would make them switch',
  market: 'market size and growth indicators, customer segments, pricing models and willingness to pay, go-to-market channels',
  competitor: 'direct and indirect competitors (name real products), their key features, pricing, strengths, weaknesses and gaps we can exploit',
  technical: 'technical approaches, platforms, integrations, feasibility risks and build-vs-buy considerations',
  data: 'quantitative data points that support or challenge the opportunity, with sources',
};

export const PROMPTS: Record<string, Builder> = {
  'research.brief': (c) => [
    header(c, 'Research brief'),
    `## Your task\nFrame the research for this project. Define the key questions each research track must answer and the assumptions that need validation. Tracks: ${(c.input.tracks as string[]).join(', ')}.`,
    contextBlock(c, []),
    contract('Write a concise Markdown research brief.', { summary: 'string', assumptions: ['string'], questions: Object.fromEntries((c.input.tracks as string[]).map((t) => [t, ['string']])) }),
  ].join('\n\n'),

  'research.investigate': (c) => [
    header(c, `${String(c.input.track)} research`),
    `## Your task\nInvestigate ${TRACK_FOCUS[String(c.input.track)] ?? 'the assigned research questions'}. Use web search where it improves accuracy and cite sources (URLs). Mark confidence for each finding. Do not invent statistics — if you cannot verify a number, say so.`,
    c.input.questions ? `## Research questions\n${(c.input.questions as string[]).map((q) => `- ${q}`).join('\n')}` : '',
    feedback(c),
    contextBlock(c, ['Research brief', 'Previous findings']),
    contract('Write your findings as a Markdown report (8–25 bullet findings grouped by theme, each with source and confidence).', {
      keyFindings: [{ claim: 'string', evidence: 'string', source: 'url or "analysis"', confidence: 'high|medium|low' }], risks: ['string'], openQuestions: ['string'],
    }),
  ].join('\n\n'),

  'research.critique': (c) => [
    header(c, 'Critical review of research findings'),
    '## Your task\nIndependently challenge the research below: weak evidence, unsupported claims, missing perspectives, biased assumptions, contradictions between tracks. Be specific — reference the track and claim. Choose REVISE only for problems that would change product decisions.',
    contextBlock(c, ['Research findings']),
    contract('Write a Markdown critique.', { verdict: 'PASS|REVISE', summary: 'string', challenges: [{ track: 'user|market|competitor|technical|data', issue: 'string', severity: 'high|medium|low' }] }),
  ].join('\n\n'),

  'research.factcheck': (c) => [
    header(c, 'Fact check of research findings'),
    '## Your task\nVerify the most decision-relevant factual claims (numbers, competitor facts, market claims). Use web search to check sources. You did not author these findings.',
    contextBlock(c, ['Research findings']),
    contract('Write a Markdown fact-check table (claim → verified / unverified / incorrect, with source).', { verdict: 'PASS|REVISE', checked: [{ track: 'string', claim: 'string', status: 'verified|unverified|incorrect', note: 'string' }] }),
  ].join('\n\n'),

  'research.synthesize': (c) => [
    header(c, 'Research synthesis'),
    '## Your task\nSynthesize all findings, the critique and the fact check into one decision-ready research report for the CEO. Resolve contradictions, drop unverified or incorrect claims, and state remaining uncertainty. End with a clear recommendation on what to build for the MVP.',
    feedback(c),
    contextBlock(c, ['Research findings', 'Research critique', 'Fact check']),
    contract('Write the full Markdown research report: Executive summary, Target users, Problems, Market, Competitive landscape, Opportunities, Risks, Recommendation.', {
      executiveSummary: 'string', targetUsers: ['string'], problems: ['string'], competitors: [{ name: 'string', notes: 'string' }], opportunities: ['string'], risks: ['string'], recommendation: 'string',
    }),
  ].join('\n\n'),

  'executive.gate_review': (c) => [
    header(c, `${String(c.input.gateLabel)} — executive gate review`),
    `## Your task\nYou are deciding the ${String(c.input.gateLabel)} gate. Review the deliverable strictly on evidence. APPROVE only if it is complete, coherent with the Owner's request and earlier approved work, and good enough for the next department to execute without guessing. Otherwise REVISE with specific, actionable feedback. Do not rewrite the deliverable yourself.`,
    contextBlock(c, Object.keys(c.docs)),
    contract('Write a short Markdown executive review (strengths, concerns, decision rationale).', { decision: 'APPROVE|REVISE', rationale: 'string', concerns: ['string'], requiredChanges: ['string'] }),
  ].join('\n\n'),

  'product.prd': (c) => [
    header(c, 'Product requirements document'),
    '## Your task\nTurn the approved research into a PRD for a focused MVP that a small engineering team can build and fully test in one iteration. Define the problem, users, MVP features (max 6) with testable acceptance criteria, business rules, data entities, out-of-scope items, risks and success metrics. Scope must fit the company runtime contract below (single Node.js web app, no external services).',
    `## Constraints\n${RUNTIME_CONTRACT}`,
    feedback(c),
    contextBlock(c, ['Research report', 'Previous PRD']),
    contract('Write the full PRD in Markdown.', {
      problem: 'string', users: ['string'], mvpFeatures: [{ id: 'F1', name: 'string', description: 'string', priority: 'must|should', acceptanceCriteria: ['Given/When/Then string'] }],
      businessRules: ['string'], dataEntities: [{ name: 'string', fields: ['string'] }], outOfScope: ['string'], risks: ['string'], successMetrics: ['string'],
    }),
  ].join('\n\n'),

  'product.critique': (c) => [
    header(c, 'PRD critique'),
    '## Your task\nIndependently critique the PRD: is scope realistic for one iteration, are acceptance criteria testable, are there gaps, contradictions or missing edge cases (validation, empty states, errors)? Choose REVISE only for issues that would cause rework later.',
    contextBlock(c, ['PRD', 'Research report'], 9000),
    contract('Write a Markdown critique.', { verdict: 'PASS|REVISE', summary: 'string', issues: [{ issue: 'string', severity: 'high|medium|low' }] }),
  ].join('\n\n'),

  'design.spec': (c) => [
    header(c, 'UX/UI design specification'),
    '## Your task\nDesign the product experience before implementation: information architecture, screens (with routes), key user flows, every screen\'s states (empty, loading, error, success), component inventory, a professional visual system (design tokens: colors with hex values meeting WCAG AA contrast, typography, spacing, radius), responsive behaviour for mobile and desktop, and accessibility requirements. The design must be implementable with plain HTML/CSS/JS or a light framework, and look like a credible modern SaaS product (no gimmicks).',
    feedback(c),
    contextBlock(c, ['PRD', 'Research report', 'Previous design'], 10_000),
    contract('Write the full design specification in Markdown (include ASCII wireframes for the main screens).', {
      screens: [{ name: 'string', route: '/path', purpose: 'string', components: ['string'], states: ['empty|loading|error|success'] }],
      flows: [{ name: 'string', steps: ['string'] }], tokens: { colors: { primary: '#hex', background: '#hex', text: '#hex' }, fontFamily: 'string', spacingScale: ['4px'], radius: 'string' },
      responsive: ['string'], accessibility: ['string'],
    }),
  ].join('\n\n'),

  'design.critique': (c) => [
    header(c, 'Design critique'),
    '## Your task\nIndependently critique the design for usability, consistency with the PRD, completeness of states, responsive behaviour and WCAG 2.2 AA accessibility. Choose REVISE only for issues that would produce a poor or inaccessible product.',
    contextBlock(c, ['Design specification', 'PRD'], 10_000),
    contract('Write a Markdown critique.', { verdict: 'PASS|REVISE', summary: 'string', issues: [{ issue: 'string', severity: 'high|medium|low' }] }),
  ].join('\n\n'),

  'architecture.design': (c) => [
    header(c, 'Software architecture'),
    '## Your task\nDesign the architecture for the approved PRD and design. Choose the stack (within the runtime contract), the module structure, data model, API endpoints, test strategy and security controls. Write ADRs for significant decisions. Then define the engineering work breakdown: exactly one scaffold task (repository structure, package.json scripts, server with /api/health and security headers, test harness, README) followed by at most 2 backend tasks and at most 2 frontend tasks that can be built in parallel without editing the same files (assign file ownership). Also define the automated acceptance contract: GET routes that must load and API checks (method, path, JSON body, expected status) that QA will execute against the running app — include validation-error cases (e.g. 400).',
    `## Runtime contract (non-negotiable)\n${RUNTIME_CONTRACT}`,
    feedback(c),
    contextBlock(c, ['PRD', 'Design specification', 'Previous architecture'], 10_000),
    contract('Write the architecture document in Markdown: Overview, Stack, Modules & file layout, Data model, API, Security, Testing, Deployment, Risks.', {
      stack: { frontend: 'string', backend: 'string', database: 'string', testing: 'string' },
      adrs: [{ title: 'string', decision: 'string', reason: 'string', alternatives: 'string' }],
      apiEndpoints: [{ method: 'GET', path: '/api/...', description: 'string' }],
      contract: { routes: ['/'], apiChecks: [{ name: 'string', method: 'POST', path: '/api/...', body: {}, expectStatus: 201 }] },
      workBreakdown: {
        scaffold: { title: 'string', description: 'string' },
        backend: [{ title: 'string', description: 'string', files: ['src/...'] }],
        frontend: [{ title: 'string', description: 'string', files: ['public/...'] }],
      },
    }),
  ].join('\n\n'),

  'architecture.review': (c) => [
    header(c, 'Architecture review'),
    '## Your task\nIndependently review the architecture for correctness, simplicity, security (access control, input validation, XSS, secrets), testability, compliance with the runtime contract, and whether the work breakdown can be executed in parallel without conflicts. You did not author it. Choose REVISE only for issues that would cause defects or rework.',
    `## Runtime contract\n${RUNTIME_CONTRACT}`,
    contextBlock(c, ['Architecture', 'PRD'], 10_000),
    contract('Write a Markdown review.', { verdict: 'PASS|REVISE', summary: 'string', issues: [{ issue: 'string', severity: 'high|medium|low' }] }),
  ].join('\n\n'),

  'engineering.scaffold': (c) => [
    header(c, String(c.input.title ?? 'Repository scaffold')),
    `## Your task\nYou are working in the project repository on your own branch (current directory). Implement the scaffold described below so other engineers can build features in parallel: package.json with the required scripts, server entry point honouring PORT with GET /api/health and security headers on every response, static frontend serving, folder layout from the architecture, a passing test harness with at least one real test, .gitignore entries for data/ and node_modules/, and README.md.\n\nScaffold specification: ${String(c.input.description ?? '')}\n\nRun \`npm install\` (only if you added dependencies) and \`npm test\` and make sure tests pass before you report. Do not start long-running servers. Do not run git commands — the platform commits your work with your attribution.`,
    `## Runtime contract\n${RUNTIME_CONTRACT}`,
    contextBlock(c, ['Architecture', 'Design specification'], 10_000),
    contract('Briefly summarise what you built in Markdown.', { summary: 'string', filesChanged: ['string'], testsRun: 'command and result', notes: ['string'] }),
  ].join('\n\n'),

  'engineering.implement': (c) => [
    header(c, String(c.input.title)),
    `## Your task\nYou are a ${String(c.input.area)} engineer working in the project repository on your own branch (current directory). Implement this work item completely, following the approved design and architecture:\n\n${String(c.input.description)}\n\nFiles you own: ${(c.input.files as string[] | undefined)?.join(', ') || 'see architecture'}. Avoid editing files owned by other work items unless strictly necessary (if you must, keep the change minimal). Add or update automated tests for your work. Run \`npm install\` if you add dependencies, then \`npm test\`, and fix failures before reporting. Do not start long-running servers. Do not run git commands — the platform commits your work with your attribution.`,
    `## Runtime contract\n${RUNTIME_CONTRACT}`,
    feedback(c),
    contextBlock(c, ['Architecture', 'Design specification', 'PRD'], 9000),
    contract('Briefly summarise what you implemented in Markdown.', { summary: 'string', filesChanged: ['string'], testsRun: 'command and result', acceptanceCriteriaCovered: ['F1 ...'], notes: ['string'] }),
  ].join('\n\n'),

  'engineering.integrate': (c) => [
    header(c, 'Resolve merge conflicts'),
    `## Your task\nThe merge of branch ${String(c.input.branch)} into develop produced conflicts in: ${(c.input.conflicts as string[]).join(', ')}. The merge is in progress in the current directory with conflict markers. Resolve every conflict so that BOTH sides' intended functionality is preserved, remove all conflict markers, then run \`npm install\` (if dependencies changed) and \`npm test\` until they pass. Do not run git commands — the platform completes the merge commit.`,
    contextBlock(c, ['Architecture'], 8000),
    contract('Summarise the resolution in Markdown.', { summary: 'string', filesChanged: ['string'], testsRun: 'command and result' }),
  ].join('\n\n'),

  'engineering.fix': (c) => [
    header(c, String(c.input.title ?? 'Fix failing checks')),
    `## Your task\nYou are working in the project repository on your own branch (current directory), based on the latest develop. The following problem was reported by ${String(c.input.source)}. Diagnose the root cause and fix it properly (no test deletion, no disabling checks). Run \`npm install\` if needed and \`npm test\`; make sure everything passes. Do not start long-running servers or run git commands.`,
    `## Problem report\n${String(c.input.details ?? '').slice(0, 12_000)}`,
    `## Runtime contract\n${RUNTIME_CONTRACT}`,
    contextBlock(c, ['Architecture', 'PRD'], 6000),
    contract('Summarise root cause and fix in Markdown.', { summary: 'string', rootCause: 'string', filesChanged: ['string'], testsRun: 'command and result' }),
  ].join('\n\n'),

  'engineering.code_review': (c) => [
    header(c, 'Independent code review'),
    '## Your task\nReview the change set (develop vs main) shown below and read any files you need in the current directory (read-only). You did not write this code. Check correctness against the PRD acceptance criteria and architecture, security (access control, input validation, injection, XSS, secrets, headers), error handling, tests and maintainability. Severity: critical/high = must fix before release; medium/low = can ship. APPROVE unless there are critical or high issues.',
    `## Diff\n${String(c.input.diffStat ?? '')}\n\n\`\`\`diff\n${String(c.input.diff ?? '').slice(0, 45_000)}\n\`\`\``,
    contextBlock(c, ['Architecture', 'PRD'], 6000),
    contract('Write your review in Markdown.', { verdict: 'APPROVE|REQUEST_CHANGES', summary: 'string', issues: [{ file: 'string', severity: 'critical|high|medium|low', issue: 'string', suggestion: 'string' }] }),
  ].join('\n\n'),

  'qa.report': (c) => [
    header(c, 'QA test report'),
    '## Your task\nYou lead QA for this release. The automated QA suite results are below (real executions against the running app). Read the code and tests in the current directory (a disposable checkout) and you may run `npm test`. Map each PRD acceptance criterion to evidence (automated check, test file, or code inspection) and report bugs with severity. Do not claim something was tested unless there is evidence. FAIL only if there are critical/high bugs or the automated suite failed.',
    `## Automated QA suite results\n${String(c.input.automated ?? '')}`,
    contextBlock(c, ['PRD', 'Design specification'], 8000),
    contract('Write the QA report in Markdown.', { verdict: 'PASS|FAIL', coverage: [{ criterion: 'string', status: 'covered|partial|missing', evidence: 'string' }], bugs: [{ title: 'string', severity: 'critical|high|medium|low', area: 'frontend|backend', steps: 'string', expected: 'string', actual: 'string' }] }),
  ].join('\n\n'),

  'security.review': (c) => [
    header(c, 'Application security review'),
    '## Your task\nPerform an application security review of the code in the current directory (read-only) before production. Cover: authentication/authorization and broken access control, input validation, SQL/NoSQL/command injection, XSS (stored and reflected), CSRF where relevant, secrets exposure, unsafe file handling, sensitive logging, rate limiting, security headers, and dependency risk. Automated scanner results are below. You did not implement this code. Report real, specific findings with file references; do not pad with generic advice. FAIL only for critical/high findings.',
    `## Automated security checks\n${String(c.input.automated ?? '')}`,
    contextBlock(c, ['Architecture'], 6000),
    contract('Write the security report in Markdown.', { verdict: 'PASS|FAIL', findings: [{ title: 'string', severity: 'critical|high|medium|low', file: 'string', recommendation: 'string' }] }),
  ].join('\n\n'),

  'devops.release_board': (c) => [
    header(c, 'Release board review'),
    `## Your task\nChair the release board for release ${String(c.input.version)} (commit ${String(c.input.commit).slice(0, 10)}). Decide GO or NO_GO for production based strictly on the evidence below (all results are real executions recorded by the platform). Write the release notes and a rollback plan.`,
    `## Evidence\n${String(c.input.evidence ?? '')}`,
    contextBlock(c, ['PRD'], 4000),
    contract('Write the release board minutes and release notes in Markdown.', { verdict: 'GO|NO_GO', releaseNotes: 'string', risks: ['string'], rollbackPlan: 'string' }),
  ].join('\n\n'),

  'executive.completion_report': (c) => [
    header(c, 'Project completion report'),
    '## Your task\nWrite the final completion report for the Owner based strictly on the evidence below (real platform records). Be honest about known issues and limitations.',
    `## Evidence\n${String(c.input.evidence ?? '')}`,
    contextBlock(c, ['PRD'], 5000),
    contract('Write the completion report in Markdown with sections: Product, Production status, Features delivered, Tests, Security, Deployment, Known issues, Future recommendations, Documentation.', { summary: 'string', featuresDelivered: ['string'], knownIssues: ['string'], recommendations: ['string'] }),
  ].join('\n\n'),
};
