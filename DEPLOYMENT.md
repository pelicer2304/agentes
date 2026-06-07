# Deployment Guide (EasyPanel)

Deploys the DecodificaIA WhatsApp + Evolution stack to [EasyPanel](https://easypanel.io/).

| Service        | Purpose                                                        | Port (container) | Public domain? |
| -------------- | -------------------------------------------------------------- | ---------------- | -------------- |
| `postgres`     | PostgreSQL 16 — hosts `decodifica` (app) + `evolution` (gateway) | 5432           | no             |
| `redis`        | Shared cache/queue (Evolution + app rate limiting)             | 6379             | no             |
| `evolution-api`| WhatsApp gateway (evoapicloud/evolution-api)                   | 8080             | yes            |
| `api`          | NestJS API. Runs DB migrations on start, then boots            | 3001             | yes            |
| `web`          | Built React (Vite) frontend served as static files            | 3000             | yes            |

The root `docker-compose.yml` builds and wires all five services. EasyPanel can
consume the compose file directly (Compose-type service) or you can model each
service individually.

---

## 1. Architecture / message flow

```
WhatsApp  <->  evolution-api  --(global webhook)-->  api  (POST /webhooks/evolution)
                    ^                                  |
                    |  http://evolution-api:8080       |  drives engine, sends replies
                    +----------------------------------+
web (dashboard)  -->  api  (JWT-protected REST)
```

- The app reaches Evolution **internally** at `http://evolution-api:8080` (compose
  network) — no public hop.
- Evolution's **global webhook** posts inbound events **internally** to
  `http://api:3001/webhooks/evolution`.
- Postgres holds two isolated databases on one instance: `decodifica` (Prisma)
  and `evolution` (created automatically by `infra/postgres/initdb`).

---

## 2. Environment variables

Copy `.env.example` to `.env` and fill real values. The API validates its vars on
startup and **halts on the first missing/invalid required variable**, naming it,
before binding the port.

### Required

| Variable                  | Used by         | Notes |
| ------------------------- | --------------- | ----- |
| `POSTGRES_PASSWORD`       | postgres/all    | Change for production; feeds both DB URIs |
| `DATABASE_URL`            | api             | App DB; default points at the bundled postgres |
| `APP_ENV`                 | api             | `development` \| `staging` \| `production` |
| `FRONTEND_URL`            | api             | Web domain (CORS) |
| `PUBLIC_API_URL`          | api             | API public domain. Webhook = this + `/webhooks/evolution` |
| `JWT_SECRET`              | api             | Min 16 chars; long random value |
| `LLM_PROVIDER`            | api             | `openrouter` (default) \| `openai` |
| `OPENROUTER_API_KEY`      | api             | Required when provider = openrouter |
| `OPENAI_API_KEY`          | api             | Required when provider = openai |
| `EVOLUTION_API_KEY`       | api + evolution | **Shared** key (Evolution auth + app's `apikey` header) |
| `EVOLUTION_PUBLIC_URL`    | evolution       | Evolution public domain (its `SERVER_URL`) |
| `EVOLUTION_INSTANCE_NAME` | api             | Instance the app drives (default `decodifica`) |

### Optional (have defaults)

`OPENROUTER_BASE_URL`, `MODEL_NAME`, `LLM_MODEL_FALLBACK`, `EVOLUTION_WEBHOOK_SECRET`,
`BOT_AUTO_REPLY_ENABLED`, `BOT_PAUSE_ON_HANDOFF`, `ADMIN_WHATSAPP_NUMBERS`,
`PRICING_RANGE_ENABLED`, `PRICING_STARTING_AT`, `PRICING_TEXT`, `POSTGRES_USER`,
`POSTGRES_DB`, `API_PORT`, `WEB_PORT`.

> Note: in compose the app does NOT set `EVOLUTION_API_URL` from `.env` — it is
> hardwired to the internal service URL `http://evolution-api:8080`.

---

## 3. Evolution webhook URL

The app's inbound webhook is `PUBLIC_API_URL + /webhooks/evolution`. Two paths
reach it:

- **Inside the cluster (default):** Evolution's `WEBHOOK_GLOBAL_URL` is set to
  `http://api:3001/webhooks/evolution` in compose — events never leave the
  network.
- **From the WhatsApp dashboard "Set webhook" action:** registers the instance
  webhook using `PUBLIC_API_URL + /webhooks/evolution` (the public form).

If `EVOLUTION_WEBHOOK_SECRET` is set, the app rejects webhooks lacking a matching
secret (401); leave it empty to accept Evolution's global webhook as-is.

---

## 4. Healthchecks

- **postgres** — `pg_isready`.
- **redis** — `redis-cli ping`.
- **evolution-api** — `wget --spider http://localhost:8080` (90s start period).
- **api** — `wget -qO- http://localhost:3001/health` → `{ status, database,
  evolutionConfigured, llmConfigured }` (60s start period for migrations + boot).
- **web** waits for a healthy `api`; `api` waits for healthy `postgres` +
  `evolution-api`; `evolution-api` waits for healthy `postgres` + `redis`.

---

## 5. EasyPanel steps

1. **Create the project** and add a Compose service from this repo (or model the
   five services individually).
2. **Set environment variables** from `.env.example` in the EasyPanel UI / `.env`.
   Use the SAME `EVOLUTION_API_KEY` for the app and Evolution.
3. **Assign domains** to the three public services and set the matching env:
   - `web`  → `FRONTEND_URL`  (e.g. https://app.example.com)
   - `api`  → `PUBLIC_API_URL` (e.g. https://api.example.com)
   - `evolution-api` → `EVOLUTION_PUBLIC_URL` (e.g. https://evolution.example.com)
4. **Deploy.** On first boot postgres creates both databases, the api runs
   `prisma migrate deploy`, and Evolution initializes its schema.
5. **Connect WhatsApp:** open the dashboard **WhatsApp** screen → connect the
   instance, scan the QR, then **Set webhook**. Confirm `GET /health` shows
   `database: healthy`, `evolutionConfigured: true`, `llmConfigured: true`.

---

## 6. Local validation

```bash
cp .env.example .env   # then edit values
docker compose config -q     # validate compose syntax
docker compose up --build    # bring the full stack up
```
