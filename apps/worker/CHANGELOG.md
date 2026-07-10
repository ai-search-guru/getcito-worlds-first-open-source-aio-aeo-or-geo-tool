# @workspace/worker

## 0.2.14

### Patch Changes

- @workspace/lib@0.2.14
- @workspace/whitelabel@0.2.14

## 0.2.13

### Patch Changes

- @workspace/lib@0.2.13
- @workspace/whitelabel@0.2.13

## 0.2.12

### Patch Changes

- 7ce34f1: Fixes bug where in some cases BrightData processing could get stuck.
  - @workspace/lib@0.2.12
  - @workspace/whitelabel@0.2.12

## 0.2.11

### Patch Changes

- @workspace/lib@0.2.11
- @workspace/whitelabel@0.2.11

## 0.2.10

### Patch Changes

- Updated dependencies [520aef4]
  - @workspace/lib@0.2.10
  - @workspace/whitelabel@0.2.10

## 0.2.9

### Patch Changes

- a2a9681: Attach a `boss.on("error")` handler so transient pg-boss connection blips no longer crash the worker.
  - @workspace/lib@0.2.9
  - @workspace/whitelabel@0.2.9

## 0.2.8

### Patch Changes

- @workspace/lib@0.2.8
- @workspace/whitelabel@0.2.8

## 0.2.7

### Patch Changes

- 1e770ff: Publish multi-arch (`linux/amd64` + `linux/arm64`) Docker images for `ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool-web` and `ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool-worker`, so Apple Silicon and other arm64 hosts can pull them.
  - @workspace/lib@0.2.7
  - @workspace/whitelabel@0.2.7

## 0.2.6

### Patch Changes

- @workspace/lib@0.2.6
- @workspace/whitelabel@0.2.6

## 0.2.5

### Patch Changes

- 76e2a5f: Add telemetry opt-out prompt during `Getcito init` and new `Getcito telemetry status|enable|disable` subcommand. See [Telemetry](https://Getcitohq.com/docs/developer-guide/telemetry) for what's collected.
- 7cba46d: License Getcito under the MIT License. Add Code of Conduct, Contributing guide, Security policy, and a lightweight CLA process.
- 839b98b: Brand onboarding is now a single screen: paste a website and review the suggested products, competitors (with their own domains and aliases), additional brand domains, aliases, and tagged starter prompts before saving. Powered by whichever direct LLM API you've configured (OpenRouter, Anthropic, OpenAI, or Mistral) with web search.
- Updated dependencies [7990382]
- Updated dependencies [edf97d4]
- Updated dependencies [7cba46d]
- Updated dependencies [839b98b]
  - @workspace/lib@0.2.5
  - @workspace/whitelabel@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [67a0389]
  - @workspace/lib@0.2.4
  - @workspace/whitelabel@0.2.4

## 0.2.3

### Patch Changes

- @workspace/lib@0.2.3
- @workspace/whitelabel@0.2.3

## 0.2.2

### Patch Changes

- 06fb190: Worker dispatch now reads `SCRAPE_TARGETS` end-to-end via the provider registry. Deployments that configure non-default providers no longer hit `AI_LoadAPIKeyError` for providers they never set up, the worker fails fast at startup on misconfigured `SCRAPE_TARGETS`, and `brand.enabledModels` filters per brand.
- Updated dependencies [63a6c22]
- Updated dependencies [06fb190]
  - @workspace/lib@0.2.2
  - @workspace/whitelabel@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [adf7642]
  - @workspace/lib@0.2.1
  - @workspace/whitelabel@0.2.1

## 0.2.0

### Minor Changes

- 95b71db: Replace visibility % with Share of Voice metric across reports, add reports API, and redesign report for print

### Patch Changes

- Updated dependencies [95b71db]
  - @workspace/lib@0.2.0
  - @workspace/whitelabel@0.2.0

## 0.1.2

### Patch Changes

- @workspace/lib@0.1.2

## 0.1.1

### Patch Changes

- Initial release: Extracted worker from web app into standalone app.
