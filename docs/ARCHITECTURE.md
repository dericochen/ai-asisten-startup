# Architecture

```
Owner (browser)
   │  same-origin HTTPS/HTTP, httpOnly session cookie, CSRF header
   ▼
Web console (Next.js, web/)  ── /api/* proxied ──►  Control plane (Fastify, server/)
                                                     │
        ┌──────────────────────────┬─────────────────┼───────────────────┬──────────────────┐
        ▼                          ▼                 ▼                   ▼                  ▼
  PostgreSQL (PGlite or PG)   Workflow engine   KiroRuntimeManager   Fallback gateway   Git / deploy adapters
  source of truth              (tick loop)       pool of `kiro-cli acp`  (backend only)   project repos, local
                                                 processes, JSON-RPC                       process hosting
                                                     │
                                                     ▼
                                          Kiro custom agents (aco-<role>)
                                          in an isolated KIRO_HOME
```

## Principles

- **Database is the source of truth.** Kiro conversations are execution, never state. Agents return a Markdown deliverable plus a JSON result block; the platform validates it and performs the state change (artifact, approval decision, check result) through a service that enforces authority and workflow rules.
- **Each subsystem owns its truth.** Postgres: company/project state. Git: source code. Deployment adapter + our own probes: deployment state. Kiro: reasoning/work. Monitoring samples: production health.
- **Gates are code.** `WorkflowGuard` evaluates entry requirements for every phase from approvals, check runs and releases. `ProjectService.enterPhase` is the only way to change phase; `TaskService.create/start` refuse engineering stages while `ENGINEERING_IMPLEMENTATION_LOCKED`.
- **Bounded loops.** Every critique, review, retry, revision and fix loop has a configurable limit; exhaustion escalates (lead → CTO → Owner) instead of looping.
- **Least privilege.** Every Kiro tool call is surfaced as an ACP permission request and decided by a policy engine scoped to the agent's role and workspace.

## Server modules (`server/src`)

| Module | Responsibility |
|---|---|
| `db/` | Drizzle schema, PGlite / node-postgres client, migrations |
| `core/events.ts` | EventBus (persisted events + SSE fan-out), AuditService, sequential codes |
| `core/container.ts` | Service wiring and cached Owner policies |
| `org/` | Organization definition (departments, roles, authority, capabilities) and OrganizationService |
| `kiro/` | ACP client, runtime manager (pool, queue, health/limits), permission policy, error classification, agent profile generator |
| `fallback/` | Provider adapters (OpenRouter/OpenAI/compatible/Ollama, Anthropic, Gemini), encrypted connections |
| `services/` | Approvals, tasks, projects, executor (Kiro-first routing), quality checks, deployment/monitoring/incidents, git, CEO commands, records (artifacts, decisions, meetings, messages, notifications, memory) |
| `workflow/` | Phases and gate requirements, guard, stage runner, prompts, planning and delivery phase handlers, engine loop |
| `api/` | Auth, company, project and runtime routes |

The service names in the spec map as follows: OrganizationService/AgentRegistry → `org/service.ts` + `kiro/agents.ts`; WorkflowService → `workflow/*`; KiroRuntimeService → `kiro/runtime.ts`; FallbackAIService → `fallback/*` + `services/executor.ts`; QAService/SecurityService → `services/quality.ts` + stages; DeploymentService/EnvironmentService/MonitoringService → `services/deploy.ts`; MemoryService/MessageService/MeetingService/DecisionService/ArtifactService/NotificationService → `services/records.ts`.

## Realtime

Every state change emits an event (`PROJECT_PHASE_CHANGED`, `TASK_STARTED`, `KIRO_WORKER_ALLOCATED`, `FALLBACK_ACTIVATED`, `STAGING_DEPLOYED`, …). Events are persisted (timeline, activity) and streamed over SSE at `/api/stream`. Token streaming (`AGENT_ACTIVITY`) is broadcast but not persisted.

## Desktop readiness

The control plane is a single Node process with an embedded database and no external services, and the console talks to it over HTTP. Packaging with Tauri or Electron means bundling Node, starting the server as a sidecar and pointing a webview at the console. Nothing in the architecture prevents this; it is not implemented.
