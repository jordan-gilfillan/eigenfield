# Journal Distiller

A deterministic pipeline that converts AI chat exports (ChatGPT, Claude, Grok) into classified, day-bucketed journal summaries — with a Studio UI for reviewing and navigating the output.

---

## Screenshots

> Replace these placeholders with actual screenshots.

| View | Screenshot |
|------|-----------|
| Dashboard | ![Dashboard](docs/screenshots/dashboard.png) |
| Studio | ![Studio](docs/screenshots/studio.png) |
| Import | ![Import](docs/screenshots/import.png) |
| Run Detail | ![Run Detail](docs/screenshots/run-detail.png) |

---

## Key Features

### Studio (`/distill/studio`)
- Day-by-day navigation of distilled markdown output
- Collapsible inspect panel — view input atoms alongside generated summaries
- Cost anomaly badges (amber `$` when a day exceeds 2× median cost)
- Status bar with run progress and spend tracking

### Workbench (`/distill`)
- **Import** — Upload ChatGPT, Claude, or Grok JSON exports; auto-detect format or override manually; timezone-aware day bucketing; deduplication via stable content hashes
- **Classify** — Assign one of 13 categories (WORK, LEARNING, CREATIVE, PERSONAL, etc.) with confidence scores; stub mode (deterministic, zero cost) or real LLM mode
- **Distill** — Create runs across one or multiple import batches; select a filter profile (e.g. `professional-only`, `safety-exclude`); choose prompt version and LLM model; tick-driven job processing with advisory-lock concurrency control
- **Search** — Full-text search across atoms with source and category filters

### Ops
- **Dual LLM providers** — OpenAI (Responses API) and Anthropic (Messages API), hot-swappable per run
- **Spend controls** — Per-run and per-day USD caps, with real-time cost tracking from actual token usage
- **Rate limiting** — Configurable minimum delay between API calls
- **Pricing snapshots** — Frozen at run creation so historical costs are reproducible
- **Prompt versioning** — Multiple prompt variants per stage (classify, summarize, redact); A/B test without recreating runs
- **Dry-run mode** — Full pipeline execution with deterministic placeholder output and zero API spend (default)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js App Router (React 19 + Tailwind 4)             │
│                                                         │
│  Pages                          API Routes              │
│  /distill          dashboard    POST /api/distill/import│
│  /distill/import   file upload  POST /classify          │
│  /distill/studio   day viewer   POST /runs              │
│  /distill/search   atom search  POST /runs/:id/tick     │
│  /distill/runs/:id run detail   GET  /runs/:id/jobs/... │
└────────────────┬────────────────────────┬───────────────┘
                 │                        │
          ┌──────▼──────┐         ┌───────▼────────┐
          │  Services   │         │  LLM Client    │
          │  import     │         │  callLlm()     │
          │  classify   │         │  ┌───────────┐ │
          │  run / tick │         │  │ OpenAI    │ │
          │  search     │         │  │ Anthropic │ │
          │  bundle     │         │  │ Stub      │ │
          └──────┬──────┘         │  └───────────┘ │
                 │                └───────┬────────┘
          ┌──────▼──────┐                │
          │   Prisma    │◄───────────────┘
          │   ORM       │
          └──────┬──────┘
                 │
          ┌──────▼──────┐
          │ PostgreSQL  │
          │    16       │
          └─────────────┘

Data flow:
  Export JSON → parse → MessageAtom → classify (labels)
    → bundle (filter + segment) → summarize (LLM) → Output (markdown)
```

---

## Quickstart (Local)

### Prerequisites

- **Node.js 20+** and npm
- **PostgreSQL 16** — via Docker (easiest) or a local install

### 1. Clone and install

```bash
git clone <your-repo-url> eigenfield
cd eigenfield
npm ci
```

### 2. Start Postgres

```bash
docker compose up -d
```

This starts PostgreSQL 16 on `localhost:5432` with default credentials (`postgres` / `postgres` / `journal_distill`).

### 3. Configure environment

```bash
cp .env.example .env
```

The defaults connect to the Docker Compose database. No changes needed for local dev.

### 4. Run migrations and seed

```bash
npx prisma migrate dev
npx prisma db seed
```

Seed creates filter profiles (`professional-only`, `safety-exclude`, etc.) and prompt versions.

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000/distill](http://localhost:3000/distill) to reach the dashboard.

---

## Running with Docker

### Build the app image

```bash
docker build -t journal-distiller .
```

### Run with an external database

```bash
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e LLM_MODE="dry_run" \
  journal-distiller
