import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /auth/callback, where GitHub and Google sign-in come back: on to the page
 * the visitor asked for (`?next=` or the OAuth buttons' cookie), only one of
 * ours, and the cookie is cleared.
 */

const exchange = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

const { GET } = await import('./route');

const callback = (query: string, cookie?: string) =>
  GET(
    new NextRequest(`https://app.example.com/auth/callback?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );

beforeEach(() => exchange.mockReset().mockResolvedValue({ error: null }));

describe('GET /auth/callback', () => {
  it('goes on to ?next=, or the page the OAuth buttons kept, and clears the cookie', async () => {
    let res = await callback('code=c1&next=%2Fdashboard%2Ftraffic%3Ftab%3Dpages');
    expect(res.headers.get('location')).toBe('https://app.example.com/dashboard/traffic?tab=pages');

    res = await callback(
      'code=c1',
      `auth_next=${encodeURIComponent('/dashboard/settings?tab=notifications')}`,
    );
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/dashboard/settings?tab=notifications',
    );
    expect(res.headers.get('set-cookie')).toMatch(
      /^auth_next=;.*Max-Age=0|Expires=Thu, 01 Jan 1970/,
    );
  });

  it('never leaves the site, and goes to the dashboard without a page', async () => {
    for (const next of ['@evil.example', '//evil.example', 'https://evil.example']) {
      const res = await callback(`code=c1&next=${encodeURIComponent(next)}`);
      expect(res.headers.get('location'), next).toBe('https://app.example.com/dashboard');
    }
    const res = await callback('code=c1');
    expect(res.headers.get('location')).toBe('https://app.example.com/dashboard');
  });

  it('sends a failed sign-in back to the sign-in page', async () => {
    exchange.mockResolvedValue({ error: { message: 'bad code' } });
    const res = await callback('code=c1&next=%2Fdashboard%2Ftraffic');
    expect(res.headers.get('location')).toBe('https://app.example.com/sign-in?error=auth');
  });
});
