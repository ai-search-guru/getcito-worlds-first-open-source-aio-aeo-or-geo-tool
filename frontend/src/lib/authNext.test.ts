import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NEXT,
  nextFromCookie,
  nextFromRequest,
  safeNextPath,
  safeRedirectUrl,
} from './authNext';

/** After signing in, back to the page asked for — and only to one of ours. */

describe('safeNextPath', () => {
  it('keeps a page on this site, with its query and hash', () => {
    expect(safeNextPath('/dashboard/traffic')).toBe('/dashboard/traffic');
    expect(safeNextPath('/dashboard/settings?tab=notifications')).toBe(
      '/dashboard/settings?tab=notifications',
    );
    expect(safeNextPath('/dashboard/action-center/actions?action=a1#tasks')).toBe(
      '/dashboard/action-center/actions?action=a1#tasks',
    );
  });

  it('sends anything that could leave the site to the dashboard', () => {
    for (const value of [
      null,
      undefined,
      '',
      'dashboard',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      'https://evil.example/dashboard',
      'javascript:alert(1)',
      '@evil.example',
      '/dash\tboard',
      '/\nevil',
    ]) {
      expect(safeNextPath(value), String(value)).toBe(DEFAULT_NEXT);
    }
  });
});

describe('safeRedirectUrl', () => {
  const origin = 'https://app.example.com';
  afterEach(() => vi.unstubAllEnvs());

  it('keeps a path on this site, with its query and hash', () => {
    expect(safeRedirectUrl('/reset-password', origin)).toBe(
      'https://app.example.com/reset-password',
    );
    expect(safeRedirectUrl('/dashboard/settings?tab=notifications#team', origin)).toBe(
      'https://app.example.com/dashboard/settings?tab=notifications#team',
    );
  });

  it("keeps a whole URL only on the request's or the app's own origin", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.app.example.com/');
    expect(safeRedirectUrl('https://app.example.com/invite/t1', origin)).toBe(
      'https://app.example.com/invite/t1',
    );
    expect(safeRedirectUrl('https://www.app.example.com/invite/t1?x=1', origin)).toBe(
      'https://www.app.example.com/invite/t1?x=1',
    );
    expect(safeRedirectUrl('https://user@app.example.com/invite/t1', origin)).toBe(
      'https://app.example.com/invite/t1',
    );
  });

  it('sends anything else to the dashboard', () => {
    for (const value of [
      null,
      '',
      'dashboard',
      '//evil.example',
      '/\\evil.example',
      '@evil.example',
      'javascript:alert(1)',
      'https://evil.example/invite/t1',
      'https://app.example.com.evil.example/',
      'https://app.example.com@evil.example/',
      'http://app.example.com/dashboard',
      'https://app.example.com:8443/dashboard',
      'https://%zz',
    ]) {
      expect(safeRedirectUrl(value, origin), String(value)).toBe(
        `https://app.example.com${DEFAULT_NEXT}`,
      );
    }
  });
});

describe('nextFromRequest', () => {
  it('names the page without its locale prefix, query included', () => {
    expect(nextFromRequest('/dashboard/traffic', '?tab=pages')).toBe(
      '/dashboard/traffic?tab=pages',
    );
    expect(nextFromRequest('/dashboard', '')).toBe('/dashboard');
  });
});

describe('nextFromCookie', () => {
  it('reads the page the OAuth buttons stored, encoded', () => {
    expect(nextFromCookie(encodeURIComponent('/dashboard/traffic?tab=pages'))).toBe(
      '/dashboard/traffic?tab=pages',
    );
    expect(nextFromCookie(undefined)).toBeNull();
    expect(nextFromCookie('%E0%A4%A')).toBeNull();
  });
});
