# @workspace/lib

## 0.2.14

### Patch Changes

- @workspace/config@0.2.14

## 0.2.13

### Patch Changes

- @workspace/config@0.2.13

## 0.2.12

## 0.2.11

## 0.2.10

### Patch Changes

- 520aef4: Log start/done (with duration and result counts) for `analyzeBrand`, so the onboarding analyze step is visible in the web server logs.

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

### Patch Changes

- 7990382: BrightData: prefer `answer_text_markdown` over `answer_text` when extracting response text, so prompt responses render with markdown formatting in the UI.
- edf97d4: Add Mistral as a direct API provider. Set `MISTRAL_API_KEY` and target via `mistral:mistral-api:<model>[:online]`.
- 7cba46d: License Getcito under the MIT License. Add Code of Conduct, Contributing guide, Security policy, and a lightweight CLA process.
- 839b98b: Brand onboarding is now a single screen: paste a website and review the suggested products, competitors (with their own domains and aliases), additional brand domains, aliases, and tagged starter prompts before saving. Powered by whichever direct LLM API you've configured (OpenRouter, Anthropic, OpenAI, or Mistral) with web search.

## 0.2.4

### Patch Changes

- 67a0389: Fix local-mode registration end-to-end and lock down the auth surface. The first `/auth/register` submission in local mode now atomically creates the default org + admin membership, so register → brand onboarding works in one pass; any subsequent signup is rejected. Demo mode narrows writable `/api/auth/**` endpoints to a whitelist of just sign-in and sign-out. Drops the unused `DEFAULT_ORG_ID` and `DEFAULT_ORG_NAME` env vars.

## 0.2.3

## 0.2.2

### Patch Changes

- 63a6c22: Demo mode: visitors can now actually sign in — better-auth endpoints are exempt from the read-only write-block, and the login form pre-fills the seeded demo credentials.
- 06fb190: Worker dispatch now reads `SCRAPE_TARGETS` end-to-end via the provider registry. Deployments that configure non-default providers no longer hit `AI_LoadAPIKeyError` for providers they never set up, the worker fails fast at startup on misconfigured `SCRAPE_TARGETS`, and `brand.enabledModels` filters per brand.

## 0.2.1

### Patch Changes

- adf7642: CLI `Getcito init` now walks through each provider one at a time.

## 0.2.0

### Minor Changes

- 95b71db: Replace visibility % with Share of Voice metric across reports, add reports API, and redesign report for print

## 0.1.2
