import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * "Send to Action Center" on a Site Audit report (learning D2): the server's
 * answer returned as it is, and its refusals with their code, so the report
 * can say why; an older report names the page's latest audit to open.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  })),
}));

const { sendAuditToActionCenter } = await import('./audits');

const BRAND = '33333333-3333-3333-3333-333333333333';
const AUDIT = '44444444-4444-4444-4444-444444444444';

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendAuditToActionCenter', () => {
  it('posts the brand and audit as the user and returns the action', async () => {
    const fetch = respond(201, { actionId: 'act-1', actionNo: 71, created: true });
    vi.stubGlobal('fetch', fetch);
    expect(await sendAuditToActionCenter(BRAND, AUDIT)).toEqual({
      actionId: 'act-1',
      actionNo: 71,
      created: true,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/action-center/audits');
    expect(JSON.parse(String(init.body))).toEqual({ brandId: BRAND, auditId: AUDIT });
  });

  it("returns an older report's refusal with the page's latest audit", async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        error: 'Failed to send to the Action Center',
        details: 'The page has a newer audit',
        code: 'newer_audit',
        latestAuditId: 'a-new',
      }),
    );
    expect(await sendAuditToActionCenter(BRAND, AUDIT)).toEqual({
      error: 'The page has a newer audit',
      code: 'newer_audit',
      latestAuditId: 'a-new',
    });
  });

  it('returns other refusals with their code only', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        error: 'Failed to send to the Action Center',
        details: 'The page passes its checks',
        code: 'nothing_to_fix',
      }),
    );
    expect(await sendAuditToActionCenter(BRAND, AUDIT)).toEqual({
      error: 'The page passes its checks',
      code: 'nothing_to_fix',
    });
  });
});
