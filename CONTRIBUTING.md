# Contributing to GetCito

Thank you for your interest in contributing to GetCito! This guide will help you get started.

## Ways to Contribute

- **Bug reports** — found something broken? Open an issue.
- **Feature requests** — have an idea? Start a discussion or open an issue.
- **Code contributions** — fix a bug or implement a feature via pull request.
- **Store connectors** — bring a store's or marketplace's products into the catalog; see [CONNECTORS.md](CONNECTORS.md).
- **Documentation** — improve guides, fix typos, add examples.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- A [Supabase](https://supabase.com/) project (URL + anon key)
- At least one AI provider API key (OpenAI, Google Gemini, Anthropic, Perplexity, or Grok)
- [Docker](https://www.docker.com/) + Docker Compose (optional, for containerized setup)

## Project Structure

```
getcito/
├── frontend/                 # Next.js 16 frontend (TypeScript)
├── backend/              # Express backend (Node.js ESM)
├── supabase/            # Database migrations and config
├── help/                # Product Help articles Chat answers from (help/README.md)
├── scripts/             # Version management tooling
├── docker-compose.yml   # Containerized deployment
├── CHANGELOG.md
└── LICENSE
```

Both `frontend/` and `backend/` are independent packages with their own `package.json` and `Dockerfile`. They share a unified version number managed from the root.

Use camelCase for application modules and PascalCase for React component filenames. Tests use the same basename as their implementation. Keep Next.js reserved filenames, generated files, and the shadcn UI component conventions unchanged.

## Development Setup

### 1. Fork the repository

Click the **Fork** button on the [GetCito repository](https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool) to create your own copy.

### 2. Clone your fork

Replace `YOUR_USERNAME` with your GitHub username:

```bash
git clone https://github.com/YOUR_USERNAME/getcito-worlds-first-open-source-aio-aeo-or-geo-tool.git getcito
cd getcito
```

### 3. Add upstream remote (recommended)

This allows you to sync with the main repo:

```bash
git remote add upstream https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool.git
```

### 4. Configure environment variables

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Fill in at minimum:

- **Supabase** URL and anon key (both `frontend/.env.local` and `backend/.env`)
- **At least one AI API key** in `backend/.env` (e.g. `OPENAI_API_KEY`)

### 5. Set up the database

Run the migration SQL to create all tables, indexes, RLS policies, and triggers in your Supabase project:

**Option A — Supabase SQL Editor (easiest):**

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. For each file in `supabase/migrations/` (in alphabetical order — `00001_…` first, then `00002_…`, etc.), paste its contents and click **Run**

**Option B — Supabase CLI:**

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

### Demo data (optional)

For a pre-populated local dashboard, the repo ships `supabase/seed.sql` — an idempotent fixture (one demo organization, brand, topics, prompts, ~120 prompt results across all tracked engines, prompt search volumes, competitors, content opportunities with source data, and AI traffic logs). The Supabase CLI loads it on:

```bash
npx supabase db reset
```

Sign in with **`demo@getcito.local` / `demo123`** to land on a populated dashboard.

> **Heads-up:** the **Prompts** and **Content** pages fetch through the backend API (`backend/`), not Supabase directly. Start *both* dev servers (step 7) — otherwise those two pages show a "Failed to load" toast even though the data is seeded. The seed runs only against a local Supabase via the CLI; hosted/production projects are never touched by it.

### 6. Install dependencies

The web app uses **yarn**, the server uses **npm**:

```bash
cd frontend && yarn install
cd ../backend && npm install
```

### 7. Start dev servers

In separate terminals:

```bash
# Terminal 1 — frontend (http://localhost:3000)
cd frontend && yarn dev

# Terminal 2 — backend (http://localhost:80)
cd backend && npm run dev
```

### Docker alternative

If you prefer Docker, configure your `.env` files first, then:

```bash
docker compose up --build
```

## Branch Naming

We follow [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) with a single `main` branch. Create short-lived branches from `main` using these prefixes:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New feature | `feature/competitor-export` |
| `fix/` | Bug fix | `fix/tracking-timeout` |
| `chore/` | Maintenance | `chore/update-deps` |
| `docs/` | Documentation | `docs/setup-guide` |

## Making Changes

1. Create a branch from `main`:

   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes and commit (see commit conventions below).

3. Verify versions are in sync:

   ```bash
   npm run version:check
   ```

4. If you added or edited a file under `supabase/migrations/`, regenerate the
   consolidated schema and commit the result — CI fails if it is out of date:

   ```bash
   bash supabase/build-schema.sh
   ```

   Describe any migration steps in the pull request. CI verifies the schema
   file; deployment operators apply the migrations to their own database.

   If the migration adds a table with a `brand_id`, say what the
   [demo brand](docs/guides/demo-brand.mdx) shows for it: build its rows in a
   module under `backend/src/lib/demo/`, or list it in `SKIPPED` in
   `backend/src/lib/demo/coverage.js` with the reason. `coverage.test.js` fails
   until you do. A change to what the demo's data looks like (a module's rows,
   or a column a page reads from them) also bumps `DEMO_VERSION` in
   `backend/src/lib/demo/index.js`, so every demo brand is rebuilt on its next
   visit.

5. If your change alters what a user sees or does, add or update its Help
   article under `help/` in the same pull request ("Help article updated"):
   one article per page, feature, setting and main task, in the format of
   [help/README.md](help/README.md). `yarn test` (run from `frontend/`) checks
   the format. A new article starts as `approved: false`.

6. Push and open a pull request against `main`.

7. In your PR description, include:
   - **What** changed and **why**
   - **How to test** the change
   - Screenshots if there are UI changes

8. Wait for review, address feedback, and your PR will be merged.

### Checking for schema drift

A migration that was committed but never applied leaves the database missing
something the code calls, which surfaces as a runtime error rather than a
failing build. To check a database against what this repo expects:

```bash
bash supabase/check-drift.sh          # prints SQL; paste it into the SQL Editor
```

It reads the repo and writes a read-only query — no credentials, no
connection, nothing written. An empty result means no drift; any row is
something the code expects and that database does not have. Worth running
after applying a migration, and after pulling a batch of merged changes.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, dependency updates |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |

**Examples:**

```
feat: add competitor export endpoint
fix: resolve tracking timeout on large datasets
chore: update AI SDK to v6.1
docs: add self-hosting guide
```

Scope is optional but helpful for monorepo clarity:

```
feat(server): add rate limiting to tracking API
fix(web): correct chart rendering on mobile
```

## Code Style

### Web (`frontend/`)

- TypeScript with strict mode enabled
- ESLint with `eslint-config-next` (core-web-vitals + typescript)
- Run `yarn lint` before submitting
- **Prettier owns formatting.** Run `yarn format` before submitting (or enable format-on-save with the repo's Prettier config). CI runs `yarn format:check`, so unformatted code will fail the check — don't hand-format or reformat unrelated lines.

### Server (`backend/`)

- Node.js with ES modules (`"type": "module"`)
- Zod for runtime validation
- Follow existing patterns in `src/`

### General

- Follow the conventions already present in the codebase
- Keep changes focused — one concern per PR

## Versioning

All three `package.json` files (root, `frontend/`, `backend/`) share the same version. Use the provided scripts to manage versions:

```bash
# Check that all versions match
npm run version:check

# Bump version (updates all three package.json files)
npm run version:bump -- patch   # 0.1.0 → 0.1.1
npm run version:bump -- minor   # 0.1.0 → 0.2.0
npm run version:bump -- major   # 0.1.0 → 1.0.0
```

Do not edit version numbers in `package.json` files manually.

## Reporting Issues

When opening an issue, please include:

- **Bug reports:** Steps to reproduce, expected vs. actual behavior, Node.js version, browser (if applicable)
- **Feature requests:** Use case description and why it would be useful

## License

By contributing to GetCito, you agree that your contributions will be licensed under the [MIT License](LICENSE).
