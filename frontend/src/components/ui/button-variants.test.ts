// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * buttonVariants lives in button-variants.ts, not 'use client', so server
 * components can style a link with it (#230). Taken from the 'use client'
 * button.tsx it is a client reference, and a server component calling it
 * crashes the page (Chat's unavailable page did). A file without
 * 'use client' takes it from button-variants.
 */

const SRC = join(__dirname, '../..');
const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*['"]use client['"]/;
const FROM_CLIENT_BUTTON =
  /import\s*\{[^}]*\bbuttonVariants\b[^}]*\}\s*from\s*['"]@\/components\/ui\/button['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('buttonVariants outside client components', () => {
  it('comes from button-variants, never from the client button', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return !USE_CLIENT.test(text) && FROM_CLIENT_BUTTON.test(text);
      })
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
