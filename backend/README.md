# GetCito Server

The server package runs the GetCito backend: an Express API with Socket.IO support and background workers for brand tracking, keyword volumes, content briefs, competitor and topic workflows, and the AI traffic pixel.

It is designed to run alongside the `frontend/` app during local development and can also run as the production API service for self-hosted deployments.

## Prerequisites

- Node.js 24 or newer
- npm
- A configured Supabase project
- At least one AI provider API key for tracking and content generation

## Setup

Install dependencies from this directory:

```bash
cd backend
npm ci
```

Create the environment file from the checked-in example:

```bash
cp .env.example .env
```

Then fill in the values required by your deployment. See [`./.env.example`](./.env.example) for the full reference and inline notes.

## Running the Service

For local development, run the nodemon-powered dev server:

```bash
npm run dev
```

For production, the package runs `src/apiServer.js` with Node in the foreground:

```bash
npm start
```

The service listens on `PORT`, which defaults to `80`, and writes logs to standard output. Docker Compose restarts the service according to its `unless-stopped` policy.

## Environment Variables

Use [`./.env.example`](./.env.example) as the source of truth. It groups the required and optional values by purpose:

- Supabase connection values for database, auth, and server-side access
- AI provider keys and default model selections for suggestions and content workflows
- CORS origins for the dashboard API and Socket.IO
- Cloud versus self-hosted mode through `IS_CLOUD`
- DataForSEO credentials for keyword volume data
- Cloro scraper credentials, webhook callback settings, and platform provider selection
- AI volume multiplier configuration
- Stripe secrets for cloud deployments only

## Routes

The server exposes a small public surface plus authenticated API routes:

| Route | Purpose |
| --- | --- |
| `GET /` | Service status, deployment mode, and timestamp |
| `GET /api/health` | Authenticated API health check |
| `/api/prompts` | Prompt sets, prompts, and prompt results |
| `/api/tracking` | Tracking jobs and visibility monitoring |
| `/api/volumes` | Keyword volume lookups and volume-related data |
| `/api/content` | Content opportunities and content brief generation |
| `/api/competitors` | Competitor records and comparison helpers |
| `/api/topics` | Topic grouping and topic-level prompt organization |
| `/api/internal/daily-tracking` | Internal daily tracking trigger protected by `CRON_SECRET` |
| `/api/internal/content/:id/brief` | Internal content brief trigger protected by `CRON_SECRET` |
| `/api/internal/trigger-tracking` | First tracking run after a payment (Stripe return page and webhook), one per purchase, with the brand's volume analysis; protected by `CRON_SECRET` |
| `POST /cloro/callback` | Public Cloro scraper webhook callback |
| `GET /t.js` | Public AI traffic tracking script |
| `POST /track/:trackingCode` | Public AI traffic pixel ingestion endpoint |

Routes mounted under `/api` are token-authenticated unless they are explicitly listed as internal endpoints protected by `CRON_SECRET`.
