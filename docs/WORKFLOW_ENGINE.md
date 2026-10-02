# Workflow engine

`workflow/engine.ts` runs a tick loop (default every 3s, immediately after any task finishes). Each tick does three things for every ACTIVE project: dispatch runnable tasks (READY with all dependencies DONE), then run the phase handler for the current phase. The handler is a deterministic function of database state, so the engine is restart-safe.

## Phases and gates

| Phase | Work | Exit / entry gate (enforced by `WorkflowGuard`) |
|---|---|---|
| INTAKE → DISCOVERY | Research Director frames questions | — |
| RESEARCH | N parallel researchers (user, market, competitor, technical, data) → Research Critic + Fact Checker (both exclude the authors) → bounded revision rounds → Research Synthesizer → CEO gate review | PRODUCT_PLANNING requires `RESEARCH` approval |
| PRODUCT_PLANNING / FEATURE_DEFINITION | Product Manager writes the PRD → Product Critic → revisions → feature spec → CEO gate | DESIGN requires `RESEARCH` + `PRODUCT` approvals |
| DESIGN | UX Designer → Design Critic → revisions → CEO gate | ARCHITECTURE requires `DESIGN` approval |
| ARCHITECTURE | Software Architect (stack, ADRs, API, acceptance contract, work breakdown) → Architecture Critic → CTO gate; ADRs go into the decision ledger | DEVELOPMENT requires `RESEARCH`, `PRODUCT`, `DESIGN` (CEO) and `ARCHITECTURE` (CTO) — otherwise `ENGINEERING_IMPLEMENTATION_LOCKED` |
| DEVELOPMENT | Backend Lead scaffold, then ≤2 backend + ≤2 frontend work items in parallel git worktrees (`agent/<TASK>` branches), each committed with agent attribution and merged into `develop`; conflicts go to an Integration Engineer | — |
| INTEGRATION | System: `npm install/ci`, build, typecheck, lint, test on `develop` | — |
| CODE_REVIEW | Independent Code Reviewer (excludes every engineering author) reviews the `main...develop` diff | QA requires `CODE_REVIEW` checks PASS |
| QA | System QA suite (install, build, tests, start app, health, homepage HTML, asset loading, routes, API checks) → QA Lead report against acceptance criteria | SECURITY requires `QA` PASS |
| SECURITY | System: secret scan, `npm audit`, security headers → AppSec review (independent of implementers) | PERFORMANCE_TEST requires `SECURITY` PASS |
| PERFORMANCE_TEST | p50/p95 latency against the running app | DEPLOYMENT_PREPARATION requires QA + SECURITY PASS |
| DEPLOYMENT_PREPARATION | Release Manager: merge `develop → main`, tag `vX.Y.0` | — |
| STAGING / STAGING_VALIDATION | Deploy the tag to staging, then smoke + header checks against the staging URL | RELEASE_REVIEW requires staging PASS |
| RELEASE_REVIEW | Release board (GO/NO_GO, notes, rollback plan) → CEO release gate | OWNER_APPROVAL requires `RELEASE` approval |
| OWNER_APPROVAL | Per deployment policy: Owner approval (default), CEO approval, manual, or auto after checks | PRODUCTION_DEPLOYMENT requires RELEASE + staging PASS + policy |
| PRODUCTION_DEPLOYMENT / VALIDATION | Deploy, then verify the real app (health, HTML, assets, routes, API, headers). Failure → DEGRADED, rollback to the last healthy release, SEV2 incident, CTO/CEO/SRE notified; no redeploy loop | — |
| MONITORING | Probes every 30s; N consecutive healthy probes → CEO completion report | COMPLETED requires `PRODUCTION` checks PASS |

## Gate reviews

`EngineCore.gateStep` requests an approval assigned to the gate's role (CEO, or CTO for architecture) and creates a review task for that executive, excluding the author. The executive's verdict is applied through `ApprovalService.decide`, which verifies role, authority and independence. A revision request creates a new author round. After `maxReviewRounds` the approval is reassigned to the Owner. An approval older than the current deliverable does not count.

## Bounded loops

| Loop | Limit | On exhaustion |
|---|---|---|
| Research rounds | `maxResearchRounds` (2) | Synthesize with remaining uncertainty |
| Critique / gate rounds | `maxReviewRounds` (2) | Owner decides |
| Agent retries on Kiro | `maxAgentRetries` (2) | Fallback policy, or pause |
| Failed task re-attempts | `maxTaskRevisions` (2) | Escalation to the Owner |
| Fix loop (build/review/QA/security/staging) | `maxFixAttempts` (2) engineers, +1 lead | CTO escalation to the Owner (approve = accept risk, revise = one more attempt with guidance, reject = pause) |

After a fix merges, the project re-enters INTEGRATION with a new cycle number, so every downstream check runs again on the fixed code.

## Explainable progress

`ProjectService.progress` computes ten weighted groups. A group is 100% when its gate is approved or the phase has passed, 0% and locked before it starts, and otherwise the mean step-progress of its tasks (capped at 95% until the gate passes). Every group carries a text explanation. Health signals come only from blocked/failed tasks, failed check runs, open incidents and pending decisions.
