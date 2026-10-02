# Security

## Owner access

- One Owner account; password hashed with scrypt (N=16384). Sessions use 32-byte random tokens; only their SHA-256 is stored. The cookie is `httpOnly`, `SameSite=Strict`, 7-day TTL.
- Every `/api` route except setup, login and health requires a session. Login is rate-limited (5 failures per IP → 15-minute lockout) and failures are audited.
- CSRF: state-changing requests must carry `x-aco-csrf: 1`. CORS is not enabled, so cross-site pages cannot send that header.
- Setup can run only once (409 afterwards).
- The control plane binds to `127.0.0.1` by default. **It is designed for local, single-owner use.** If you expose it on a network, put it behind TLS and set the cookie `secure` flag (`api/auth.ts`).

## Agent least privilege (`kiro/policy.ts`)

Every Kiro tool call arrives as an ACP permission request and is decided — and audited — by the policy engine:

- Paths must resolve inside the task's workspace (scratch directory, own git worktree, or disposable QA checkout). Company data, secrets, the Kiro home and the database are always forbidden.
- Writes need the `canWriteCode` capability and may not touch `.git/` or real `.env*` files.
- Direct agent shell execution is denied, including npm scripts and interpreters. Profiles no longer expose shell tools. Generated application installation, builds, tests, audits and servers run in Docker Linux containers; the platform has no native-host execution fallback.
- Web needs `canWeb`. `web_fetch` cannot reach localhost or private/link-local networks, which protects the control plane and cloud metadata endpoints.
- Unknown tools are denied.

Researchers cannot modify code, frontend engineers have no production credentials (agents never receive secrets), and deployment is performed by the platform, not by agents.

## Secrets

AES-256-GCM, master key outside the database, masked display, write-only API. `lib/redact.ts` removes common key formats, bearer tokens and `password=`-style values from audit details, events, prompts, run output and check details.

## Destructive operations

Production deploy, external publishing, force pushes and similar actions are not available to agents. Production deploy runs only through the release gates and the Owner's deployment policy. Owner-configured `COMMAND` deploy commands are the one place a shell string runs, because the Owner configured it explicitly.

## Generated applications

The QA and security stages scan for committed secrets and `.env` files, run `npm audit` (production dependencies), check security headers on the running app, and include an AppSec review for access control, injection, XSS, CSRF, input validation and logging.

## Known limitations

- No HTTPS termination built in (local use).
- Kiro native file tools still run under the OS user and depend on ACP permission mediation. Paths reject symlink/junction ancestors and Windows device/stream aliases. This is not an OS sandbox for the entire Kiro process: use a dedicated VM for untrusted CLI binaries and protection against filesystem races. Generated code is isolated separately in Docker.
- Production migrations of generated apps follow the application's own scripts; there is no automated backup step yet beyond per-environment data directories.

## Generated-code execution boundary (2026-10-03)

- The company process does not execute generated npm scripts on the host. Docker is mandatory; an unavailable engine blocks the operation with an actionable error.
- Containers mount only the application workspace and, for servers, that environment's data directory. Git metadata is masked read-only. The host Docker socket and company database/secrets are never mounted.
- Containers drop capabilities, use no-new-privileges, a read-only root filesystem, and PID/memory/CPU limits. The mounted application workspace remains writable so builds can produce outputs.
- Build/test containers have no network. Install/audit containers use registry networking; installs use --ignore-scripts. Dependencies that require lifecycle scripts must be handled deliberately; do not disable isolation to work around them.
- Running applications use an internal Docker network. A separate trusted TCP proxy, with no project/data mounts, publishes their ports only on 127.0.0.1 and forwards only to the designated application. Generated code has no external network attachment. The application must bind to process.env.HOST (0.0.0.0 inside its container). Containers on this shared internal network can reach each other; it is not tenant isolation.
- Kiro inherits only launch-related environment variables plus its own optional KIRO_API_KEY. Generated applications do not inherit host provider keys, DATABASE_URL, ACO_MASTER_KEY or NODE_OPTIONS.
- The optional COMMAND deployment adapter remains an explicitly Owner-configured, trusted host command. It is not a sandbox for arbitrary generated scripts. Review its command before enabling that provider.
- Invalid/incomplete audit output, audit timeouts, missing required lockfiles, and audit errors block security checks. They are no longer silently skipped.
