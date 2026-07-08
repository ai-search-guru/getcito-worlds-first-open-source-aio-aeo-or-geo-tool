#!/usr/bin/env node

/**
 * Sync the monorepo root package version to the release train.
 *
 * The root `getcito` package is not a workspace member, so `changeset version`
 * never bumps it and it drifts behind the published packages. Every workspace
 * package shares a single version (changesets `fixed: [["**"]]`), so we copy
 * that version onto the root purely as a visual marker of the current release.
 * Runs automatically as part of `pnpm version-packages`.
 *
 * Idempotent: only rewrites the root manifest when the version differs, and
 * touches only the version string so the rest of the file is left untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootPkgPath = join(rootDir, "package.json");

// The published CLI is part of the fixed version group, so its version is the
// canonical release version shared by every workspace package.
const sourceVersion = JSON.parse(
  readFileSync(join(rootDir, "apps/cli/package.json"), "utf8"),
).version;

const rootContent = readFileSync(rootPkgPath, "utf8");
const currentVersion = JSON.parse(rootContent).version;

if (currentVersion === sourceVersion) {
  console.log(`Root version already at ${sourceVersion}; nothing to sync.`);
  process.exit(0);
}

// Replace only the first "version" field (the root package's own) so the rest
// of the manifest's formatting is left untouched.
const updated = rootContent.replace(
  /"version":\s*"[^"]*"/,
  `"version": "${sourceVersion}"`,
);

writeFileSync(rootPkgPath, updated);
console.log(`Synced root version ${currentVersion} → ${sourceVersion}.`);
