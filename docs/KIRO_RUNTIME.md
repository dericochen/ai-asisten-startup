# Kiro runtime

Kiro CLI is the primary runtime. The integration was built against behaviour **observed** from kiro-cli 2.27.0 (`scripts/acp-probe.mjs`), not assumed.

## Protocol (JSON-RPC 2.0 over stdio, `kiro-cli acp`)

| Step | Message | Notes |
|---|---|---|
| Handshake | `initialize {protocolVersion:1, clientCapabilities:{fs:{readTextFile:false,writeTextFile:false}, terminal:false}}` | Returns `agentInfo.version`. We advertise no fs/terminal, so Kiro uses its own tools and asks permission. |
| Session | `session/new {cwd, mcpServers:[]}` → `{sessionId, modes.availableModes[]}` | `cwd` = the agent's workspace (scratch dir, worktree, or QA checkout). |
| Agent selection | `session/set_mode {sessionId, modeId:"aco-<role>"}` | Modes are the agent profiles in `KIRO_HOME/agents`. |
| Work | `session/prompt {sessionId, prompt:[{type:"text",text}]}` → `{stopReason}` | Resolves at end of turn. |
| Streaming | `session/update` with `agent_message_chunk`, `tool_call`, `tool_call_update` | Text is streamed into `agent_runs.output` and SSE. |
| Tool names | `_kiro.dev/session/update` `tool_call_chunk {toolCallId, title=<tool name>}` | Used to map permission requests to tools. |
| Usage | `_kiro.dev/metadata {meteringUsage:[{value,unit:"credit"}], turnDurationMs}` | Credits recorded per run. |
| Permissions | agent → client request `session/request_permission {toolCall, options[allow_once, allow_always, reject_once]}` | Answered with `allow_once` / `reject_once` by the policy engine. Never `allow_always`. |
| Cancel | `session/cancel {sessionId}` notification | Used on turn timeout. |

## Isolation

The company runs Kiro with `KIRO_HOME=data/kiro-home`. Profiles `aco-<role>.json` are generated from the org definition (`kiro/agents.ts`) and never mix with the Owner's personal agents. Each profile sets `tools` to the role's capability list and `allowedTools: []`, so every non-trivial tool call goes through the company's permission policy and is audited.

Probing showed that the model ignores unusual persona directives in agent prompts (for example "start every reply with X"). Profile prompts are therefore role descriptions and working standards. Per-task output contracts live in the task prompt, which the model follows reliably.

## KiroRuntimeManager (`kiro/runtime.ts`)

- **Detection**: `kiro-cli --version` and `kiro-cli whoami` (retry on transient failure; re-detected every 5 minutes and before a job if detection is stale).
- **Worker pool**: default 4 `kiro-cli acp` processes, configurable 1–20. 111 employees share the pool. Workers start on demand, hold multiple sessions, and are recycled after 25 jobs. Sessions are per task and dropped after the turn (a repair turn reuses the same session via session affinity).
- **Queue**: in-memory FIFO; continuation turns jump the queue. The durable queue is the `tasks` table — after a restart, interrupted runs are marked failed and their tasks re-queued.
- **Timeouts**: per-turn timeout (default 25 min) → `session/cancel`, then the worker is killed.
- **Error classification** (`kiro/errors.ts`): `RATE_LIMITED`, `USAGE_LIMIT`, `AUTH`, `UNAVAILABLE`, `PROCESS_ERROR`, `TIMEOUT`, `NOT_INSTALLED`, `AGENT_PROFILE`, `REFUSED`, `CANCELLED`, `UNKNOWN` — from JSON-RPC errors and the stderr tail.
- **Health states**: `HEALTHY`, `NEAR_LIMIT` (daily credit budget ≥ ratio), `LIMITED` (usage/rate limit or budget reached, with cooldown), `UNAVAILABLE` (auth missing or ≥3 consecutive failures). While LIMITED/UNAVAILABLE no new Kiro jobs start and the fallback policy applies. When the cooldown elapses, Kiro is retried automatically. Completed fallback tasks are never re-run.
- **Retries**: retryable classes are retried up to `maxAgentRetries` with backoff. Usage limits are not retried.

## Observability

Settings → AI Runtime shows status, authentication, executable, version, active sessions, running agents, queued jobs, health, last successful run, failure rate, worker table, credits today and recent runs. Each task page shows its runs, streamed output, and every tool call with the policy decision and reason.

## Not verified

Real rate-limit and usage-limit responses from Kiro have not been observed. The classifier patterns are based on common wording, and the limit and fallback logic is covered by tests that simulate an unavailable Kiro.
