# Deployment

## Adapters

| Provider | What it does | Status |
|---|---|---|
| `LOCAL_PROCESS` (default) | Checks out the release tag into `data/deploy/<PRJ>/<env>/v<version>`, runs `npm ci/install` and `npm run build`, starts `npm start` with `PORT` and `DATA_DIR`, and waits for the health endpoint. Staging uses port 4300+N, production 4500+N. | Implemented |
| `COMMAND` | Runs Owner-configured deploy commands (e.g. `vercel deploy --prod --token …`, `docker compose up -d`, an SSH script) in a checkout of the release, with `RELEASE_VERSION`/`RELEASE_COMMIT` set, then verifies the configured URL with the same checks. | Implemented, not exercised against a real provider |

Configure per project via `PUT /api/projects/:id/deployment`. Docker, VPS, Vercel, Render, Railway and Cloudflare are reached through `COMMAND` today. Native API adapters are not implemented.

## Required flow (enforced)

Development → code review PASS → QA PASS → security PASS → performance → release candidate (develop → main, tag) → staging deploy → staging validation → release board GO → CEO release approval → deployment policy (Owner approval by default) → production deploy → production validation → monitoring → completion.

## Deployment policy

`OWNER_APPROVAL` (default), `CEO_APPROVAL`, `AUTO_AFTER_CHECKS`, or `MANUAL`. Every mode still requires all checks and the CEO release approval.

## Verification, not trust

A deployment is HEALTHY only after our own checks pass against the deployed URL: health endpoint 200, homepage HTML, local assets load, every contract route loads, every architect-defined API check returns the expected status, and security headers are present.

If production validation fails: the release is marked DEGRADED, production rolls back to the previous HEALTHY release (or is stopped if none exists), a SEV2 incident opens, CTO/CEO/SRE are messaged and the Owner is notified. There is no automatic redeploy loop — fixes go back through the full pipeline.

## Monitoring

Every active production deployment is probed every 30s (configurable). Three consecutive failures open a SEV2 incident. Monitoring keeps running after completion. Local deployments are restarted automatically when the company OS restarts.

## Not implemented

Browser automation (Playwright screenshots, console-error capture, form filling) is not included. Validation is HTTP-level only. SSL and domain checks apply only to COMMAND deployments with real URLs and are not implemented as separate checks.

## Local deployment prerequisites and recovery

LOCAL_PROCESS retains its API name for compatibility but now runs applications in Docker Linux containers. Start Docker Desktop on Windows, then run docker pull node:24-bookworm-slim. ACO_SANDBOX_IMAGE may select an Owner-managed compatible Node image (pin a digest for reproducible production use).

Startup requires an HTTP 200 response from the configured health endpoint. Replacing a release can temporarily interrupt its port; this is not zero-downtime deployment. Recovery selects a previously healthy release independently of whether its former process is STOPPED. If a replacement fails after stopping the old application, recovery is attempted automatically. A failed recovery is not reported as a successful rollback.

Run npm run test:docker for a real fixture application through build/test, staging, production, HTTP/security validation, monitoring and rollback. This test creates temporary repositories and an in-memory database; it does not operate on company projects. It does not simulate a successful live Kiro research/engineering run.