```

### Run migrations separately

The migration image has full Prisma CLI + dependencies:

```bash
docker build -f Dockerfile.migrate -t journal-distiller-migrate .

docker run --rm \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  journal-distiller-migrate
```

---

## Deployment (DigitalOcean App Platform)

### Files that matter

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build → slim standalone runner (Node 20 Alpine) |
| `Dockerfile.migrate` | Single-stage image for PRE_DEPLOY migrations + seed |
| `.do/app.yaml` | App Platform spec — web service, managed Postgres, pre-deploy job |
| `.env.production.example` | Documents all production env vars |

### Setup

1. Update `.do/app.yaml` — replace `YOUR_GITHUB_USERNAME/eigenfield` with your actual repo path.
2. Create the app in the DigitalOcean dashboard (or `doctl apps create --spec .do/app.yaml`).
3. The managed Postgres connection string is auto-injected via `${db.DATABASE_URL}`.

### Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes | Auto-injected by DO | Managed Postgres connection string |
| `LLM_MODE` | No | `dry_run` | Set to `real` to enable LLM calls |
| `OPENAI_API_KEY` | For real mode | — | Set in DO dashboard as encrypted env var |
| `ANTHROPIC_API_KEY` | For real mode | — | Set in DO dashboard as encrypted env var |
| `LLM_MAX_USD_PER_RUN` | Recommended | Unlimited | e.g. `5.00` |
| `LLM_MAX_USD_PER_DAY` | Recommended | Unlimited | e.g. `20.00` |
| `LLM_MIN_DELAY_MS` | No | `250` | Rate limit between LLM calls (ms) |

### Pre-deploy behavior

The `migrate` job in `.do/app.yaml` runs before every deployment:

```
npm run db:deploy
```

This applies pending migrations and upserts seed data (filter profiles, prompt versions). The seed is idempotent.

If your app was created outside spec sync workflows, update the pre-deploy job command in the DigitalOcean dashboard (or via `doctl apps update`) to match `npm run db:deploy`.

### Port binding

The standalone Next.js server reads `PORT` from the environment (DO injects this at runtime). `HOSTNAME=0.0.0.0` is baked into the Dockerfile to ensure binding to all interfaces. No additional configuration needed.

---

## Safety and Privacy

**Journal content is sensitive by design.** The pipeline ingests raw AI conversations that may contain personal, medical, financial, or other private information.

- **Do not expose a production instance publicly** without authentication. The app has no built-in auth layer.
- **Use a clean-slate database** for demos — never use a database containing real journal data for public-facing instances.
- The 13-category classification system includes risk-sensitive buckets (MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL, EMBARRASSING) specifically so they can be filtered out via `safety-exclude` profiles.
- API keys are never logged or persisted. Spend caps (`LLM_MAX_USD_PER_RUN`, `LLM_MAX_USD_PER_DAY`) are enforced server-side.

---

## Development

### Tests

```bash
# Run full suite (685 tests)
npx vitest run

# Watch mode
npx vitest
```

Tests use an isolated Postgres database (via Docker Compose). Integration tests require the database to be running.

### Linting

```bash
npm run lint
```

### Database commands

```bash
npm run db:migrate    # prisma migrate dev
npm run db:seed       # prisma db seed
npm run db:reset      # prisma migrate reset (destructive)
```

### Project structure

```
src/
  app/                    # Next.js App Router (pages + API routes)
    distill/              # All UI pages (dashboard, studio, import, search, runs)
    api/distill/          # REST API endpoints
  lib/
    parsers/              # ChatGPT, Claude, Grok export parsers
    services/             # Business logic (import, classify, run, tick, search, bundle)
    llm/                  # LLM client, providers, pricing, budget, rate limiting
    api-utils.ts          # Typed error responses
prisma/
  schema.prisma           # Data model
  seed.ts                 # Idempotent seed (filter profiles, prompts)
  migrations/             # Prisma migration history
```

---

## License

[MIT](LICENSE)
