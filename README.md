# AI Startup Company OS

A local, full-stack operating system for a virtual software company. One human is the **Owner**; 111 AI employees in 10 departments do the work. **Kiro CLI is the primary intelligence** — every employee runs as a Kiro custom agent through `kiro-cli acp`. External AI APIs are optional, policy-gated **fallback only**.

The Owner gives a goal ("CEO, build a booking site for barbershops…"). The CEO agent turns it into a project, and the workflow engine drives it through Research → Product → Design → Architecture → Engineering → Code review → QA → Security → Performance → Release candidate → Staging → Staging validation → Release board → Owner approval → Production → Production validation → Monitoring → Completion. Gates are enforced by the backend against database state, not by prompts.

## Quick start

Requirements: Node.js ≥ 22.5, git, Kiro CLI (`kiro-cli login` done). Docker Desktop with Linux containers is required for generated application builds, tests and deployment. No PostgreSQL server needed — an embedded PostgreSQL (PGlite) is used unless `DATABASE_URL` is set.

```powershell
npm install
npm run build            # typecheck server + build web console
npm start                # control plane on :4100, web console on :3000
```

Open http://localhost:3000 and complete the setup wizard (company, Owner account, Kiro detection, policies). On launch the organization and 85 Kiro agent profiles are installed.

Development mode with reload: `npm run dev`. Tests: `npm test`.

## Repository layout

| Path | Contents |
|---|---|
| `server/` | Control plane (Fastify, TypeScript, Drizzle ORM). Kiro runtime, workflow engine, services, REST + SSE API |
| `server/drizzle/` | SQL migrations |
| `server/test/` | Vitest unit + integration tests |
| `web/` | Owner console (Next.js 16, React 19, Tailwind 4) |
| `scripts/` | ACP probe, API smoke test, CEO command helper, isolated test-server launchers |
| `data/` | Runtime state (gitignored): database, isolated Kiro home, project repos, deployments, master key |
| `docs/` | Architecture and operations documentation |

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Kiro runtime](docs/KIRO_RUNTIME.md) · [Agent system](docs/AGENT_SYSTEM.md) · [Workflow engine](docs/WORKFLOW_ENGINE.md) · [Project system](docs/PROJECT_SYSTEM.md) · [Deployment](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md) · [Fallback AI](docs/FALLBACK_AI.md) · [Database](docs/DATABASE.md) · [Testing](docs/TESTING.md) · [Owner guide](docs/OWNER_GUIDE.md) · [Development](docs/DEVELOPMENT.md) · [ADRs](docs/adr/)

## Current status

See [docs/TESTING.md](docs/TESTING.md#verification-status) for exactly what has been verified and what has not.

## Verification and safe execution

Generated application execution requires Docker Desktop in Linux-container mode (or Docker Engine on Linux). If unavailable, the console reports the missing sandbox and generated builds/deployments are blocked. Agent shell tools are disabled; the platform executes application scripts in containers.

Run npm test, npm run build, npm run test:e2e and npm run test:docker. Install browser binaries first with npx playwright install chromium. The Docker suite uses a deterministic application fixture; it does not prove live AI delivery. See docs/TESTING.md for verified and outstanding acceptance checks.

Runtime data, credentials, process logs and compiler caches are excluded from Git. Configure your own Owner account through setup; operational scripts read its password from ACO_PASS.
