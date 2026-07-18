# @workspace/web

## 0.2.14

### Patch Changes

- bb674b9: Onboarding brand analysis now runs in the background and is more resilient to failures, avoiding timeouts on slow analyses.
  - @workspace/api-spec@0.2.14
  - @workspace/config@0.2.14
  - @workspace/deployment@0.2.14
  - @workspace/lib@0.2.14
  - @workspace/og@0.2.14
  - @workspace/ui@0.2.14
  - @workspace/whitelabel@0.2.14

## 0.2.13

### Patch Changes

- 4272c19: Added new citation source categories and a Google AI Mode breakdown to the citations dashboard.
- 222fd4f: Local-mode deployments now support multiple brands. The brand switcher shows a "Create new brand" option that provisions a new org + admin membership for the user.
- 3f17708: Added the Google Shopping breakdown to a prompt's Citations tab on the prompt details page.
- 532d592: Added a sort control to the Visibility page.
- cf5a7da: Added a Query Fan-Out section showing the searches AI engines run for your prompts, with a prompt-to-query diff, the words engines add or drop, and the searches you're missing.
- c4505ba: Breaking: `/api/v1` DELETE endpoints now return the deleted resource directly instead of a `{ message, data }` wrapper (the deleted prompt includes a `deletedRunsCount` field), PATCH endpoints reject an empty body with a 400, an unparseable `website` on `/tools/analyze` is now a 400 instead of a 500, and 500 responses no longer echo internal error messages.
- Updated dependencies [c4505ba]
  - @workspace/api-spec@0.2.13
  - @workspace/config@0.2.13
  - @workspace/deployment@0.2.13
  - @workspace/lib@0.2.13
  - @workspace/og@0.2.13
  - @workspace/ui@0.2.13
  - @workspace/whitelabel@0.2.13

## 0.2.12

### Patch Changes

- @workspace/api-spec@0.2.12
- @workspace/config@0.2.12
- @workspace/deployment@0.2.12
- @workspace/lib@0.2.12
- @workspace/og@0.2.12
- @workspace/ui@0.2.12
- @workspace/whitelabel@0.2.12

## 0.2.11

### Patch Changes

- 4ccba7a: Add "Share of Voice" and "Opportunities" pages.
- 4ccba7a: Fix "current visibility" to show the latest point of the carried-forward trend (the value the line ends on) instead of the whole-window average, so the headline number matches the chart beside it.
- 4ccba7a: Fix the sidebar showing only "Overview" after the onboarding wizard finishes in local mode, until the page is refreshed.
- 4ccba7a: Fix the visibility page failing to load for brands with many active prompts.
  - @workspace/api-spec@0.2.11
  - @workspace/config@0.2.11
  - @workspace/deployment@0.2.11
  - @workspace/lib@0.2.11
  - @workspace/og@0.2.11
  - @workspace/ui@0.2.11
  - @workspace/whitelabel@0.2.11

## 0.2.10

### Patch Changes

- b716c43: Fix the dashboard briefly showing "No Data Yet" with "none are currently enabled" right after the onboarding wizard finishes in local mode.
- 2d8fd8c: Bulk-select prompts in the editor (settings and onboarding) to enable or disable many at once.
- Updated dependencies [520aef4]
  - @workspace/lib@0.2.10
  - @workspace/whitelabel@0.2.10
  - @workspace/deployment@0.2.10
  - @workspace/api-spec@0.2.10
  - @workspace/config@0.2.10
  - @workspace/og@0.2.10
  - @workspace/ui@0.2.10

## 0.2.9

### Patch Changes

- 2173aa8: Accept bare domains (e.g. `example.com`) in the brand website field and normalize the stored value to the origin (`https://example.com/products` is saved as `https://example.com/`).
- 1ee1955: Show the signup screen instead of login on a fresh local deployment.
  - @workspace/api-spec@0.2.9
  - @workspace/config@0.2.9
  - @workspace/deployment@0.2.9
  - @workspace/lib@0.2.9
  - @workspace/og@0.2.9
  - @workspace/ui@0.2.9
  - @workspace/whitelabel@0.2.9

## 0.2.8

