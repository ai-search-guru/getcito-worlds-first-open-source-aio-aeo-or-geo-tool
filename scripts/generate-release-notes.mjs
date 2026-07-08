#!/usr/bin/env node
// Generate a GitHub release body for a given version in the style of
// https://github.com/calcom/cal.diy/releases — a flat "What's Changed" list of
// PRs with author attribution, followed by a Full Changelog compare link.
//
// Usage:
//   node scripts/generate-release-notes.mjs [version]
//   node scripts/generate-release-notes.mjs 0.2.1 > /tmp/notes.md
//
// Defaults to the version in apps/cli/package.json.
//
// Requires `gh` (authenticated) for PR author lookup. Falls back gracefully
// when a commit can't be resolved — the entry still appears, just without
// author attribution.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const version =
  process.argv[2] ??
  JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'apps/cli/package.json'), 'utf8'),
  ).version;

const repoSlug = (() => {
  const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  if (!m) throw new Error(`cannot parse github repo from remote: ${url}`);
  return m[1];
})();

function readChangelog(pkgDir) {
  const clPath = path.join(pkgDir, 'CHANGELOG.md');
  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(clPath) || !fs.existsSync(pkgPath)) return null;
  return {
    pkg: JSON.parse(fs.readFileSync(pkgPath, 'utf8')),
    text: fs.readFileSync(clPath, 'utf8'),
  };
}

function extractVersionSection(text, v) {
  const lines = text.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `## ${v}`) {
      start = i + 1;
      continue;
    }
    if (start >= 0 && lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  return lines.slice(start, end).join('\n').trim();
}

function previousVersion(text, v) {
  const re = /^## (\d+\.\d+\.\d+)/gm;
  const versions = [...text.matchAll(re)].map((m) => m[1]);
  const idx = versions.indexOf(v);
  if (idx < 0) return null;
  return versions[idx + 1] ?? null;
}

function allPackageDirs() {
  const dirs = [];
  for (const root of ['apps', 'packages']) {
    const p = path.join(repoRoot, root);
    if (!fs.existsSync(p)) continue;
    for (const d of fs.readdirSync(p).sort()) {
      dirs.push(path.join(p, d));
    }
  }
  return dirs;
}

// Collect `- <sha>: <message>` bullets from the version section of every
// package's changelog. Dedupe by sha. Skip "Updated dependencies" entries and
// internal package bump lines (`- @workspace/x@0.2.1`).
function collectChanges(v) {
  const bySha = new Map();
  const unattributed = [];
  for (const dir of allPackageDirs()) {
    const entry = readChangelog(dir);
    if (!entry) continue;
    const section = extractVersionSection(entry.text, v);
    if (!section) continue;
    for (const raw of section.split('\n')) {
      const line = raw.trim();
      const m = line.match(/^-\s+([0-9a-f]{7,40}):\s+(.+)$/);
      if (m) {
        const [, sha, message] = m;
        if (!bySha.has(sha)) bySha.set(sha, { sha, message });
        continue;
      }
      // Manual changeset bullet with no sha prefix — keep if it's not a
      // dependency-bump artifact.
      if (
        line.startsWith('- ') &&
        !line.startsWith('- Updated dependencies') &&
        !/^-\s+@[\w-]+\/[\w-]+@\d/.test(line) &&
        !/^-\s+\w+@\d/.test(line)
      ) {
        unattributed.push({ message: line.slice(2).trim() });
      }
    }
  }
  return { sha: [...bySha.values()], unattributed };
}

function enrichFromGit(sha) {
  try {
    const subject = execFileSync(
      'git',
      ['log', '-1', '--format=%s', sha],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    const prMatch = subject.match(/\(#(\d+)\)\s*$/);
    return {
      subject,
      pr: prMatch ? Number(prMatch[1]) : null,
    };
  } catch {
    return { subject: null, pr: null };
  }
}

function ghAuthor(sha) {
  try {
    const out = execFileSync(
      'gh',
      ['api', `repos/${repoSlug}/commits/${sha}`, '--jq', '.author.login'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

const { sha: shaChanges, unattributed } = collectChanges(version);

const lines = [];
lines.push("## What's Changed", '');

for (const change of shaChanges) {
  const { pr } = enrichFromGit(change.sha);
  const author = ghAuthor(change.sha);
  const suffix = [];
  if (author) suffix.push(`by @${author}`);
  if (pr) suffix.push(`in https://github.com/${repoSlug}/pull/${pr}`);
  const tail = suffix.length ? ` ${suffix.join(' ')}` : ` (${change.sha})`;
  lines.push(`* ${change.message}${tail}`);
}
for (const change of unattributed) {
  lines.push(`* ${change.message}`);
}

if (shaChanges.length === 0 && unattributed.length === 0) {
  lines.push(`* Release v${version}`);
}

const prev = (() => {
  const cli = readChangelog(path.join(repoRoot, 'apps/cli'));
  return cli ? previousVersion(cli.text, version) : null;
})();
if (prev) {
  lines.push('', '', `**Full Changelog**: https://github.com/${repoSlug}/compare/v${prev}...v${version}`);
} else {
  lines.push('', '', `**Full Changelog**: https://github.com/${repoSlug}/releases/tag/v${version}`);
}

process.stdout.write(`${lines.join('\n')}\n`);
