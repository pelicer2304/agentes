# Deployment Guide (EasyPanel)

This guide covers deploying the WhatsApp + Evolution production integration to
[EasyPanel](https://easypanel.io/). The stack consists of three core services
plus one optional service:

| Service    | Purpose                                            | Port (container) |
| ---------- | -------------------------------------------------- | ---------------- |
| `api`      | NestJS API. Runs DB migrations on start, then boots | 3001             |
| `web`      | Built React (Vite) frontend served as static files | 3000             |
| `evolution-api` | Evolution API WhatsApp gateway                | 8080             |
| `postgres` | PostgreSQL 16 (databases: `decodifica` + `evolution`) | 5432          |
| `redis`    | Shared cache (Evolution + app rate limiter)        | 6379             |

The reference `docker-compose.yml` at the repo root builds and wires all
services. EasyPanel can consume the compose file directly or you can model each
service individually in the EasyPanel UI.

### Internal service wiring

All services share the compose network and address each other by service name:

- The **app** reaches Evolution at `http://evolution-api:8080` (`EVOLUTION_API_URL`).
- **Evolution's global webhook** posts inbound events to the app at
  `http://api:3001/webhooks/evolution` (configured via `WEBHOOK_GLOBAL_URL` in
  the compose file — no manual setup needed).
- Both the app (`decodifica` DB) and Evolution (`evolution` DB) use the shared
  `postgres` service; the `evolution` database is created automatically on first
  volume init by `infra/postgres/init/01-create-evolution-db.sql`.
- The `EVOLUTION_API_KEY` is shared: the app sends it as the `apikey` header and
  Evolution validates against the same value (`AUTHENTICATION_API_KEY`).

---

## 1. Environment variables

All environment variables are validated by the API on startup
(`apps/api/src/config/config.schema.ts`). **Startup halts on the first missing
or invalid required variable** and reports that variable's name, before the HTTP
port is bound.

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

### Required variables

| Variable                  | Required | Default                       | Notes |
| ------------------------- | -------- | ----------------------------- | ----- |
| `DATABASE_URL`            | yes      | compose builds from POSTGRES_* | PostgreSQL connection string |
| `APP_ENV`                 | yes      | —                             | `development` \| `staging` \| `production` |
| `FRONTEND_URL`            | yes      | —                             | Frontend origin for CORS (web domain) |
| `PUBLIC_API_URL`          | yes      | —                             | Public base URL of the api (api domain). See webhook note below |
| `JWT_SECRET`              | yes      | —                             | Min 16 chars; use a long random value |
| `LLM_PROVIDER`            | no       | `openrouter`                  | `openrouter` \| `openai` |
| `OPENROUTER_API_KEY`      | conditional | —                          | Required when `LLM_PROVIDER=openrouter` |
| `OPENROUTER_BASE_URL`     | no       | —                             | Optional OpenRouter base URL override |
| `OPENAI_API_KEY`          | conditional | —                          | Required when `LLM_PROVIDER=openai` |
| `MODEL_NAME`              | no       | `gpt-4o-mini`                 | Primary model |
| `LLM_MODEL_FALLBACK`      | no       | `google/gemini-2.5-flash`     | Fallback model |
| `EVOLUTION_API_URL`       | yes      | —                             | Evolution API base URL |
| `EVOLUTION_API_KEY`       | yes      | —                             | Sent server-side only; scrubbed to `***` in logs |
| `EVOLUTION_INSTANCE_NAME` | yes      | —                             | Evolution instance name |
| `EVOLUTION_WEBHOOK_SECRET`| no       | —                             | When set, inbound webhooks must match (else 401) |
| `BOT_AUTO_REPLY_ENABLED`  | no       | `true`                        | Master auto-reply switch |
| `BOT_PAUSE_ON_HANDOFF`    | no       | `true`                        | Pause bot when handoff accepted |
| `ADMIN_WHATSAPP_NUMBERS`  | no       | (empty)                       | Comma-separated admin numbers for handoff summary |
| `PRICING_RANGE_ENABLED`   | no       | `true`                        | Price replies use starting-at range |
| `PRICING_STARTING_AT`     | no       | `2500`                        | Number 0–999999999.99 |
| `PRICING_TEXT`            | no       | (empty)                       | Optional custom pricing text |

### Compose-only variables

These configure the bundled `postgres` service and host port mappings:

| Variable          | Default      | Notes |
| ----------------- | ------------ | ----- |
| `POSTGRES_USER`   | `postgres`   | Used to build the default `DATABASE_URL` |
| `POSTGRES_PASSWORD` | `postgres` | Change for production |
| `POSTGRES_DB`     | `decodifica` | Database name |
| `API_PORT`        | `3001`       | Host port mapped to the api container |
| `WEB_PORT`        | `3000`       | Host port mapped to the web container |

---

## 2. Evolution webhook URL

The Evolution webhook URL is **derived** from `PUBLIC_API_URL` by appending
`/webhooks/evolution`:

```
webhook URL = PUBLIC_API_URL + /webhooks/evolution
```

For example, with `PUBLIC_API_URL=https://api.example.com`:

```
https://api.example.com/webhooks/evolution
```

This is the URL the API registers with Evolution via the admin
`set-webhook` action (and `EvolutionService.setWebhook`). You do not configure
the webhook URL separately — set `PUBLIC_API_URL` correctly and the rest
follows. If `EVOLUTION_WEBHOOK_SECRET` is set, Evolution must send a matching
secret or inbound requests are rejected with `401`.

---

## 3. Healthchecks

Both the API and the database define healthchecks in `docker-compose.yml`:

- **API**: `wget -qO- http://localhost:3001/health` against `GET /health`,
  which returns `{ status, database, evolutionConfigured, llmConfigured }`. The
  base image (`node:20-alpine`) ships busybox `wget`, so no extra package is
  required. A `start_period` of 60s allows `prisma migrate deploy` plus Nest
  boot before failures are counted.
- **Database**: `pg_isready` against the configured user/database.

The `web` service waits for the `api` service to become healthy
(`depends_on: api: condition: service_healthy`), and the `api` waits for a
healthy `postgres`.

---

## 4. EasyPanel deployment steps

1. **Create the project** in EasyPanel and connect this repository (or push the
   built images).
2. **Provision PostgreSQL** — either use the bundled `postgres` compose service
   or an EasyPanel managed Postgres. If managed, set `DATABASE_URL` to its
   connection string.
3. **Deploy the api service**
   - Build from `apps/api/Dockerfile` (context = repo root).
   - Set all required environment variables from the table above.
   - Assign the **api domain** (e.g. `api.example.com`) and set
     `PUBLIC_API_URL` to that same public URL.
   - The container listens on `3001`; map the domain to that port.
   - The start command runs `prisma migrate deploy` then boots the app.
4. **Deploy the web service**
   - Build from `apps/web/Dockerfile` (context = repo root).
   - Assign the **frontend domain** (e.g. `app.example.com`) and set
     `FRONTEND_URL` to that same public URL (used for CORS).
   - The container listens on `3000`.
5. **Configure the public webhook URL** — ensure `PUBLIC_API_URL` is the
   publicly reachable api domain. Then, from the WhatsApp admin screen (or via
   `POST /channels/evolution/set-webhook`), register the webhook. Evolution will
   call `PUBLIC_API_URL + /webhooks/evolution`.
6. **Verify health** — confirm the api healthcheck passes (`GET /health`
   returns `status: ok`, `database: healthy`, and the `evolutionConfigured` /
   `llmConfigured` flags are `true`).
7. **(Optional) Enable redis** — start the optional cache/queue with the
   `with-redis` profile:

   ```bash
   docker compose --profile with-redis up -d
   ```

---

## 5. Local validation

Validate the compose file before deploying:

```bash
docker compose config -q
```

Bring the stack up locally:

```bash
cp .env.example .env   # then edit values
docker compose up --build
```
