import { describe, expect, it, vi } from 'vitest';

/**
 * next-intl rewrites `/auth/*` to `/[locale]/auth/*`, so these files answer
 * the auth URLs. They must run the root routes' code, not a copy (#1203).
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

describe('locale auth routes', () => {
  it('serve the root callback and confirm handlers', async () => {
    const [localeCallback, rootCallback, localeConfirm, rootConfirm] = await Promise.all([
      import('./callback/route'),
      import('@/app/auth/callback/route'),
      import('./confirm/route'),
      import('@/app/auth/confirm/route'),
    ]);
    expect(localeCallback.GET).toBe(rootCallback.GET);
    expect(localeConfirm.GET).toBe(rootConfirm.GET);
  });
});