### Patch Changes

- @workspace/api-spec@0.2.8
- @workspace/config@0.2.8
- @workspace/deployment@0.2.8
- @workspace/lib@0.2.8
- @workspace/og@0.2.8
- @workspace/ui@0.2.8
- @workspace/whitelabel@0.2.8

## 0.2.7

### Patch Changes

- 1e770ff: Publish multi-arch (`linux/amd64` + `linux/arm64`) Docker images for `ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool-web` and `ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool-worker`, so Apple Silicon and other arm64 hosts can pull them.
- 6ab2b42: Fix OG image generation: `og:image` is now an absolute URL and renders the current page's title/description. Adds `og:url`, `og:site_name`, `og:locale`, and `og:logo` to the document head.
  - @workspace/api-spec@0.2.7
  - @workspace/config@0.2.7
  - @workspace/deployment@0.2.7
  - @workspace/lib@0.2.7
  - @workspace/og@0.2.7
  - @workspace/ui@0.2.7
  - @workspace/whitelabel@0.2.7

## 0.2.6

### Patch Changes

- 1a1005a: Admin `/api/v1/brands` endpoints (POST, GET, PATCH) now accept and return a single `domains` list instead of `website` + `additionalDomains`. This future-proofs against a future db model change.
- Updated dependencies [1a1005a]
  - @workspace/api-spec@0.2.6
  - @workspace/config@0.2.6
  - @workspace/deployment@0.2.6
  - @workspace/lib@0.2.6
  - @workspace/og@0.2.6
  - @workspace/ui@0.2.6
  - @workspace/whitelabel@0.2.6

## 0.2.5

### Patch Changes

- edf97d4: Add Mistral as a direct API provider. Set `MISTRAL_API_KEY` and target via `mistral:mistral-api:<model>[:online]`.
- 7cba46d: License Getcito under the MIT License. Add Code of Conduct, Contributing guide, Security policy, and a lightweight CLA process.
- 839b98b: REST-style brand management API: `GET/POST /api/v1/brands`, `GET/PATCH /api/v1/brands/{brandId}`, `POST /api/v1/tools/analyze`, and full CRUD for `/api/v1/competitors`. API-created brands skip onboarding — callers hit `tools/analyze` first if they want suggestions, then create brands with whatever they choose to keep.
- 839b98b: Brand onboarding is now a single screen: paste a website and review the suggested products, competitors (with their own domains and aliases), additional brand domains, aliases, and tagged starter prompts before saving. Powered by whichever direct LLM API you've configured (OpenRouter, Anthropic, OpenAI, or Mistral) with web search.
- Updated dependencies [7990382]
- Updated dependencies [edf97d4]
- Updated dependencies [7cba46d]
- Updated dependencies [839b98b]
  - @workspace/lib@0.2.5
  - @workspace/config@0.2.5
  - @workspace/api-spec@0.2.5
  - @workspace/deployment@0.2.5
  - @workspace/og@0.2.5
  - @workspace/ui@0.2.5
  - @workspace/whitelabel@0.2.5

## 0.2.4

### Patch Changes

- 67a0389: Fix local-mode registration end-to-end and lock down the auth surface. The first `/auth/register` submission in local mode now atomically creates the default org + admin membership, so register → brand onboarding works in one pass; any subsequent signup is rejected. Demo mode narrows writable `/api/auth/**` endpoints to a whitelist of just sign-in and sign-out. Drops the unused `DEFAULT_ORG_ID` and `DEFAULT_ORG_NAME` env vars.
- d0b2925: Redesign the Visibility and Citations filter bar (model / tags / lookback dropdowns + search), wire model filters to `brand.enabledModels`, and move the visibility-bar rollup into a single SQL query — cuts load time from ~10s to under 1s on large brands. Also fixes the "unbranded" tag filter and a search clear-X flicker.
- Updated dependencies [67a0389]
  - @workspace/lib@0.2.4
  - @workspace/config@0.2.4
  - @workspace/whitelabel@0.2.4
  - @workspace/deployment@0.2.4
  - @workspace/og@0.2.4
  - @workspace/api-spec@0.2.4
  - @workspace/ui@0.2.4

