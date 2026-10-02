# Architecture Decision Records

## ADR-001 — Kiro CLI over ACP as the primary runtime
**Decision**: Drive Kiro through `kiro-cli acp` (JSON-RPC over stdio) with one custom agent profile per role, instead of shelling out to `kiro-cli chat --no-interactive` or calling model APIs.
**Reason**: ACP gives streaming, structured tool-call events, per-call permission requests (needed for least privilege and audit), agent selection via `session/set_mode`, multiple sessions per process and credit metadata. Verified with `scripts/acp-probe.mjs`.
**Consequences**: The protocol shapes we depend on are documented in KIRO_RUNTIME.md; a Kiro upgrade that changes them requires re-probing.

## ADR-002 — PostgreSQL via Drizzle; embedded PGlite by default
**Decision**: Drizzle ORM over PostgreSQL. With no `DATABASE_URL`, use PGlite (PostgreSQL compiled to WASM) persisted on disk.
**Reason**: The spec requires PostgreSQL as the source of truth, and the target machine has neither Docker nor a PostgreSQL server. PGlite keeps one-command local start while staying PostgreSQL (same SQL, migrations and full-text search). Drizzle was chosen over Prisma to avoid a native query engine and keep a single TypeScript schema for both drivers.
**Alternatives**: Prisma (heavier, native engine), SQLite (not PostgreSQL).

## ADR-003 — The workflow engine is a pure function of database state
**Decision**: A tick loop evaluates each active project's phase and creates/advances work from DB state only; gates are evaluated by `WorkflowGuard`.
**Reason**: Restart-safe, idempotent and auditable; makes gate enforcement independent of prompts.

## ADR-004 — Agents report, the platform acts
**Decision**: Agents return Markdown and a JSON result; services perform every state change (approvals via `ApprovalService.decide`, which checks authority and independence).
**Reason**: "Kiro conversation is not the company database." Prevents prompt-level bypass of gates.

## ADR-005 — Local-process deployment adapter plus a command adapter
**Decision**: Ship a fully verifiable `LOCAL_PROCESS` adapter and a generic `COMMAND` adapter for real hosts, both validated by our own HTTP checks.
**Reason**: Real end-to-end deployment must work offline on the Owner's machine. Provider-specific adapters can be added without changing the release flow.

## ADR-006 — Company runtime contract for generated apps
**Decision**: Generated projects must be Node.js apps with `start`/`test`/`build` scripts, `PORT`, `GET /api/health`, `DATA_DIR` and security headers.
**Reason**: Allows automated QA, staging, production validation and monitoring for every project without per-project scripting. The architecture team still chooses the stack within the contract.
