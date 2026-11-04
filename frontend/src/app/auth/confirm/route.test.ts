import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /auth/confirm, where invite and password reset e-mails land: the OTP is
 * verified, then on to the page the link names, and only to one of ours
 * (#1203).
 */

const verifyOtp = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

const { GET } = await import('./route');

const confirm = (query: string) =>
  GET(new Request(`https://app.example.com/auth/confirm?token_hash=h1&type=invite&${query}`));

beforeEach(() => verifyOtp.mockReset().mockResolvedValue({ error: null }));
afterEach(() => vi.unstubAllEnvs());

describe('GET /auth/confirm', () => {
  it('goes on to the invite and password reset pages', async () => {
    let res = await confirm(`next=${encodeURIComponent('/invite/t1')}`);
    expect(res.headers.get('location')).toBe('https://app.example.com/invite/t1');

    res = await confirm('next=/reset-password');
    expect(res.headers.get('location')).toBe('https://app.example.com/reset-password');

    // Supabase expands {{ .RedirectTo }}, which the resend builds from NEXT_PUBLIC_APP_URL.
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    res = await confirm(`redirect_to=${encodeURIComponent('https://app.example.com/invite/t1')}`);
    expect(res.headers.get('location')).toBe('https://app.example.com/invite/t1');
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'h1' });
  });

  it('keeps a page on this site with its query and hash', async () => {
    const res = await confirm(
      `next=${encodeURIComponent('/dashboard/settings?tab=notifications#team')}`,
    );
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/dashboard/settings?tab=notifications#team',
    );
  });

  it('never leaves the site', async () => {
    for (const target of [
      '//evil.example',
      '/\\evil.example',
      '@evil.example',
      'https://evil.example/invite/t1',
      'javascript:alert(1)',
    ]) {
      for (const param of ['redirect_to', 'next']) {
        const res = await confirm(`${param}=${encodeURIComponent(target)}`);
        expect(res.headers.get('location'), `${param}=${target}`).toBe(
          'https://app.example.com/dashboard',
        );
      }
    }
  });

  it('sends a failed or incomplete link back to the sign-in page', async () => {
    let res = await GET(new Request('https://app.example.com/auth/confirm?next=/reset-password'));
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/sign-in?error=auth_confirm_missing_params',
    );

    verifyOtp.mockResolvedValue({ error: { message: 'expired' } });
    res = await confirm('next=/reset-password');
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/sign-in?error=auth_confirm_failed&reason=expired',
    );
  });
});
