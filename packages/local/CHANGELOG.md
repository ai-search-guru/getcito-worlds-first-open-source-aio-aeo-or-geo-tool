# @workspace/local

## 0.2.14

### Patch Changes

- @workspace/config@0.2.14

## 0.2.13

### Patch Changes

- @workspace/config@0.2.13

## 0.2.12

### Patch Changes

- @workspace/config@0.2.12

## 0.2.11

### Patch Changes

- @workspace/config@0.2.11

## 0.2.10

### Patch Changes

- @workspace/config@0.2.10

## 0.2.9

### Patch Changes

- @workspace/config@0.2.9

## 0.2.8

### Patch Changes

- @workspace/config@0.2.8

## 0.2.7

### Patch Changes

- @workspace/config@0.2.7

## 0.2.6

### Patch Changes

- @workspace/config@0.2.6

## 0.2.5

### Patch Changes

- 7cba46d: License Getcito under the MIT License. Add Code of Conduct, Contributing guide, Security policy, and a lightweight CLA process.
- Updated dependencies [edf97d4]
- Updated dependencies [7cba46d]
  - @workspace/config@0.2.5

## 0.2.4

### Patch Changes

- 67a0389: Fix local-mode registration end-to-end and lock down the auth surface. The first `/auth/register` submission in local mode now atomically creates the default org + admin membership, so register → brand onboarding works in one pass; any subsequent signup is rejected. Demo mode narrows writable `/api/auth/**` endpoints to a whitelist of just sign-in and sign-out. Drops the unused `DEFAULT_ORG_ID` and `DEFAULT_ORG_NAME` env vars.
- Updated dependencies [67a0389]
  - @workspace/config@0.2.4

## 0.2.3

### Patch Changes

- @workspace/config@0.2.3

## 0.2.2

### Patch Changes

- d3839b1: Demo deployments (`READ_ONLY=true`) now enable `supportsMultiOrg`, so the `/app` brand switcher renders when the demo user is seeded into multiple organizations. Pure local deployments continue to auto-redirect to the default org.
  - @workspace/config@0.2.2

## 0.2.1

### Patch Changes

- @workspace/config@0.2.1

## 0.2.0

### Patch Changes

- @workspace/config@0.2.0

## 0.1.2

### Patch Changes

- @workspace/config@0.1.2

## 0.1.1

### Patch Changes

- Added changesets to track versions.
- Updated dependencies
  - @workspace/config@0.1.1
