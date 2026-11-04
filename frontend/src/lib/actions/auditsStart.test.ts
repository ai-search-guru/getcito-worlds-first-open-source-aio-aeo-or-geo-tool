import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Starting audits, one running audit per page (00431): a page audited in
 * the last minutes comes back as `recent` instead of an error, so the page
 * can ask "Open it or audit again?"; Audit again sends `force`.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  })),
}));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: vi.fn(async () => undefined) }));
vi.mock('@/lib/sessionRole', () => ({ isManager: vi.fn(async () => true) }));

const { runAudit, runAuditsBulk, startSiteAudits } = await import('./audits');

const BRAND = '33333333-3333-3333-3333-333333333333';
const recent = { auditId: 'audit-0', finishedAt: '2026-10-31T10:00:00.000Z' };

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
const sent = (fetch: ReturnType<typeof respond>) =>
  JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runAudit', () => {
  it('returns the running audit, the page’s own when one runs already', async () => {
    const fetch = respond(202, { success: true, audit: { id: 'a1' }, alreadyRunning: true });
    vi.stubGlobal('fetch', fetch);
    expect(await runAudit(BRAND, 'https://acme.com/pricing')).toEqual({ audit: { id: 'a1' } });
    expect(sent(fetch)).toEqual({ brandId: BRAND, url: 'https://acme.com/pricing' });
  });

  it('returns a page audited minutes ago as recent, and sends force to audit it again', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, { success: false, error: 'recently_audited', message: 'x', recent }),
    );
    expect(await runAudit(BRAND, 'https://acme.com/pricing')).toEqual({ recent });

    const fetch = respond(202, { success: true, audit: { id: 'a2' } });
    vi.stubGlobal('fetch', fetch);
    await runAudit(BRAND, 'https://acme.com/pricing', { force: true });
    expect(sent(fetch)).toMatchObject({ force: true });
  });

  it('still throws any other refusal with its message', async () => {
    vi.stubGlobal('fetch', respond(429, { error: 'quota_exceeded', message: 'Limit reached' }));
    await expect(runAudit(BRAND, 'https://acme.com/')).rejects.toThrow('Limit reached');
  });
});

describe('runAuditsBulk', () => {
  it('counts the pages running and lists the ones audited minutes ago', async () => {
    const list = [{ url: 'https://acme.com/b', ...recent }];
    const fetch = respond(202, { success: true, audits: [{ id: 'a1' }], recent: list });
    vi.stubGlobal('fetch', fetch);
    expect(await runAuditsBulk(BRAND, ['https://acme.com/a', 'https://acme.com/b'])).toEqual({
      started: 1,
      recent: list,
    });
    expect(sent(fetch)).not.toHaveProperty('force');
  });
});

describe('startSiteAudits (Chat)', () => {
  it('says a page audited minutes ago back, so Chat asks first', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, { success: false, error: 'recently_audited', message: 'x', recent }),
    );
    const result = await startSiteAudits(BRAND, ['https://acme.com/pricing']);
    expect(result).toMatchObject({
      ok: true,
      started: 0,
      audits: [],
      recent: [{ ...recent, url: 'https://acme.com/pricing' }],
    });
    expect(result.ok && result.message).toContain('force');
  });

  it('sends force when Chat runs it again', async () => {
    const fetch = respond(202, { success: true, audits: [{ id: 'a1', url: 'u' }], recent: [] });
    vi.stubGlobal('fetch', fetch);
    const result = await startSiteAudits(BRAND, ['https://acme.com/a', 'https://acme.com/b'], {
      force: true,
    });
    expect(result).toEqual({ ok: true, started: 1, audits: [{ id: 'a1', url: 'u' }] });
    expect(sent(fetch)).toMatchObject({ force: true });
  });
});
