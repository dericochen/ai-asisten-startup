# Fallback AI

Kiro is the default primary runtime. In AI Runtime, the Owner can instead select **Connected providers** as the primary AI; enabled connections are then used directly in priority order. When Kiro remains primary, fallback uses these triggers:

| Trigger | Cause |
|---|---|
| `KIRO_RATE_LIMITED` | Throttling after retries |
| `KIRO_USAGE_LIMIT_REACHED` | Usage/quota limit or the Owner's daily credit budget |
| `KIRO_TEMPORARILY_UNAVAILABLE` | Not installed, not authenticated, service outage |
| `KIRO_PROCESS_ERROR` | ACP process crashed |
| `KIRO_TIMEOUT_AFTER_RETRIES` | Turn timeouts exhausted retries |
| `USER_FORCED_FALLBACK` | Owner selected connected providers as primary AI |

Refusals, cancellations and configuration bugs never trigger fallback.

## Modes (Settings → AI Runtime)

- **ASK OWNER** (default): the task is paused (`BLOCKED`, reason `RUNTIME: …`) and a `FALLBACK_USAGE` approval is created for the Owner with the reason, impact and cost. On approval the task resumes on the fallback provider. If Kiro recovers first, the task resumes on Kiro.
- **AUTO**: the task runs on the highest-priority enabled connection, then the next one if that fails.
- **DISABLED**: the task is paused until Kiro is available.

When Kiro is primary, fallback must also be switched on (`fallbackEnabled`) and have at least one usable connection; otherwise tasks pause. Nothing switches silently. Every fallback run is an `agent_runs` row with `runtime=FALLBACK`, provider, model, `fallbackReason`, task, employee, duration and cost (marked *estimated* when no pricing is configured). A `FALLBACK_ACTIVATED` event and an audit entry are emitted, and the console shows a banner while fallback runs.

## Providers

9Router, OpenRouter, OpenAI, Anthropic, Google Gemini, any OpenAI-compatible endpoint, and Ollama. All calls go from the backend via `fetch`; the browser never sees keys. Fallback models have no tools. Engineering stages ask the model to return complete files in its JSON result, and the backend writes them inside the task worktree under the same boundary rules (no paths outside the workspace, no `.git`, no real `.env`).

## Keys

Keys are encrypted with AES-256-GCM using a master key held outside the database (`ACO_MASTER_KEY` or `data/secrets/master.key`, created on first use). API responses carry only the masked form (`sk-or-••••••••••7F91`). Keys are redacted from logs, audit entries, prompts and run output. A connection test sends a real minimal prompt and records the health.

## Not verified

No real external provider has been called with a real key during development. The 9Router/OpenRouter adapters are covered by real HTTP tests against a local fixture. Browser tests cover adding both providers, listing models, testing connections, editing with the stored key, selecting provider-primary mode, and a CEO response through the router fixture. Real upstream accounts and quotas still require the Owner's own credentials.

## Configure 9Router or OpenRouter

1. Open AI Runtime → Add connection.
2. Select 9Router or OpenRouter. For local 9Router the default is http://localhost:20128/v1; start 9Router separately and connect its upstream account first. For OpenRouter the default is https://openrouter.ai/api/v1.
3. Enter the router API key if authentication is enabled (OpenRouter requires one). Keep keys in this form, not in Git or chat. A custom base URL is supported, including a remote 9Router instance.
4. Select Load models, then choose or type an exact model ID. Set priority 1 for your first choice, 2 for a backup, etc. Save the connection and click Test. The test sends a small actual model request and can consume provider quota.
5. To use it immediately without Kiro, select Primary AI → Connected providers. This explicit choice uses enabled connections in priority order even if Kiro fallback is disabled. Keep Primary AI → Kiro CLI if the connection should only serve as backup.
6. Use Edit to change model, endpoint, priority or key. Leaving the key blank preserves it. Loading models while editing can use the stored encrypted key without returning it to the browser.

Provider-primary calls generate text or file blocks; they do not gain Kiro filesystem, shell or web tools. Generated application execution still uses Docker, and deployment approvals remain enforced. The database uses text provider identifiers and JSON policies, so existing databases do not require a destructive migration.

References: [9Router integration documentation](https://github.com/decolua/9router/blob/master/gitbook/content/en/integration/other-tools.md), [OpenRouter quickstart](https://openrouter.ai/docs/quickstart).
