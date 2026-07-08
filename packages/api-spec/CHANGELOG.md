# @workspace/api-spec

## 0.2.14

## 0.2.13

### Patch Changes

- c4505ba: Breaking: `/api/v1` DELETE endpoints now return the deleted resource directly instead of a `{ message, data }` wrapper (the deleted prompt includes a `deletedRunsCount` field), PATCH endpoints reject an empty body with a 400, an unparseable `website` on `/tools/analyze` is now a 400 instead of a 500, and 500 responses no longer echo internal error messages.

## 0.2.12

## 0.2.11

## 0.2.10

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

### Patch Changes

- 1a1005a: Admin `/api/v1/brands` endpoints (POST, GET, PATCH) now accept and return a single `domains` list instead of `website` + `additionalDomains`. This future-proofs against a future db model change.

## 0.2.5

### Patch Changes

- 7cba46d: License Getcito under the MIT License. Add Code of Conduct, Contributing guide, Security policy, and a lightweight CLA process.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

### Minor Changes

- 95b71db: Replace visibility % with Share of Voice metric across reports, add reports API, and redesign report for print
