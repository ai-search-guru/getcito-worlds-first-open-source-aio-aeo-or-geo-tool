/**
 * BrandIdentity.test.ts  (issue #759)
 *
 * Tests the pure helpers exported from BrandIdentity.tsx.
 * Importing from the real source means these tests fail if the component changes.
 */

import { describe, expect, test } from 'vitest';
import {
  advance,
  getInitials,
  getPrimaryDomain,
  resolveInitialStage,
  resolveUrl,
  type Stage,
} from './BrandIdentity';
import { getSiteIconUrl } from '../lib/siteIcon';

describe('local site icons', () => {
  test('uses inline images for real domains', () => {
    const url = getSiteIconUrl('example.com');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('>E</text>');
    expect(url).not.toContain('example.com');
  });

  test('normalizes domains and preserves requested dimensions', () => {
    expect(getSiteIconUrl('https://example.com/some/path')).toBe(getSiteIconUrl('example.com'));
    expect(decodeURIComponent(getSiteIconUrl('example.com'))).toContain('width="128"');
    expect(decodeURIComponent(getSiteIconUrl('example.com', 64))).toContain('width="64"');
    expect(getSiteIconUrl('')).toBe('');
  });
});

describe('brand image fallback', () => {
  test('preserves an explicitly chosen logo', () => {
    const logo = 'https://cdn.example.com/logo.png';
    const stage = resolveInitialStage(logo, 'example.com');
    expect(stage).toBe('manual');
    expect(resolveUrl(stage, logo, 'example.com')).toBe(logo);
  });

  test('starts with a local icon when there is a domain', () => {
    expect(resolveInitialStage(undefined, 'example.com')).toBe('local');
    expect(resolveInitialStage('', 'example.com')).toBe('local');
    expect(resolveUrl('local', undefined, 'example.com')).toBe(getSiteIconUrl('example.com'));
  });

  test('uses initials when there is no domain', () => {
    expect(resolveInitialStage(undefined, undefined)).toBe('fallback');
    expect(resolveUrl('local', undefined, undefined)).toBeUndefined();
    expect(resolveUrl('fallback', undefined, undefined)).toBeUndefined();
  });

  test('failed manual logos fall back locally without fetching another site', () => {
    const domain = 'example.com';
    let stage: Stage = 'manual';
    stage = advance(stage, domain);
    expect(stage).toBe('local');
    expect(resolveUrl(stage, undefined, domain)?.startsWith('data:image/svg+xml,')).toBe(true);
    stage = advance(stage, domain);
    expect(stage).toBe('fallback');
    expect(resolveUrl(stage, undefined, domain)).toBeUndefined();
    expect(advance(stage, domain)).toBe('fallback');
  });

  test('failed manual logos without a domain go directly to initials', () => {
    expect(advance('manual', undefined)).toBe('fallback');
  });
});

// ─── getInitials ──────────────────────────────────────────────────────────────

describe('getInitials', () => {
  test('single word → first letter uppercased', () => {
    expect(getInitials('Acme')).toBe('A');
  });

  test('two words → two initials', () => {
    expect(getInitials('Acme Corp')).toBe('AC');
  });

  test('three words → capped at 2', () => {
    expect(getInitials('Acme Big Corp')).toBe('AB');
  });

  test('already uppercase input', () => {
    expect(getInitials('GOOGLE')).toBe('G');
  });

  test('lowercase input → uppercased', () => {
    expect(getInitials('vercel')).toBe('V');
  });
});

// ─── getPrimaryDomain ─────────────────────────────────────────────────────────

describe('getPrimaryDomain', () => {
  test('returns primary domain from list', () => {
    const domains = [
      { domain: 'other.com', isPrimary: false },
      { domain: 'main.com', isPrimary: true },
    ];
    expect(getPrimaryDomain(domains)).toBe('main.com');
  });

  test('returns undefined when no primary', () => {
    expect(getPrimaryDomain([{ domain: 'other.com', isPrimary: false }])).toBeUndefined();
  });

  test('returns undefined for empty array', () => {
    expect(getPrimaryDomain([])).toBeUndefined();
  });

  test('returns undefined for undefined input', () => {
    expect(getPrimaryDomain(undefined)).toBeUndefined();
  });
});