## 0.2.3

### Patch Changes

- b635a99: Make default brand cadence configurable via `DEFAULT_DELAY_HOURS` env var. `brand.delayOverrideHours` still takes precedence. The default changed from the hard-coded 72h to 24h.
- a62ef89: Restyle the demo login and add a preview to Storybook.
- e9be023: Ensure icons/favicons are comprehensive for non-whitelabel deployments.
- f3604e2: Replace the page-top demo-mode banner with a compact "Demo" pill next to the sidebar logo (with a tooltip explaining the read-only behavior), and move version / Getcito.com / GitHub links into the sidebar footer for every deployment mode except whitelabel. Also reads the better-auth `user.image` field so avatars actually render.
  - @workspace/api-spec@0.2.3
  - @workspace/config@0.2.3
  - @workspace/deployment@0.2.3
  - @workspace/lib@0.2.3
  - @workspace/og@0.2.3
  - @workspace/ui@0.2.3
  - @workspace/whitelabel@0.2.3

## 0.2.2

### Patch Changes

- 63a6c22: Demo mode: visitors can now actually sign in — better-auth endpoints are exempt from the read-only write-block, and the login form pre-fills the seeded demo credentials.
- d3839b1: Demo deployments (`READ_ONLY=true`) now enable `supportsMultiOrg`, so the `/app` brand switcher renders when the demo user is seeded into multiple organizations. Pure local deployments continue to auto-redirect to the default org.
- 0ae9fc1: Fix missing stylesheet and favicon in Docker builds caused by `@tailwindcss/vite` emitting different CSS hashes in the client and SSR passes.
- 06fb190: Worker dispatch now reads `SCRAPE_TARGETS` end-to-end via the provider registry. Deployments that configure non-default providers no longer hit `AI_LoadAPIKeyError` for providers they never set up, the worker fails fast at startup on misconfigured `SCRAPE_TARGETS`, and `brand.enabledModels` filters per brand.
- Updated dependencies [63a6c22]
- Updated dependencies [06fb190]
  - @workspace/lib@0.2.2
  - @workspace/whitelabel@0.2.2
  - @workspace/deployment@0.2.2
  - @workspace/api-spec@0.2.2
  - @workspace/config@0.2.2
  - @workspace/og@0.2.2
  - @workspace/ui@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [adf7642]
  - @workspace/lib@0.2.1
  - @workspace/whitelabel@0.2.1
  - @workspace/deployment@0.2.1
  - @workspace/api-spec@0.2.1
  - @workspace/config@0.2.1
  - @workspace/og@0.2.1
  - @workspace/ui@0.2.1

## 0.2.0

### Minor Changes

- 95b71db: Replace visibility % with Share of Voice metric across reports, add reports API, and redesign report for print

### Patch Changes

- 4ce1911: show opportunities where prompts have competitor but not brand citations
- 7acf16a: Keep the brand sidebar visible when navigating to a non-existent route under `/app/:brand/*`.
- 1dcaf44: Chart PNG exports now include deployment branding and use a cleaner fixed-size layout
- 37e9e16: Prompt Details now shows when the prompt is scheduled to run next.
- Updated dependencies [95b71db]
  - @workspace/lib@0.2.0
  - @workspace/api-spec@0.2.0
  - @workspace/whitelabel@0.2.0
  - @workspace/deployment@0.2.0
  - @workspace/config@0.2.0
  - @workspace/og@0.2.0
  - @workspace/ui@0.2.0

## 0.1.2

### Patch Changes

- optimize prompt page loading and render with proper virtualization
  - @workspace/config@0.1.2
  - @workspace/demo@0.1.2
  - @workspace/deployment@0.1.2
  - @workspace/lib@0.1.2
  - @workspace/local@0.1.2
  - @workspace/ui@0.1.2
  - @workspace/whitelabel@0.1.2

## 0.1.1

### Patch Changes

- Added changesets to track versions.
- Updated dependencies
  - @workspace/whitelabel@0.1.1
  - @workspace/config@0.1.1
  - @workspace/local@0.1.1
  - @workspace/demo@0.1.1
  - @workspace/ui@0.1.1
