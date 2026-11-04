// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A client component must not reach the server's Supabase client
 * (lib/supabase/server.ts, which imports next/headers): the production build
 * fails on it, as it did when Settings › Roles & access reached planGuard.ts
 * through lib/chat/planFacts.ts. This walks the imports from every
 * 'use client' file, stopping at 'use server' modules (they are called, not
 * bundled) and skipping type-only imports.
 */

const SRC = resolve(__dirname, '../..');
const SERVER_ONLY = [join(SRC, 'lib/supabase/server.ts')];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT = /^\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;

function runtimeImports(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT)) {
    const [, , typeOnly, clause, spec] = match;
    if (typeOnly) continue;
    // `import { type A, type B } from …` is elided like `import type`.
    const named = clause.match(/^\{([^}]*)\}$/);
    if (
      named &&
      named[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith('type '))
    )
      continue;
    const target = resolveImport(path, spec);
    if (target) out.push(target);
  }
  return out;
}

const isDirective = (path: string, directive: string) =>
  new RegExp(`^\\s*['"]${directive}['"]`).test(readFileSync(path, 'utf8'));

function serverOnlyPath(start: string): string[] | null {
  const seen = new Set<string>([start]);
  const queue: string[][] = [[start]];
  while (queue.length) {
    const chain = queue.shift()!;
    const current = chain[chain.length - 1];
    if (SERVER_ONLY.includes(current)) return chain;
    if (current !== start && isDirective(current, 'use server')) continue;
    for (const next of runtimeImports(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
  return null;
}

describe('client components and the server Supabase client', () => {
  // Walks every source file: past the default 5 s on a busy machine.
  it('never reach lib/supabase/server.ts', { timeout: 30_000 }, () => {
    const reached = files(SRC)
      .filter((path) => isDirective(path, 'use client'))
      .map(serverOnlyPath)
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map((p) => p.slice(SRC.length + 1)).join(' → '));
    expect(reached).toEqual([]);
  });
});

/**
 * The other way round: on the server, a 'use client' module's exports are
 * client references, not its values, so a shared module (src/lib,
 * src/config) that reads a value from one breaks every server path through
 * it, as Chat's route registry did with the date range control's presets.
 * Type-only imports are erased and fine.
 */
describe('shared modules and client components', () => {
  // Walks every source file: past the default 5 s on a busy machine.
  it('read no value from a client component', { timeout: 30_000 }, () => {
    const shared = ['lib', 'config']
      .flatMap((dir) => files(join(SRC, dir)))
      .filter((path) => !isDirective(path, 'use client'));
    const reached = shared.flatMap((path) =>
      runtimeImports(path)
        .filter((target) => isDirective(target, 'use client'))
        .map((target) => `${path.slice(SRC.length + 1)} → ${target.slice(SRC.length + 1)}`),
    );
    expect(reached).toEqual([]);
  });
});
