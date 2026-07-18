<p align="center">
  <a href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/www/public/brand/logos/getcito-logo-dark-xl.png">
      <source media="(prefers-color-scheme: light)" srcset="apps/www/public/brand/logos/getcito-logo-xl.png">
      <img alt="Getcito" src="apps/www/public/brand/logos/getcito-logo-dark-xl.png" width="300">
    </picture>
  </a>
</p>

<p align="center">
  Open source AI visibility tracking and optimization &mdash; self-hosted.
  <br />
  <br />
  <a href="https://www.getcito.com/"><strong>Learn more &raquo;</strong></a>
</p>

<br />

<p align="center">
  <a href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/"><img src="https://img.shields.io/badge/Docs-2563eb?style=flat&logo=readthedocs&logoColor=white" alt="Docs"></a>&nbsp;
  <a href="https://demo.getcito.com"><img src="https://img.shields.io/badge/Demo-22c55e?style=flat&logoColor=white" alt="Demo"></a>&nbsp;
  <a href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/issues"><img src="https://img.shields.io/badge/Issues-f95738?style=flat&logo=github&logoColor=white" alt="Issues"></a>&nbsp;
  <a href="https://github.com/ai-search-guru/"><img src="https://img.shields.io/badge/Roadmap-ee964b?style=flat&logo=github&logoColor=white" alt="Roadmap"></a>&nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">&nbsp;
  <img src="https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white" alt="Node 24.x">
