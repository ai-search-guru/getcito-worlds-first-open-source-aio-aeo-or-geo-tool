// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * The server actions Chat's content rows call (W2-07), as they run against
 * the member's own client: a page goes to the CMS as the Library sends it
 * (its kept slug, a page with placeholders refused), never to the webhook
 * and never over a live page, and the API's answers come back as Chat's
 * codes; audits start on the API's one-page or bulk route, its quota said
 * back; a draft's change keeps the page before in History first, or isn't
 * made; each is an Admin's or a Manager's; and none throws.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      },
    }),
}));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const readCmsSources = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cmsSources', () => ({ readCmsSources }));

const { createFakeSupabase } = await import('@/lib/chat/testing/fakeSupabase');
const { publishDraftToCms, sendDraftToCms } = await import('./cmsSend');
const { startSiteAudits } = await import('./audits');
const { updateContentDraft } = await import('./contentDrafts');

const ORG = 'org-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const DRAFT = '33333333-3333-4333-8333-333333333333';

let requests: { url: string; body: Record<string, unknown> }[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  fake.db = createFakeSupabase();
  Object.assign(fake.db.tables, {
    profiles: [{ id: 'u1', role: 'manager', organization_id: ORG }],
    chat_settings: [],
    content_draft_deliveries: [],
    content_drafts: [
      {
        id: DRAFT,
        brand_id: BRAND,
        title: 'Pricing FAQ',
        body_html: '<h1>Pricing FAQ</h1><p>Plans start at $49.</p>',
        updated_at: '2026-10-30T09:00:00.000Z',
        archived_at: null,
        slug: 'pricing-faq',
        published_url: null,
        agent_state: null,
        agent_state_at: null,
        meta_title: null,
        meta_description: null,
        brands: { name: 'Acme', language: 'en' },
      },
    ],
  });
  readCmsSources.mockClear();
  readCmsSources.mockImplementation(async ({ draftIds }: { draftIds: string[] }) => {
    const draft = fake.db.tables.content_drafts.find((d) => d.id === draftIds[0]);
    return new Map(
      draft
        ? [
            [
              draft.id,
              {
                draftId: draft.id,
                title: draft.title,
                html: draft.body_html,
                sourceUrl: null,
                author: null,
                teamByline: '',
                byline: null,
                reviewer: null,
                // Not an article: no Article schema (00448).
                schema: {
                  input: {
                    title: draft.title,
                    author: null,
                    authorUrl: null,
                    brandName: 'Acme',
                    brandUrl: null,
                    isNew: false,
                  },
                  pageType: null,
                  leftOut: false,
                },
              },
            ],
          ]
        : [],
    );
  });
  requests = [];
  answer = { status: 200, body: { deliveries: [{ id: 'd1', draftId: DRAFT, status: 'sent' }] } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const asRole = (role: string) => {
  fake.db.tables.profiles = [{ id: 'u1', role, organization_id: ORG }];
};
/** An Admin's "Managers can't go live" switches in Settings › Chat (chat_settings, 00401). */
const managersCantGoLive = (groups: string[]) => {
  fake.db.tables.chat_settings = [{ organization_id: ORG, manager_execute_off: groups }];
};

describe('sendDraftToCms', () => {
  it('sends the page as the Library does, with the slug it kept, to the API’s send', async () => {
    expect(await sendDraftToCms(DRAFT, 'webflow')).toEqual({
      ok: true,
      target: 'webflow',
      status: 'sent',
      updated: false,
      live: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/api\/content-drafts\/send$/);
    expect(requests[0].body).toMatchObject({
      brandId: BRAND,
      target: 'webflow',
      pages: [{ draftId: DRAFT, title: 'Pricing FAQ', slug: 'pricing-faq' }],
    });
  });

  it('says the API’s refusals as Chat’s codes', async () => {
    for (const [status, code, reason] of [
      [400, 'no_webflow', 'not_connected'],
      [400, 'wordpress_not_configured', 'not_connected'],
      // The CMS refused the connection's key: connected again in Integrations.
      [400, 'webflow_refused', 'not_connected'],
      [429, 'daily_limit', 'quota_exceeded'],
      [409, 'in_progress', 'conflict'],
      [403, 'forbidden', 'forbidden_role'],
      [400, 'invalid_page', 'invalid'],
      [422, 'too_long', 'invalid'],
      [404, 'not_found', 'not_found'],
      [500, 'server', 'failed'],
    ] as const) {
      answer = { status, body: { code, error: `Refused: ${code}` } };
      expect(await sendDraftToCms(DRAFT, 'webflow')).toEqual({
        ok: false,
        reason,
        message: `Refused: ${code}`,
      });
    }
    answer = {
      status: 200,
      body: { deliveries: [{ id: 'd1', draftId: DRAFT, status: 'failed', error: 'Timed out' }] },
    };
    expect(await sendDraftToCms(DRAFT, 'wordpress')).toMatchObject({
      ok: false,
      reason: 'failed',
      message: 'Timed out',
    });
  });

  it('sends nothing for a page with placeholders, or a draft that isn’t in the Library', async () => {
    fake.db.tables.content_drafts[0].body_html = '<h1>Pricing FAQ</h1><p>[Your price]</p>';
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('placeholders'),
    });
    fake.db.tables.content_drafts[0].archived_at = '2026-10-30T10:00:00.000Z';
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ reason: 'not_found' });
    expect(requests).toEqual([]);
  });

  it('never sends to the webhook: it goes out of GetCito, so the editor sends it', async () => {
    expect(await sendDraftToCms(DRAFT, 'webhook' as never)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(requests).toEqual([]);
  });

  it('sends nothing over a live page: the Content Editor sends it', async () => {
    fake.db.tables.content_drafts[0].published_url = 'https://acme.example/pricing-faq';
    expect(await sendDraftToCms(DRAFT, 'framer')).toEqual({
      ok: false,
      reason: 'live_item',
      message: 'This page is live; send it from the Content Editor.',
    });
    fake.db.tables.content_drafts[0].published_url = null;
    fake.db.tables.content_draft_deliveries = [
      { id: 'd0', draft_id: DRAFT, status: 'published', target: 'webflow' },
    ];
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ reason: 'live_item' });
    expect(requests).toEqual([]);
  });

  it('refuses a Manager once an Admin turned publishing off for Managers, before reading the page', async () => {
    managersCantGoLive(['publishing']);
    expect(await sendDraftToCms(DRAFT, 'webflow')).toEqual({
      ok: false,
      reason: 'execute_off',
      message: 'An Admin turned publishing off for Managers.',
    });
    expect(readCmsSources).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    // The switch is the Managers': an Admin still sends.
    asRole('admin');
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ ok: true });
    // Another group switched off leaves publishing on.
    asRole('manager');
    managersCantGoLive(['email_outreach', 'code_prs']);
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ ok: true });
    expect(requests).toHaveLength(2);
  });

  it('refuses an Agency partner as an Analyst, and a Manager whose switches can’t be read', async () => {
    asRole('agency_partner');
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ reason: 'forbidden_role' });
    asRole('manager');
    fake.db.failures.chat_settings = { message: 'db down' };
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ ok: false, reason: 'failed' });
    expect(requests).toEqual([]);
  });

  it('refuses an Analyst before reading the page, and says a failure as a value', async () => {
    asRole('analyst');
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ reason: 'forbidden_role' });
    expect(readCmsSources).not.toHaveBeenCalled();
    asRole('manager');
    readCmsSources.mockRejectedValueOnce(new Error('dom down'));
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ ok: false, reason: 'failed' });
    fake.db.failures.profiles = { message: 'db down' };
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ ok: false, reason: 'failed' });
    expect(requests).toEqual([]);
  });
});

