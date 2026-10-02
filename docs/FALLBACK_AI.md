# Fallback AI

Kiro is the primary runtime. A fallback provider runs a task **only** when one of these triggers fires:

| Trigger | Cause |
|---|---|
| `KIRO_RATE_LIMITED` | Throttling after retries |
| `KIRO_USAGE_LIMIT_REACHED` | Usage/quota limit or the Owner's daily credit budget |
| `KIRO_TEMPORARILY_UNAVAILABLE` | Not installed, not authenticated, service outage |
| `KIRO_PROCESS_ERROR` | ACP process crashed |
| `KIRO_TIMEOUT_AFTER_RETRIES` | Turn timeouts exhausted retries |
| `USER_FORCED_FALLBACK` | Owner explicitly approved fallback for a task |

Refusals, cancellations and configuration bugs never trigger fallback.

## Modes (Settings → AI Runtime)

- **ASK OWNER** (default): the task is paused (`BLOCKED`, reason `RUNTIME: …`) and a `FALLBACK_USAGE` approval is created for the Owner with the reason, impact and cost. On approval the task resumes on the fallback provider. If Kiro recovers first, the task resumes on Kiro.
- **AUTO**: the task runs on the highest-priority enabled connection, then the next one if that fails.
- **DISABLED**: the task is paused until Kiro is available.

Fallback must also be switched on (`fallbackEnabled`) and have at least one usable connection; otherwise tasks pause. Nothing switches silently. Every fallback run is an `agent_runs` row with `runtime=FALLBACK`, provider, model, `fallbackReason`, task, employee, duration and cost (marked *estimated* when no pricing is configured). A `FALLBACK_ACTIVATED` event and an audit entry are emitted, and the console shows a banner while fallback runs.

## Providers

OpenRouter, OpenAI, Anthropic, Google Gemini, any OpenAI-compatible endpoint, and Ollama. All calls go from the backend via `fetch`; the browser never sees keys. Fallback models have no tools. Engineering stages ask the model to return complete files in its JSON result, and the backend writes them inside the task worktree under the same boundary rules (no paths outside the workspace, no `.git`, no real `.env`).

## Keys

Keys are encrypted with AES-256-GCM using a master key held outside the database (`ACO_MASTER_KEY` or `data/secrets/master.key`, created on first use). API responses carry only the masked form (`sk-or-••••••••••7F91`). Keys are redacted from logs, audit entries, prompts and run output. A connection test sends a real minimal prompt and records the health.

## Not verified

No real external provider has been called with a real key during development. The adapters follow each provider's public API shape, and the AUTO path was tested against an unreachable endpoint (failure recorded correctly).