</p>

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Demo](#demo)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Option A — Docker Compose (recommended)](#option-a--docker-compose-recommended)
  - [Option B — Local development](#option-b--local-development)
- [Configuration](#configuration)
- [Usage](#usage)
- [Available Scripts](#available-scripts)
- [API Documentation](#api-documentation)
- [Database](#database)
- [Deployment Documentation](#deployment-documentation)
  - [1. Local Deployment](#1-local-deployment)
  - [2. Demo Deployment](#2-demo-deployment)
  - [3. White Label Deployment](#3-white-label-deployment)
- [Testing](#testing)
- [Linting & Formatting](#linting--formatting)
- [CI/CD](#cicd)
- [Security Notes](#security-notes)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)
- [Acknowledgements](#acknowledgements)
- [Contact](#contact)

---

## About

**Getcito** is an open-source, self-hosted platform for tracking and optimizing your **AI visibility** — also known as:

- **AEO** — Answer Engine Optimization
- **GEO** — Generative Engine Optimization
- **LLMO** — LLM Optimization

Getcito tracks how AI answer engines (ChatGPT, Google AI Mode, Perplexity, Gemini, Copilot, Grok, and others) mention, cite, and describe your brand — so you can benchmark competitors and grow your presence in AI answers. Run it on your own infrastructure, own your data, and audit exactly how every metric is calculated.

It is a free alternative to hosted tools like Profound, Peec, and Otterly.

## Features

- 📊 **Prompt tracking** — schedule prompts and record how AI engines answer them over time.
- 🔎 **Citation & mention analysis** — extract which brands, domains, and sources each AI response cites.
- 🏷️ **Brand & competitor benchmarking** — track your brand alongside competitors on the same prompts.
- 🤖 **Multiple AI surfaces** — ChatGPT, Google AI Mode, Google AI Overview, Perplexity, Gemini, Copilot, Grok.
- 🔌 **Pluggable scrapers & LLM providers** — BrightData, Oxylabs, Olostep, DataForSEO for scraping; OpenRouter, Anthropic, OpenAI, Mistral for direct LLM calls.
- 📄 **Reports** — background report generation over collected data.
- ⚙️ **Background job engine** — durable scheduling and retries via `pg-boss` on PostgreSQL.
- 🔑 **REST API** — Bearer-authenticated `/api/v1` for brands, competitors, prompts, and reports.
- 🎨 **White-label mode** — rebrandable deployment with Auth0 SSO.

## Demo

Try the live demo at **[demo.getcito.com](https://demo.getcito.com)** to see prompt tracking and citation analysis in action.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | [TypeScript](https://www.typescriptlang.org/) 6, [Node.js](https://nodejs.org/) 24 |
| Monorepo | [pnpm](https://pnpm.io/) workspaces + [Turborepo](https://turbo.build/repo) |
| Web app | [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router) + [React 19](https://react.dev/), [Vite](https://vitejs.dev/), [Nitro](https://nitro.build/) |
| UI | [Tailwind CSS 4](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [Recharts](https://recharts.org/), [Storybook](https://storybook.js.org/) |
| Marketing / docs | TanStack Start + [Fumadocs](https://fumadocs.dev/) |
| Background jobs | [pg-boss](https://github.com/timgit/pg-boss) |
| Database | [PostgreSQL 16](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) / drizzle-kit |
| Auth | [Better Auth](https://www.better-auth.com/) + [Auth0](https://auth0.com/) (white-label SSO) |
| AI SDKs | [Vercel AI SDK](https://sdk.vercel.ai/), `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@anthropic-ai/sdk` |
| Tooling | [Biome](https://biomejs.dev/) (lint/format), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [Knip](https://knip.dev/), [Changesets](https://github.com/changesets/changesets) |
| Delivery | [Docker](https://www.docker.com/) / Docker Compose |

## Architecture Overview

Getcito is a pnpm/Turborepo monorepo of four apps backed by shared packages. The **web** app serves the dashboard and REST API; the **worker** runs scheduled scraping, analysis, and report jobs off a `pg-boss` queue in PostgreSQL. Scraper and LLM providers are called by the worker to collect AI answers.

```mermaid
flowchart LR
    User([User / Browser]) -->|HTTP| Web[apps/web<br/>TanStack Start dashboard + /api/v1]
    Web -->|read/write| DB[(PostgreSQL 16<br/>Drizzle schema)]
    Web -->|enqueue jobs| DB
    Worker[apps/worker<br/>pg-boss jobs] -->|poll queues| DB
    Worker -->|scrape AI answers| Scrapers[BrightData / Oxylabs<br/>Olostep / DataForSEO]
    Worker -->|direct LLM calls| LLM[OpenRouter / Anthropic<br/>OpenAI / Mistral]
    WWW[apps/www<br/>marketing + docs] -.-> User
```

**Prompt tracking lifecycle:**

```mermaid
sequenceDiagram
    participant Sched as schedule-maintenance (cron */5)
    participant Q as pg-boss queue
    participant W as process-prompt job
    participant P as Scraper / LLM provider
    participant DB as PostgreSQL

    Sched->>Q: enqueue due prompts
    Q->>W: dispatch process-prompt
    W->>P: run prompt on AI surface
    P-->>W: answer + citations
    W->>DB: persist snapshot & metrics
```

Worker queues (from `apps/worker/src`): `process-prompt`, `generate-report`, `analyze-brand`, `schedule-maintenance` (cron `*/5 * * * *`), and `sync-auth0-memberships` (white-label only, `*/15 * * * *`).

## Project Structure

```text
getcito/
├── apps/
│   ├── web/          # TanStack Start dashboard + /api/v1 (Vite dev :3000, Nitro build)
│   ├── worker/       # pg-boss background jobs (tsx runtime)
│   └── www/          # Marketing site + Fumadocs docs (Vite dev :3001)
├── packages/
│   ├── api-spec/     # OpenAPI 3 spec (openapi.json)
│   ├── config/       # Env registry/validation, scrape-target parsing, shared constants
│   ├── deployment/   # Deployment-mode wiring (local / demo / whitelabel)
│   ├── docs/         # Shared docs UI components (Fumadocs)
│   ├── lib/          # DB (Drizzle), auth (Better Auth), providers, onboarding, DataForSEO
│   ├── local/        # Local-mode UI/components
│   ├── og/           # Open Graph image rendering (Takumi)
│   ├── ui/           # Design system (Radix + Tailwind)
│   └── whitelabel/   # White-label theming + Auth0 hooks
├── docker/           # Multi-stage Dockerfile + entrypoint
├── e2e/              # Playwright end-to-end tests
├── scripts/          # License check, release notes, version sync
├── docker-compose.yml
├── docker-compose.whitelabel.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Prerequisites

**For Docker deployment:**

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose

**For local development:**

- [Node.js](https://nodejs.org/) **24.x** (enforced via `engines`; use `nvm use 24`)
- [pnpm](https://pnpm.io/) **11.10.0** (`corepack enable pnpm`)
- [PostgreSQL 16](https://www.postgresql.org/) (or run it via Docker)

## Installation

### Option A — Docker Compose (recommended)

Builds and runs the full stack (PostgreSQL, migrations, web, worker, Adminer) from source.

```bash
# Clone
git clone https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool.git
cd getcito-worlds-first-open-source-aio-aeo-or-geo-tool

# Edit the .env file at the repo root and fill in real values (see Configuration)

# Build and start
docker compose build
docker compose up -d
```

Services exposed on the host:

| Service | URL | Notes |
|---------|-----|-------|
| Web app | http://localhost:3001 | Maps to container port 3000 |
| Adminer (DB UI) | http://localhost:8081 | PostgreSQL admin |
| PostgreSQL | localhost:5433 | Maps to container port 5432 |

> [!TIP]
> **Watch** this repo's **releases** to get notified of major updates.

### Option B — Local development

```bash
# Install dependencies
corepack enable pnpm
pnpm install

# Env file is read from the repo root AND apps/web/.env (see Configuration)
# Note: Complete .env.local files have been generated for you. You can copy them to .env:
cp .env.local .env
cp apps/web/.env.local apps/web/.env

# Run all dev servers via Turborepo
pnpm dev
```

Dev ports: **web** → http://localhost:3000, **www** → http://localhost:3001.
The **worker** loads env from `apps/web/.env` (via `--env-file`) and is only needed for background job processing.

## Configuration

Environment variables are the single source of truth. The canonical registry lives in `packages/config/src/env-registry.ts`; startup validation reports any missing **required** vars for the active `DEPLOYMENT_MODE`.

> [!IMPORTANT]
> A complete `.env.local` file has been pre-generated for you in the repo root and within each app directory. You can use this file for your local overrides. 
> Because the worker strictly reads from `apps/web/.env` via the Node `--env-file` flag during `pnpm dev`, ensure you copy your `.env.local` content to `.env` in those locations.

**Deployment modes** (`DEPLOYMENT_MODE`): `local`, `demo`, `whitelabel`, `cloud`.
Required-column legend: **local** = required in local mode · **wl** = required in white-label mode · **scraper** = required only when `SCRAPE_TARGETS` references that provider · _optional_ = never required at startup.

### Core

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `DATABASE_URL` | server | local, demo, wl | PostgreSQL connection string. |
| `DEPLOYMENT_MODE` | server | local, demo, wl | `local`, `demo`, `whitelabel`, or `cloud`. |
| `BETTER_AUTH_SECRET` | server | local, demo, wl | Session cookie encryption secret (random hex). |
| `SCRAPE_TARGETS` | server | local, demo, wl | Comma-separated `model:provider[:version][:online]` entries, e.g. `chatgpt:brightdata:online,google-ai-mode:brightdata:online`. |
| `APP_URL` | server | optional | Public base URL of the web app. |
| `VITE_APP_URL` | client | wl | Client-visible app URL. |
| `VITE_DEPLOYMENT_MODE` | client | optional | Client-visible copy of `DEPLOYMENT_MODE`. |
| `DISABLE_TELEMETRY` | server | optional | Set to any value to disable telemetry. |
| `ENVIRONMENT` | server | optional | Environment name reported to Sentry. |

### Scraper providers (required when referenced by `SCRAPE_TARGETS`)

| Variable | Provider | Description |
|----------|----------|-------------|
| `BRIGHTDATA_API_TOKEN` | brightdata | BrightData API token. |
| `OXYLABS_USERNAME` / `OXYLABS_PASSWORD` | oxylabs | Oxylabs Web Scraper API credentials. |
| `OLOSTEP_API_KEY` | olostep | Olostep API key. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | dataforseo | DataForSEO account credentials. |

### Direct LLM providers (required when referenced by `SCRAPE_TARGETS`)

| Variable | Provider | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | openrouter | OpenRouter API key (one key, many models). |
| `ANTHROPIC_API_KEY` | anthropic-api | Anthropic API key. |
| `OPENAI_API_KEY` | openai-api | OpenAI API key. |
| `MISTRAL_API_KEY` | mistral-api | Mistral API key. |

### White-label (Auth0)

| Variable | Scope | Required | Description |
|----------|-------|----------|-------------|
| `AUTH0_CLIENT_ID` | server | wl | Auth0 client ID. |
| `AUTH0_CLIENT_SECRET` | server | wl | Auth0 client secret. |
| `AUTH0_MGMT_API_DOMAIN` | server | wl | Auth0 Management API domain. |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` / `AUTH0_SCOPE` | server | optional | Auth0 tenant/API config. |
| `VITE_APP_NAME` / `VITE_APP_ICON` | client | wl | White-label app name and icon URL. |
| `VITE_APP_PARENT_NAME` / `VITE_APP_PARENT_URL` | client | wl | Parent brand name and URL. |
| `VITE_OPTIMIZATION_URL_TEMPLATE` | client | wl | Optimization link template (`{brandId}`, `{prompt}`, `{webQuery}`). |
| `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` | client | optional | Client-exposed Auth0 config. |

### Optional integrations

| Variable | Scope | Description |
|----------|-------|-------------|
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | server / client | Error reporting DSNs. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | server | Sourcemap upload at build time. |
| `VITE_POSTHOG_KEY` | client | PostHog project API key. |
| `VITE_PLAUSIBLE_DOMAIN` / `VITE_CLARITY_PROJECT_ID` | client | Analytics config. |
| `VITE_CHART_COLORS` | client | Comma-separated chart palette override. |
| `ADMIN_AUTH0_SUB` / `ADMIN_API_KEYS` | server | Admin access (subject claim / bearer tokens). |
| `DEFAULT_BRAND_DOMAINS` | server | Comma-separated domains added as default brands. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` / `_ENDPOINT` | server | Marketing-site (www) caching. |
| `BLOB_READ_WRITE_TOKEN` | server | Vercel Blob token (www competitor screenshots). |
| `DBOS_SYSTEM_DATABASE_URL` | server | Override for the DBOS system database URL. |

## Usage

```bash
pnpm dev      # start all dev servers (web :3000, www :3001) via Turborepo
pnpm build    # build all apps/packages for production
pnpm test     # run unit tests (Vitest)
pnpm lint     # lint with Biome
pnpm format   # format with Biome
```

**Production (per app):** `pnpm build` emits a Nitro server bundle for `web` and `www`; start with `node .output/server/index.mjs` (see each app's `start` script). The worker runs via `tsx src/index.ts`.

## Available Scripts

**Root** (`package.json`):

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `turbo dev` | Start all dev servers. |
| `build` | `turbo build` | Build all packages. |
| `lint` | `turbo lint` | Biome lint across the workspace. |
| `test` | `turbo test` | Run unit tests. |
| `format` | `biome format --write .` | Format the codebase. |
| `knip` | `knip` | Report unused files/deps/exports. |
| `changeset` | `changeset` | Create a changeset. |
| `version-packages` | `changeset version && node scripts/sync-root-version.mjs` | Bump versions. |
| `release` | `pnpm build && changeset publish` | Build & publish. |
| `test:e2e` | `pnpm --filter e2e test:e2e` | Run Playwright E2E tests. |
| `test:e2e-local` | `bash e2e/run-local.sh` | Run E2E against a local stack. |
| `license-check` | `node scripts/check-licenses.mjs` | Audit dependency licenses. |

**Per app / package (selected):**

| Package | Scripts |
|---------|---------|
| `apps/web` | `dev` (`vite dev --port 3000`), `build`, `start`, `preview`, `test`, `test:storybook`, `storybook`, `lint`, `check-types` |
| `apps/www` | `dev` (`vite dev --port 3001`), `build`, `start`, `check-types` |
| `apps/worker` | `dev` (`tsx --env-file=../web/.env src/index.ts`), `start`, `build`, `check-types` |
| `packages/lib` | `test`, `generate:auth-schema`, `compare:onboarding` |

## API Documentation

The web app exposes a REST API under **`/api/v1`**. The full contract is defined in [`packages/api-spec/src/openapi.json`](packages/api-spec/src/openapi.json) (OpenAPI 3).

**Authentication:** Bearer token — `Authorization: Bearer <token>`.

| Resource | Endpoints |
|----------|-----------|
| Brands | `GET`/`POST` `/brands` · `GET`/`PATCH` `/brands/{brandId}` |
| Competitors | `GET`/`POST` `/competitors` · `GET`/`PATCH`/`DELETE` `/competitors/{competitorId}` |
| Prompts | `GET`/`POST` `/prompts` · `GET`/`PATCH`/`DELETE` `/prompts/{promptId}` · `GET` `/prompts/{promptId}/snapshot` |
| Reports | `GET`/`POST` `/reports` · `GET` `/reports/{reportId}` |
| Tools | `POST` `/tools/analyze` |

Example:

```bash
curl -H "Authorization: Bearer $GETCITO_TOKEN" \
     http://localhost:3001/api/v1/brands
```

## Database

- **PostgreSQL 16**, accessed via **Drizzle ORM** (schema in `packages/lib/src/db`).
- Migrations are managed with **drizzle-kit**. Run from `packages/lib`:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/getcito \
  npx drizzle-kit migrate
```

Under Docker Compose, the `db-migrate` service runs migrations automatically before `web` and `worker` start. `pg-boss` also creates its own queue schema on worker startup.

## Deployment Documentation

Getcito supports multiple deployment models via Docker Compose. Below are the comprehensive guides for deploying Getcito locally, as a demo, or as a fully white-labeled instance.

### 1. Local Deployment

The local deployment builds and runs the full stack (PostgreSQL, automatic migrations, web dashboard, background worker, and Adminer DB UI) from source.

**Prerequisites:**
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose plugin.
- A clone of this repository.

**Step-by-step Setup:**

1. **Configure Environment Variables**
   A complete `.env.local` file has been pre-generated in the repository root. Open `.env.local` and fill in your actual values. Ensure the `DEPLOYMENT_MODE` is set to `local`.
   For Docker Compose to pick it up properly via the `env_file` directive, copy it to `.env`:
   ```bash
   cp .env.local .env
   ```
   *Required variables include: `DATABASE_URL`, `DEPLOYMENT_MODE`, `BETTER_AUTH_SECRET`, and any required `SCRAPE_TARGETS` API keys.*

2. **Build Docker Images**
   ```bash
   docker compose build
   ```

3. **Start the Stack**
   ```bash
   docker compose up -d
   ```

**What happens at startup:**
```mermaid
sequenceDiagram
    participant D as Docker Compose
    participant DB as PostgreSQL
    participant M as db-migrate
    participant W as Web / Worker
    D->>DB: Start Database
    DB-->>D: Healthy (port 5433)
    D->>M: Run Migrations (drizzle-kit)
    M-->>D: Completed
    D->>W: Start Web and Worker
```

**Access URLs:**
- **Web App**: http://localhost:3001
- **Adminer (Database UI)**: http://localhost:8081
- **PostgreSQL**: `localhost:5433` (Username: `postgres`, Password: `postgres`, DB: `getcito`)

**Common Commands:**
- View logs: `docker compose logs -f web`
- Stop services: `docker compose down`
- Rebuild containers: `docker compose build --no-cache`
- Wipe database volume: `docker compose down -v`

### 2. Demo Deployment

The Demo deployment mode (`DEPLOYMENT_MODE=demo`) is designed to host a public or staging instance where users can test the application. 

**Demo Capabilities Verified in Repo:**
- The login screen will automatically read `VITE_DEMO_EMAIL` and `VITE_DEMO_PASSWORD` from your environment variables to pre-fill the login form for test users.
- Relies on the same standard infrastructure (PostgreSQL, web, worker).

**Setup:**
1. Configure your `.env` file with `DEPLOYMENT_MODE=demo` and `VITE_DEPLOYMENT_MODE=demo`.
2. Add your demo credentials:
   ```env
   VITE_DEMO_EMAIL=team@getcito.com
   VITE_DEMO_PASSWORD=your_demo_password
   ```
3. Deploy using the standard Compose commands:
   ```bash
   docker compose build
   docker compose up -d
   ```
*(Note: External cloud hosting or demo-specific infrastructure is not provided in this repository; it relies solely on the `demo` mode application flag).*

### 3. White Label Deployment

Getcito supports a fully rebrandable **White Label** mode powered by Auth0 SSO.

**White Label Capabilities:**
- Custom branding baked into the client bundle at build time: App Name, App Icon, Parent Brand URLs, and Custom Optimization URL Templates.
- Authentication delegated completely to Auth0.
- Allows deploying via a custom Docker Compose file that maps to standard ports (Web on `3000`, DB on `5432`, Adminer on `8080`).

**Setup:**

1. **Create the Compose Template**
   Create a new file named `docker-compose.whitelabel.yml` in the root directory and paste the following configuration. This file is intentionally omitted from the repository to prevent accidental leakage of proprietary modifications.

   <details>
   <summary>Click to view <code>docker-compose.whitelabel.yml</code> template</summary>

   ```yaml
   services:
     postgres:
       image: postgres:16-alpine
       ports:
         - "127.0.0.1:5432:5432"
       environment:
         POSTGRES_USER: postgres
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: getcito
       volumes:
         - postgres_data:/var/lib/postgresql/data
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U postgres"]
         interval: 5s
         timeout: 5s
         retries: 5

     adminer:
       image: adminer
       restart: always
       ports:
         - "8080:8080"
       environment:
         ADMINER_DEFAULT_SERVER: postgres
         start_period: 30s

     db-migrate:
       build:
         context: .
         dockerfile: docker/Dockerfile
         target: migrate
       environment:
         - DATABASE_URL=postgres://postgres:postgres@postgres:5432/getcito
       depends_on:
         postgres:
           condition: service_healthy

     web:
       build:
         context: .
         dockerfile: docker/Dockerfile
         target: web
         args:
           DEPLOYMENT_MODE: whitelabel
           VITE_DEPLOYMENT_MODE: whitelabel
           VITE_APP_NAME: ${VITE_APP_NAME}
           VITE_APP_ICON: ${VITE_APP_ICON}
           VITE_APP_URL: ${VITE_APP_URL}
           VITE_APP_PARENT_NAME: ${VITE_APP_PARENT_NAME}
           VITE_APP_PARENT_URL: ${VITE_APP_PARENT_URL}
           VITE_OPTIMIZATION_URL_TEMPLATE: ${VITE_OPTIMIZATION_URL_TEMPLATE}
           VITE_ONBOARDING_REDIRECT_URL_TEMPLATE: ${VITE_ONBOARDING_REDIRECT_URL_TEMPLATE}
           VITE_AUTH0_DOMAIN: ${VITE_AUTH0_DOMAIN}
           VITE_AUTH0_CLIENT_ID: ${VITE_AUTH0_CLIENT_ID}
       env_file:
         - .env
       ports:
         - "3000:3000"
       depends_on:
         postgres:
           condition: service_healthy
         db-migrate:
           condition: service_completed_successfully

     worker:
       build:
         context: .
         dockerfile: docker/Dockerfile
         target: worker
       env_file:
         - .env
       depends_on:
         postgres:
           condition: service_healthy
         db-migrate:
           condition: service_completed_successfully

   volumes:
     postgres_data:
   ```
   </details>

2. **Configure Environment Variables**
   Ensure `DEPLOYMENT_MODE=whitelabel` and provide the required Auth0 and branding values in your `.env` file.
   ```env
   DEPLOYMENT_MODE=whitelabel
   VITE_DEPLOYMENT_MODE=whitelabel
   AUTH0_CLIENT_ID=your_client_id
   AUTH0_CLIENT_SECRET=your_client_secret
   AUTH0_MGMT_API_DOMAIN=your_mgmt_api_domain
   VITE_APP_NAME="Acme AI Search"
   VITE_APP_ICON="https://cdn.example.com/icon.png"
   VITE_APP_URL="http://localhost:3000"
   VITE_APP_PARENT_NAME="Acme"
   VITE_APP_PARENT_URL="http://localhost:3000"
   VITE_OPTIMIZATION_URL_TEMPLATE="..."
   ```

3. **Build and Deploy**
   *Important: Client variables (`VITE_*`) are read during the build step and baked into the image.*
   ```bash
   docker compose -f docker-compose.whitelabel.yml build
   docker compose -f docker-compose.whitelabel.yml up -d
   ```

## Testing

```bash
pnpm test                 # unit tests (Vitest) across the workspace
pnpm --filter @workspace/web test:storybook   # Storybook interaction tests

# End-to-end (Playwright) — requires browsers + a running app
pnpm exec playwright install
pnpm test:e2e             # or: pnpm test:e2e-local
```

E2E tests live in `e2e/` and are separate from unit tests.

## Linting & Formatting

Both linting and formatting are handled by **[Biome](https://biomejs.dev/)** (config in `biome.json`).

```bash
pnpm lint      # turbo lint (biome lint per package)
pnpm format    # biome format --write .
pnpm knip      # detect unused files, dependencies, and exports
```

> [!NOTE]
> Biome reports Tailwind `@apply` directive warnings in CSS files — these are pre-existing and expected.

## CI/CD

This repo does not ship GitHub Actions workflows. Automation currently present in `.github/`:

- **`dependabot.yml`** — automated dependency updates.
- **`CODEOWNERS`**, **`contributors.txt`** (CLA signatures), **`FUNDING.yml`**.

Releases are managed with **Changesets** (`pnpm changeset` → `pnpm version-packages` → `pnpm release`).

## Security Notes

- **Never commit secrets.** API keys, `.env` contents, and auth secrets must stay out of version control. Generate `BETTER_AUTH_SECRET` as random hex per deployment.
- Docker runtime images run as **non-root** users.
- `pnpm-workspace.yaml` pins security-patched transitive dependency versions (see the `overrides` block) and enforces a minimum release age / no-downgrade trust policy for new packages.
- Report vulnerabilities privately per [`SECURITY.md`](SECURITY.md) — email [team@getcito.com](mailto:team@getcito.com), do not open a public issue.

## Contributing

Contributions are welcome. For minor fixes, open a PR directly; for larger changes, open an issue first. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

- **Branching / PRs:** open PRs from your own fork/account against `main`.
- **Coding standards:** TypeScript; format & lint with Biome (`pnpm format`, `pnpm lint`); keep changes type-clean (`check-types`).
- **Changesets:** add a short, end-user-focused changeset scoped to the affected packages (`pnpm changeset`).
- **CLA:** before your first PR merges, add your GitHub username to [`.github/contributors.txt`](.github/contributors.txt) — see [`CLA.md`](CLA.md).
- **Code of Conduct:** see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Roadmap

Tracked on the [GitHub Project board](https://github.com/orgs/ai-search-guru/projects/3/views/1) and in [Issues](https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/issues).

## License

Released under the [MIT License](LICENSE.md). © 2026 GetCito. Contributions are covered by the [Contributor License Agreement](CLA.md).

## Acknowledgements

Built on TanStack Start, Drizzle ORM, Better Auth, pg-boss, Fumadocs, Biome, and Turborepo, and integrates BrightData, Oxylabs, Olostep, DataForSEO, OpenRouter, Anthropic, OpenAI, and Mistral.

## Contact

- 📧 [team@getcito.com](mailto:team@getcito.com)
- 📞 India: +91-96505-10773 · US: +1-623-223-7423
