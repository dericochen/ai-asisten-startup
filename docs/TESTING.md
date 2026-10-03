# Testing

```powershell
npm test                                   # server unit + integration tests (vitest)
node scripts/smoke-api.mjs http://127.0.0.1:4199   # API smoke test against a running instance
node scripts/ceo-ask.mjs "question"        # one real Kiro-backed CEO round trip
node scripts/acp-probe.mjs "prompt" [agent]  # raw ACP protocol probe
```

Run an isolated instance (separate data dir `test-data/`, port 4199) with `scripts\test-server.cmd 4199 1` (background loops off) or `… 4199 0` (workflow engine on).

## Automated tests (`server/test`)

- **unit.test.ts (19)**: permission policy (workspace boundaries, traversal, `.env`/`.git`, destructive shell commands, allowed build commands, role capabilities, SSRF protection), Kiro error classification and fallback trigger mapping, structured-result extraction, AES-GCM encryption/tamper detection, key masking, scrypt, redaction.
- **governance.test.ts (12)**, against in-memory PostgreSQL: organization install and authority levels; engineering lock before approvals (task creation and phase skips are rejected); DESIGN_COMPLETE without CEO approval keeps engineering locked; agents below authority or without the role cannot decide; requesters cannot approve themselves; Owner-only gates reject agents and accept the Owner exactly once; reviewer exclusion; fallback policy for disabled/ASK_OWNER/DISABLED/AUTO (with recorded reason and provider); derived progress.

## Verification status

Verified on Windows 11, Node 24.18, kiro-cli 2.27.0 (Builder ID):

| Area | Evidence |
|---|---|
| ACP protocol | Probe: initialize, session/new, set_mode with custom agents in an isolated KIRO_HOME, prompt streaming, tool calls, permission request rejected → `permission_denied`, credits metadata |
| Control plane API | `smoke-api.mjs`: 21/21 checks (setup, auth, CSRF, 401s, dashboard, system health, org, project + git repo, engineering lock, Kiro status, masked fallback key, timeline, audit without secrets) |
| CEO via Kiro | Owner command → `aco-ceo` profile on a Kiro worker → validated `CREATE_PROJECT` action → project PRJ-003 created |
| Research → Product → Design (real Kiro agents) | PRJ-003: research brief; parallel user/market/competitor research; critic + fact-check forced a revision round; synthesis; CEO gate APPROVED via ApprovalService (authority 90); PRD; product critic forced a PRD revision; CEO product gate APPROVED; design spec; design critique — all as versioned artifacts, events and audit entries |
| Least privilege live | Agents' attempts to read outside their workspace were denied and audited |
| Web console | `next build` (25 routes), pages served, login + dashboard + SSE through the proxy |
| Tests | 31/31 passing |

Not yet verified end to end in this environment: the Architecture → Engineering → QA → Security → Staging → Production → Monitoring stages on a real generated application (the code paths are implemented; the demo run had reached Design at the time of writing), real Kiro rate/usage-limit responses, real external fallback providers, the COMMAND deploy adapter against a real host, and visual review of the UI in a browser. Browser automation was added in the 2026-10-03 regression suite below.

## Regression suite added 2026-10-03

- npm test: 59 passing tests on the local Windows machine, including three new suites for audit failures, startup status codes, deployment replacement/recovery, agent shell denial, junction containment and container configuration.
- npm run build: successful production build and server typecheck.
- npm run test:e2e: Playwright Chromium passed the real Owner setup, project creation, engineering lock, CSRF rejection, anonymous access rejection, logout, invalid-password and successful-login flow. The test uses temporary data, disabled background jobs and an unavailable Kiro fixture, so it incurs no model usage.
- npm run test:docker: an explicit integration suite for real Docker application execution, staging, production, monitoring and rollback. Docker is not installed on the reviewed Windows machine, so live container execution remains unverified locally. It is required in GitHub Actions.
- .github/workflows/verify.yml runs typecheck, unit/integration tests, build, browser tests and Docker delivery tests on Linux. A passing local test suite is not evidence that CI or the real Kiro pipeline has passed.

Install the browser once with npx playwright install chromium. Browser test servers use ports 3199/4198 and separate .next-e2e output. The fixture login is test-only. Operational helper scripts require ACO_PASS; they no longer assume the sample password.

The earlier verification table describes historical runs. Real Kiro Architecture → Engineering → QA → Production → Monitoring and real external fallback providers still need an acceptance run with authenticated Kiro and Docker. No live model run is fabricated by the regression fixtures.

## Router verification

72 backend tests pass after adding 9Router/OpenRouter coverage. The browser flow also verifies model discovery, encrypted-key reuse, both connection types, primary-provider selection and a CEO round trip against a local HTTP fixture. No real provider key or paid upstream request is needed by the tests. The preceding Docker delivery workflow passed in [GitHub Actions](https://github.com/dericochen/ai-asisten-startup/actions/runs/37049300421).
