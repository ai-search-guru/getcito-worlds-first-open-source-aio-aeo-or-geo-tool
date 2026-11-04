// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/mcp/site-audits: a Site Audit refused for a read-only workspace
 * (runSiteAuditFor's own check) answers 402 subscription_inactive, as the
 * route's gate does; any other failure is still a 500.
 */

const { runSiteAuditFor } = vi.hoisted(() => ({ runSiteAuditFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/data', () => ({ runSiteAuditFor, listSiteAuditsFor: vi.fn() }));

const { POST } = await import('./route');
const { SubscriptionInactiveError } = await import('@/lib/mcp/subscriptionGate');

const post = () =>
  POST(
    new Request('http://localhost/api/mcp/site-audits', {
      method: 'POST',
      body: JSON.stringify({ brand_id: 'brand-1', url: 'https://getcito.com' }),
    }),
  );

// Braces: a function returned from beforeEach runs as its teardown.
beforeEach(() => {
  runSiteAuditFor.mockReset();
});

describe('POST /api/mcp/site-audits', () => {
  it('answers 402 subscription_inactive when the audit is refused for a read-only workspace', async () => {
    runSiteAuditFor.mockRejectedValue(new SubscriptionInactiveError());
    const res = await post();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
    });
  });

  it('keeps any other failure a 500 with its message', async () => {
    runSiteAuditFor.mockRejectedValue(new Error('Internal site-audit endpoint returned 503'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal site-audit endpoint returned 503' });
  });

  it('starts the audit otherwise', async () => {
    runSiteAuditFor.mockResolvedValue({ id: 'audit-1', status: 'running' });
    const res = await post();
    expect(res.status).toBe(202);
  });

  it('answers 200 with the audit of a page audited minutes ago, starting nothing', async () => {
    runSiteAuditFor.mockResolvedValue({ id: 'audit-0', status: 'recently_audited' });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'audit-0', status: 'recently_audited' });
    expect(runSiteAuditFor).toHaveBeenCalledWith(
      expect.anything(),
      'brand-1',
      'https://getcito.com',
      { force: false },
    );
  });
});
