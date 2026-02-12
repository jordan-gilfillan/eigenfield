# Journal Distiller

A deterministic pipeline that converts AI chat exports (ChatGPT, Claude, Grok) into classified, day-bucketed journal summaries — with a Studio UI for reviewing and navigating the output.

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

## Getting Started

### Prerequisites

- **Node.js 20+** and npm
- **Docker** (for PostgreSQL — the easiest cross-platform option)

<details>
<summary><strong>macOS</strong></summary>

Install [Homebrew](https://brew.sh), then:

```bash
brew install node
```

For Docker, install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or [OrbStack](https://orbstack.dev/) if you prefer a lighter alternative).

</details>

<details>
<summary><strong>Linux (Ubuntu/Debian)</strong></summary>

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```

</details>

<details>
<summary><strong>Windows (WSL2)</strong></summary>

1. Install [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with Ubuntu:
   ```powershell
   wsl --install -d Ubuntu
   ```
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and enable the WSL2 backend in Settings → Resources → WSL Integration.
3. Inside the Ubuntu terminal, install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

All remaining commands run inside the WSL2 Ubuntu terminal.

</details>

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

### LLM mode (optional)

By default the app runs in **dry-run mode** — the full pipeline works with deterministic placeholder output and zero API spend. To use real LLM calls, set these in your `.env`:

```bash
LLM_MODE="real"
OPENAI_API_KEY="sk-..."        # and/or
ANTHROPIC_API_KEY="sk-ant-..."
```

See `.env.example` for all available options including spend caps and rate limiting.

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
# Run full suite
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
