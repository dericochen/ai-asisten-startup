# Development

```powershell
npm install
npm run dev          # server (tsx watch, :4100) + web (next dev, :3000)
npm run typecheck
npm test
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ACO_PORT` / `ACO_HOST` | `4100` / `127.0.0.1` | Control plane bind |
| `ACO_DATA_DIR` | `./data` | All runtime state |
| `DATABASE_URL` | — | Use a PostgreSQL server instead of embedded PGlite |
| `ACO_MASTER_KEY` | — | Base64 32-byte key for secret encryption (otherwise `data/secrets/master.key`) |
| `KIRO_CLI_PATH` | `kiro-cli` | Kiro executable |
| `ACO_TICK_MS` | `3000` | Workflow engine interval |
| `ACO_DISABLE_BACKGROUND` | — | `1` disables the engine and monitoring loops |
| `ACO_API_URL` (web, **build time**) | `http://127.0.0.1:4100` | Where the console proxies `/api` |

## Conventions

- All state changes go through services (`server/src/services`, `workflow`); routes stay thin.
- New stages: add a builder to `workflow/prompts.ts`, a definition to `workflow/stages.ts`, and wire it into a phase handler in `planning.ts` / `delivery.ts`. Agent output must end with a JSON block.
- New gates: add to `ENTRY_REQUIREMENTS` in `workflow/phases.ts`, and add a test to `governance.test.ts`.
- New roles: add to `org/definition.ts`. Profiles are regenerated at startup or via "Re-detect Kiro".
- Schema changes: edit `db/schema.ts`, run `npm run db:generate`, and commit the migration.
- Never log secrets; pass free text through `redact`/`redactString` before persisting.
