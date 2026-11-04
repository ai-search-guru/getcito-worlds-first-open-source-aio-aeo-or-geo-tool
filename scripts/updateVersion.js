#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PACKAGE_PATHS = [
  resolve(root, "package.json"),
  resolve(root, "frontend/package.json"),
  resolve(root, "backend/package.json"),
];
const COMPOSE_PATH = resolve(root, "docker-compose.yml");

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function bump(current, type) {
  const v = parseVersion(current);
  switch (type) {
    case "major":
      return `${v.major + 1}.0.0`;
    case "minor":
      return `${v.major}.${v.minor + 1}.0`;
    case "patch":
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      // Explicit version provided
      parseVersion(type); // validate
      return type;
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node updateVersion.js <patch|minor|major|x.y.z>");
  process.exit(1);
}

const rootPkg = JSON.parse(readFileSync(PACKAGE_PATHS[0], "utf8"));
const oldVersion = rootPkg.version;
const newVersion = bump(oldVersion, arg);

// Prepare and validate every update before writing any version changes.
const updates = new Map();
for (const pkgPath of PACKAGE_PATHS) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = newVersion;
  updates.set(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

const lockPath = resolve(root, "backend/package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = newVersion;
lock.packages[""].version = newVersion;
updates.set(lockPath, JSON.stringify(lock, null, 2) + "\n");

for (const service of ["frontend", "backend"]) {
  const dockerPath = resolve(root, service, "Dockerfile");
  const dockerfile = readFileSync(dockerPath, "utf8");
  if (!/^ARG VERSION=\d+\.\d+\.\d+$/m.test(dockerfile)) {
    throw new Error(`No version argument found in ${service}/Dockerfile`);
  }
  updates.set(
    dockerPath,
    dockerfile.replace(
      /^ARG VERSION=\d+\.\d+\.\d+$/m,
      `ARG VERSION=${newVersion}`,
    ),
  );
}

const compose = readFileSync(COMPOSE_PATH, "utf8");
let updatedImageCount = 0;
const updatedCompose = compose.replace(
  /(image:\s*getcito-(?:web|server):)\d+\.\d+\.\d+/g,
  (_, prefix) => {
    updatedImageCount += 1;
    return `${prefix}${newVersion}`;
  },
);

if (updatedImageCount !== 2) {
  throw new Error("Expected both web and server docker-compose image tags");
}

updates.set(COMPOSE_PATH, updatedCompose);
for (const [path, content] of updates) writeFileSync(path, content);

console.log(`${oldVersion} -> ${newVersion}`);