describe('publishDraftToCms (AUTONOMOUS-GO-LIVE PR 9)', () => {
  it('publishes the page made as Send to CMS makes it, through the API’s publish, and says where', async () => {
    answer = {
      status: 200,
      body: {
        delivery: { id: 'd1', draftId: DRAFT, status: 'published' },
        url: 'https://acme.example/blog/pricing-faq',
      },
    };
    expect(await publishDraftToCms(DRAFT, 'webflow')).toEqual({
      ok: true,
      target: 'webflow',
      url: 'https://acme.example/blog/pricing-faq',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/api\/content-drafts\/publish-cms$/);
    expect(requests[0].body).toMatchObject({
      brandId: BRAND,
      target: 'webflow',
      page: { draftId: DRAFT, title: 'Pricing FAQ', slug: 'pricing-faq' },
    });
  });

  it('says the API’s refusals as Chat’s codes, the CMS’s own words kept', async () => {
    for (const [status, code, reason] of [
      [409, 'live_item', 'live_item'],
      [502, 'publish_refused', 'publish_refused'],
      [403, 'execute_off', 'execute_off'],
      [400, 'no_wix', 'not_connected'],
    ] as const) {
      answer = { status, body: { code, error: `Refused: ${code}` } };
      expect(await publishDraftToCms(DRAFT, 'wix')).toEqual({
        ok: false,
        reason,
        message: `Refused: ${code}`,
      });
    }
  });

  it('publishes nothing over a live page, nor in Framer, nor for a Manager while publishing is off', async () => {
    fake.db.tables.content_drafts[0].published_url = 'https://acme.example/pricing-faq';
    expect(await publishDraftToCms(DRAFT, 'wordpress')).toMatchObject({
      ok: false,
      reason: 'live_item',
    });
    fake.db.tables.content_drafts[0].published_url = null;
    expect(await publishDraftToCms(DRAFT, 'framer' as never)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    managersCantGoLive(['publishing']);
    expect(await publishDraftToCms(DRAFT, 'wordpress')).toMatchObject({
      ok: false,
      reason: 'execute_off',
    });
    expect(requests).toEqual([]);
  });
});

describe('startSiteAudits', () => {
  it('starts one page on the one-page route, several on the bulk route', async () => {
    answer = { status: 202, body: { audit: { id: 'a1', url: 'https://acme.example/a' } } };
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toEqual({
      ok: true,
      started: 1,
      audits: [{ id: 'a1', url: 'https://acme.example/a' }],
    });
    answer = {
      status: 202,
      body: {
        audits: [
          { id: 'a2', url: 'https://acme.example/b' },
          { id: 'a3', url: 'https://acme.example/c' },
        ],
      },
    };
    expect(
      await startSiteAudits(BRAND, ['https://acme.example/b', 'https://acme.example/c']),
    ).toMatchObject({ ok: true, started: 2 });
    expect(requests.map((r) => r.url.replace(/^.*\/api/, '/api'))).toEqual([
      '/api/audits',
      '/api/audits/bulk',
    ]);
    expect(requests[0].body).toEqual({ brandId: BRAND, url: 'https://acme.example/a' });
  });

  it('says the month’s quota in the API’s words, and refuses an Analyst', async () => {
    answer = {
      status: 402,
      body: { error: 'quota_exceeded', message: 'You’ve used this month’s 500 audits.' },
    };
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toEqual({
      ok: false,
      reason: 'quota_exceeded',
      message: 'You’ve used this month’s 500 audits.',
    });
    asRole('analyst');
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toMatchObject({
      reason: 'forbidden_role',
    });
    expect(requests).toHaveLength(1);
  });

  it('says a failure as a value, never a throw', async () => {
    fake.db.failures.profiles = { message: 'db down' };
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    expect(requests).toEqual([]);
  });
});

describe('updateContentDraft', () => {
  const draft = () => fake.db.tables.content_drafts[0];
  let kept: { origin: unknown; body: unknown }[];
  beforeEach(() => {
    kept = [];
    fake.db.rpcs = {
      content_draft_snapshot: ({ p_origin }) => {
        kept.push({ origin: p_origin, body: draft().body_html });
        return 'version-1';
      },
    };
  });

  it('keeps the page before in History first, then saves it cleaned as the editor does', async () => {
    const result = await updateContentDraft(DRAFT, {
      bodyHtml:
        '<h1>Pricing FAQ</h1><p onclick="steal()">Plans start at $59.</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
    });
    expect(result).toMatchObject({ ok: true, beforeVersionId: 'version-1' });
    expect(kept).toEqual([
      { origin: 'agent_before', body: '<h1>Pricing FAQ</h1><p>Plans start at $49.</p>' },
    ]);
    expect(draft().body_html).toContain('Plans start at $59.');
    expect(draft().body_html).not.toMatch(/<script|onerror|onclick|alert/);
  });

  it('changes nothing when the page before can’t be kept: Undo would have nothing', async () => {
    fake.db.rpcs = {};
    expect(await updateContentDraft(DRAFT, { title: 'New' })).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    expect(draft().title).toBe('Pricing FAQ');
  });

  it('is a conflict while the Content Agent writes the page', async () => {
    Object.assign(draft(), { agent_state: 'writing', agent_state_at: new Date().toISOString() });
    expect(await updateContentDraft(DRAFT, { bodyHtml: '<h1>Mine</h1>' })).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(draft().body_html).toContain('$49');
  });

  it('refuses an Analyst, a draft that isn’t one, and one in the archive', async () => {
    asRole('analyst');
    expect(await updateContentDraft(DRAFT, { title: 'New' })).toMatchObject({
      reason: 'forbidden_role',
    });
    asRole('manager');
    expect(await updateContentDraft('not-an-id', { title: 'New' })).toMatchObject({
      reason: 'invalid',
    });
    fake.db.tables.content_drafts[0].archived_at = '2026-10-30T10:00:00.000Z';
    expect(await updateContentDraft(DRAFT, { title: 'New' })).toMatchObject({
      reason: 'not_found',
    });
    expect(fake.db.tables.content_drafts[0].title).toBe('Pricing FAQ');
  });
});
