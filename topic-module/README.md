
# KiBrain Topic-Module (add-on service skeleton, step 1)

Thematic cataloguing add-on for Brain. This folder is the module's own
service; it does not modify the Brain core. Skeleton only — no business
logic, no data model yet.

## Commands (run inside `topic-module/`)

```bash
pnpm install
pnpm check   # ESLint
pnpm test    # Vitest (start test, /health test, config loader)
pnpm build   # TypeScript build to dist/
pnpm dev     # tsx watch src/index.ts
```

## Configuration

All values via ENV (see `.env.example`): DB connection data (`DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), `PORT`,
`BRAIN_API_BASE_URL`. No secrets in code.

## Health

`GET /health` → `200 {"status":"ok"}` (dependency-free; used for uptime
monitoring in production).

## Docker/Compose

`docker compose up` starts the module service together with its own MySQL
instance/schema (`kibrain_topic_dev`, host port 3307) — the module never
shares the Brain database.