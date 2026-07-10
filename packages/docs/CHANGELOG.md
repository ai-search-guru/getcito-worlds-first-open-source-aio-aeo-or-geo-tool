# @workspace/docs

## 0.2.14

### Patch Changes

- @workspace/ui@0.2.14

## 0.2.13

### Patch Changes

- @workspace/ui@0.2.13

## 0.2.12

### Patch Changes

- @workspace/ui@0.2.12

## 0.2.11

### Patch Changes

- 4ccba7a: Remove `Getcito status` — use `Getcito compose ps` instead.
  - @workspace/ui@0.2.11

## 0.2.10

### Patch Changes

- 063e33e: Remove `Getcito start`, `Getcito stop`, `Getcito logs`, and `Getcito build` aliases — use `Getcito compose <args>` directly (e.g. `Getcito compose up -d`, `Getcito compose down`, `Getcito compose logs -f`, `Getcito compose build`).
  - @workspace/ui@0.2.10

## 0.2.9

### Patch Changes

- @workspace/ui@0.2.9

## 0.2.8

### Patch Changes

- @workspace/ui@0.2.8

## 0.2.7

### Patch Changes

- @workspace/ui@0.2.7

## 0.2.6

### Patch Changes

- @workspace/ui@0.2.6

## 0.2.5

### Patch Changes

- 76e2a5f: Add telemetry opt-out prompt during `Getcito init` and new `Getcito telemetry status|enable|disable` subcommand. See [Telemetry](https://Getcitohq.com/docs/developer-guide/telemetry) for what's collected.
- edf97d4: Add Mistral as a direct API provider. Set `MISTRAL_API_KEY` and target via `mistral:mistral-api:<model>[:online]`.
- 7cba46d: License Getcito under the MIT License. Add Code of Conduct, Contributing guide, Security policy, and a lightweight CLA process.
- Updated dependencies [7cba46d]
  - @workspace/ui@0.2.5

## 0.2.4

### Patch Changes

- @workspace/ui@0.2.4

## 0.2.3

### Patch Changes

- @workspace/ui@0.2.3

## 0.2.2

### Patch Changes

- 06fb190: Worker dispatch now reads `SCRAPE_TARGETS` end-to-end via the provider registry. Deployments that configure non-default providers no longer hit `AI_LoadAPIKeyError` for providers they never set up, the worker fails fast at startup on misconfigured `SCRAPE_TARGETS`, and `brand.enabledModels` filters per brand.
  - @workspace/ui@0.2.2

## 0.2.1

### Patch Changes

- adf7642: CLI `Getcito init` now walks through each provider one at a time.
  - @workspace/ui@0.2.1

## 0.2.0

### Patch Changes

- @workspace/ui@0.2.0
