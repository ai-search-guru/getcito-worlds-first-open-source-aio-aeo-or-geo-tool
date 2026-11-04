import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS (#1331): pages go to the brand's webhook as content packages,
 * reserved against the workspace's 200 a day, each one a delivery row.
 */

const db = {
  brand: {},
  drafts: [],
  ruleSets: [],
  // What a callback that landed first left on the delivery.
  told: null,
  configs: [],
  // The brand's Webflow connection (00283), and whether this server has Webflow set up.
  webflow: null,
  webflowConfigured: true,
  // Its WordPress connection (00294), and whether this server can keep its sign-in
  // (Framer's and Wix's API keys too: one CONNECTOR_CREDENTIALS_KEY).
  wordpress: null,
  wordpressConfigured: true,
  // Its Framer connection (00295).
  framer: null,
  // Its Wix connection (00372).
  wix: null,
  queued: [],
  updates: [],
  rpc: [],
};

function from(table) {
  const q = { table, filters: [], update: null };
  const result = () => {
    if (q.update) {
      db.updates.push({ table, update: q.update, filters: q.filters });
      // A callback first: the queued row isn't there to write.
      if (table === 'content_draft_deliveries' && db.told) return { data: [], error: null };
      return { data: null, error: null };
    }
    if (table === 'content_draft_deliveries') {
      return { data: db.told ? [{ id: 'd-1', ...db.told }] : null, error: null };
    }
    if (table === 'content_rule_sets') {
      const types = q.filters.find(([op]) => op === 'in')?.[2] ?? [];
      const site = q.filters.find(([op, col]) => op === 'eq' && col === 'site_type')?.[2];
      return {
        data: db.ruleSets.filter(
          (r) => types.includes(r.page_type) && (!r.site_type || r.site_type === site),
        ),
        error: null,
      };
    }
    if (table === 'content_drafts') {
      const ids = q.filters.find(([op]) => op === 'in')?.[2];
      return { data: db.drafts.filter((d) => !ids || ids.includes(d.id)), error: null };
    }
    if (table === 'webhook_configs') return { data: db.configs, error: null };
    if (table === 'brand_cms_connections') {
      const provider = q.filters.find(([op, col]) => op === 'eq' && col === 'provider')?.[2];
      const connection = { wordpress: db.wordpress, framer: db.framer, wix: db.wix }[provider];
      return { data: connection === undefined ? db.webflow : connection, error: null };
    }
    if (table === 'brands') {
      db.brandReads += 1;
      return { data: db.brand, error: null };
    }
    if (table === 'brand_domains') return { data: [{ domain: 'acme.example' }], error: null };
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
    neq: (col, value) => (q.filters.push(['neq', col, value]), chain),
    is: (col, value) => (q.filters.push(['is', col, value]), chain),
    in: (col, value) => (q.filters.push(['in', col, value]), chain),
    limit: () => chain,
    single: async () => result(),
    maybeSingle: async () => {
      if (table === 'brand_cms_connections') return result();
      const { data } = result();
      const id = q.filters.find(([op, col]) => op === 'eq' && col === 'id')?.[2];
      return { data: (data ?? []).find((d) => d.id === id) ?? null, error: null };
    },
    update: (row) => ((q.update = row), chain),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (t) => from(t),
    rpc: async (fn, args) => {
      db.rpc.push({ fn, args });
      return db.rpcError ? { data: null, error: db.rpcError } : { data: db.queued, error: null };
    },
  },
}));
const postJson = vi.fn();
vi.mock('./safePost.js', () => ({ postJson: (...args) => postJson(...args) }));
vi.mock('./composio.js', () => ({ isWebflowConfigured: () => db.webflowConfigured }));
const sendToWebflow = vi.fn();
vi.mock('./cms/webflowDelivery.js', () => ({
  sendToWebflow: (...args) => sendToWebflow(...args),
}));
vi.mock('./catalog/credentials.js', () => ({
  credentialsConfigured: () => db.wordpressConfigured,
}));
const sendToWordPress = vi.fn();
vi.mock('./cms/wordpressDelivery.js', () => ({
  sendToWordPress: (...args) => sendToWordPress(...args),
}));
const sendToFramer = vi.fn();
vi.mock('./cms/framerDelivery.js', () => ({
  sendToFramer: (...args) => sendToFramer(...args),
}));
const sendToWix = vi.fn();
vi.mock('./cms/wixDelivery.js', () => ({ sendToWix: (...args) => sendToWix(...args) }));

const { DAILY_DELIVERIES, DeliveryError, PAUSE_MS, cleanPublishHtml, sendContentPages, signBody } =
  await import('./contentDelivery.js');

const page = (over = {}) => ({
  draftId: 'c0ffee00-0000-4000-8000-000000000001',
  title: 'Best AEO tools (2026)',
  slug: 'best-aeo-tools',
  metaTitle: 'Best AEO tools',
  metaDescription: 'The tools that help AI answers cite you.',
  html: '<h2>Why</h2><p>Because.</p>',
  author: 'Ada Lovelace',
  featuredImage: null,
  ...over,
});
const row = (draftId, over = {}) => ({
  id: `d-${draftId.slice(-1)}`,
  draft_id: draftId,
  batch_id: null,
  status: 'queued',
  ...over,
});

const draft = (id, over = {}) => ({
  id,
  method: 'create',
  source_url: null,
  page_type: 'blog_post',
  rules: null,
  ...over,
});

beforeEach(() => {
  db.brand = { id: 'b1', name: 'Acme Coffee', industry: 'Coffee', language: null };
  db.brandReads = 0;
  db.drafts = [draft(page().draftId)];
  db.ruleSets = [];
  db.told = null;
  db.configs = [
    {
      id: 'w1',
      webhook_url: 'https://hooks.acme.example/cms',
      webhook_secret: 's3cret',
      events: ['content_draft.sent'],
    },
  ];
  db.queued = [row(page().draftId)];
  db.updates = [];
  db.rpc = [];
  db.webflow = null;
  db.webflowConfigured = true;
  db.wordpress = null;
  db.wordpressConfigured = true;
  db.framer = null;
  db.wix = null;
  db.rpcError = null;
  postJson.mockReset().mockResolvedValue({ status: 200, answer: '{"ok":true}' });
  sendToWebflow.mockReset();
  sendToWordPress.mockReset();
  sendToFramer.mockReset();
  sendToWix.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const send = (pages = [page()]) =>
  sendContentPages({ orgId: 'o1', brandId: 'b1', userId: 'u1', pages });

describe('cleanPublishHtml', () => {
  it('keeps the page and its JSON-LD, without scripts, frames, handlers or script links', () => {
    const html = cleanPublishHtml(
      '<p onclick="steal()">Hi <a href="javascript:alert(1)">x</a> <a href="https://a.example">ok</a></p>' +
        '<script>alert(1)</script><script type="application/ld+json">{"@type":"Article"}</script>' +
        '<iframe src="https://evil.example"></iframe><img src="data:image/png;base64,AAA" alt="dot">' +
        '<img src="data:text/html,x">',
    );
    expect(html).toBe(
      '<p>Hi <a>x</a> <a href="https://a.example">ok</a></p>' +
        '<script type="application/ld+json">{"@type":"Article"}</script>' +
        '<img src="data:image/png;base64,AAA" alt="dot"><img>',
    );
  });
});

describe('cleanPublishHtml, against links that hide their scheme', () => {
  it.each([
    ['<a href="java&#9;script:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="jav&#x0A;ascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#1;javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="vbscript:x">x</a>', '<a>x</a>'],
    [
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate></a></svg>',
      '<svg><a></a></svg>',
    ],
    ['<a href="mailto:hi@acme.example">x</a>', '<a href="mailto:hi@acme.example">x</a>'],
    ['<a href="/pricing#plans">x</a>', '<a href="/pricing#plans">x</a>'],
    ['<a href="data:image/png;base64,AAA">x</a>', '<a>x</a>'],
  ])('%s', (html, clean) => {
    expect(cleanPublishHtml(html)).toBe(clean);
  });
});

describe('signBody', () => {
  it('signs the body with the webhook’s secret, as sha256=<hex>', () => {
    const expected = crypto.createHmac('sha256', 's3cret').update('{"a":1}').digest('hex');
    expect(signBody('s3cret', '{"a":1}')).toBe(`sha256=${expected}`);
  });
});

describe('sendContentPages', () => {
  it('sends one page as a package, signed, and keeps its slug and meta on the draft', async () => {
    const reviewer = 'Dr. Grace Hopper, Clinical Reviewer';
    const sent = await send([page({ reviewer })]);
    expect(db.rpc).toEqual([
      {
        fn: 'reserve_content_deliveries',
        args: {
          p_organization_id: 'o1',
          p_brand_id: 'b1',
          p_sent_by: 'u1',
          p_batch_id: null,
          p_items: [{ draft_id: page().draftId, title: page().title, slug: 'best-aeo-tools' }],
          p_limit: DAILY_DELIVERIES,
          p_target: 'webhook',
        },
      },
    ]);
    const [address, body, { headers }] = postJson.mock.calls[0];
    expect(address).toBe('https://hooks.acme.example/cms');
    expect(headers['X-Webhook-Secret']).toBe('s3cret');
    expect(headers['X-GetCito-Signature']).toBe(signBody('s3cret', body));
    expect(JSON.parse(body)).toMatchObject({
      event: 'content_draft.sent',
      schemaVersion: 1,
      delivery: { id: 'd-1', batchId: null },
      page: {
        draftId: page().draftId,
        title: 'Best AEO tools (2026)',
        slug: 'best-aeo-tools',
        metaTitle: 'Best AEO tools',
        html: '<h2>Why</h2><p>Because.</p>',
        jsonLd: [],
        author: 'Ada Lovelace',
        reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
        method: 'create',
        sourceUrl: null,
        pageType: 'blog_post',
        language: 'en',
      },
      brand: { id: 'b1', name: 'Acme Coffee', domain: 'acme.example', industry: 'Coffee' },
      callback_url: expect.stringMatching(/\/webhooks\/content-drafts\/d-1\/status$/),
      callback_method: 'POST',
    });
    expect(db.updates).toEqual([
      {
        table: 'content_drafts',
        update: {
          slug: 'best-aeo-tools',
          meta_title: 'Best AEO tools',
          meta_description: 'The tools that help AI answers cite you.',
        },
        filters: [['eq', 'id', page().draftId]],
      },
      {
        table: 'content_draft_deliveries',
        update: expect.objectContaining({ status: 'sent', http_status: 200, error: null }),
        // A callback that landed first keeps what it said.
        filters: [
          ['eq', 'id', 'd-1'],
          ['eq', 'status', 'queued'],
        ],
      },
    ]);
    expect(sent).toMatchObject({
      batchId: null,
      skipped: 0,
      deliveries: [{ id: 'd-1', status: 'sent' }],
    });
  });

  it('offers no callback to a webhook without a secret, and keeps the answer of the one that took it', async () => {
    db.configs = [
      {
        id: 'w1',
        webhook_url: 'https://a.example',
        webhook_secret: null,
        events: ['content_draft.sent'],
      },
      {
        id: 'w2',
        webhook_url: 'https://b.example',
        webhook_secret: 's',
        events: ['content_draft.sent'],
      },
    ];
    postJson
      .mockResolvedValueOnce({ status: 200, answer: 'taken' })
      .mockResolvedValueOnce({ status: 500, answer: 'boom' });
    const sent = await send();
    const [unsigned, signed] = postJson.mock.calls;
    expect(JSON.parse(unsigned[1])).toMatchObject({ callback_url: null, callback_method: null });
    expect(unsigned[2].headers).toEqual({});
    expect(JSON.parse(signed[1]).callback_url).toMatch(/\/status$/);
    expect(sent.deliveries[0]).toMatchObject({
      status: 'sent',
      http_status: 200,
      response_excerpt: 'taken',
    });
  });

  it('tells what the page is from its row: method, live address, page type, language and JSON-LD', async () => {
    const ld = { '@context': 'https://schema.org', '@type': 'FAQPage' };
    db.drafts = [
      draft(page().draftId, {
        method: 'optimize',
        source_url: 'https://acme.example/blog/aeo',
        page_type: 'guide',
        rules: { overrides: { language: { on: true, value: 'German' } } },
      }),
    ];
    db.brand.language = 'tr';
    // The browser's own claims about the page don't count.
    await send([
      page({
        method: 'create',
        html: `<p>Hi</p><script type="application/ld+json">${JSON.stringify(ld)}</script>`,
      }),
    ]);
    let sent = JSON.parse(postJson.mock.calls[0][1]).page;
    expect(sent).toMatchObject({
      method: 'optimize',
      sourceUrl: 'https://acme.example/blog/aeo',
      pageType: 'guide',
      language: 'de',
      jsonLd: [ld],
    });

    // The rule turned off: the brand's language.
    db.drafts[0].rules.overrides.language.on = false;
    await send();
    sent = JSON.parse(postJson.mock.calls[1][1]).page;
    expect(sent.language).toBe('tr');
  });

  it('reads the language from My rules for a draft no one has set rules on, as the editor does', async () => {
    // A set for each kind of site (00227): the brand's kind's is read.
    db.ruleSets = [
      {
        page_type: 'blog_post',
        site_type: 'ecommerce',
        overrides: { language: { value: 'German' } },
      },
      { page_type: 'blog_post', site_type: 'b2b', overrides: { language: { value: 'French' } } },
    ];
    await send();
    expect(JSON.parse(postJson.mock.calls[0][1]).page.language).toBe('fr');
    // The brand read once, for the package and its kind of site (#1544 review).
    expect(db.brandReads).toBe(1);

    // A shop (Shopping mode on): the e-commerce set's.
    db.brand = { ...db.brand, shopping_mode_enabled: true };
    await send();
    expect(JSON.parse(postJson.mock.calls[1][1]).page.language).toBe('de');

    // The brand unread: no kind of site's set, never the B2B one.
    db.brand = null;
    await send();
    expect(JSON.parse(postJson.mock.calls[2][1]).page.language).toBe('en');

    // The draft's own choices win once it has any.
    db.brand = { id: 'b1', name: 'Acme Coffee', industry: 'Coffee', language: null };
    db.drafts[0].rules = { source: 'default', overrides: {}, textRules: [] };
    await send();
    expect(JSON.parse(postJson.mock.calls[3][1]).page.language).toBe('en');
  });

  it('takes JSON-LD however its script type is written, as the clean keeps it', async () => {
    const ld = { '@type': 'Article' };
    await send([
      page({ html: `<script type=" Application/LD+JSON ">${JSON.stringify(ld)}</script><p>x</p>` }),
    ]);
    expect(JSON.parse(postJson.mock.calls[0][1]).page.jsonLd).toEqual([ld]);
  });

  it('keeps what a callback said before the webhook answered, and answers with it', async () => {
    db.told = { status: 'failed', error: 'Slug already taken', published_url: null };
    const sent = await send();
    expect(sent.deliveries[0]).toMatchObject({ status: 'failed', error: 'Slug already taken' });
  });

  it('writes a delivery failed when the webhook answers an error or can’t be reached', async () => {
    postJson.mockResolvedValue({ status: 500, answer: 'boom' });
    let sent = await send();
    expect(sent.deliveries[0]).toMatchObject({
      status: 'failed',
      http_status: 500,
      error: 'The webhook answered 500',
      response_excerpt: 'boom',
    });

    postJson.mockRejectedValue(new Error('ECONNRESET'));
    sent = await send();
    expect(sent.deliveries[0]).toMatchObject({
      status: 'failed',
      error: 'The webhook could not be reached',
    });
  });

  it('sends more pages in the background, one after another with a short pause, under one batch', async () => {
    vi.useFakeTimers();
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    // The reserved rows may come back in any order: they go in the pages' order.
    db.queued = [row(second.draftId, { batch_id: 'x' }), row(page().draftId, { batch_id: 'x' })];
    let release;
    postJson.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const sent = await send([page(), second, page()]);
    expect(db.rpc[0].args.p_batch_id).toEqual(expect.any(String));
    // Named twice, it goes once.
    expect(db.rpc[0].args.p_items.map((i) => i.draft_id)).toEqual([page().draftId, second.draftId]);
    expect(sent).toMatchObject({
      skipped: 0,
      deliveries: [{ status: 'queued' }, { status: 'queued' }],
    });

    // The first is still sending: the second waits for it, then for the pause.
    await vi.advanceTimersByTimeAsync(0);
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postJson.mock.calls[0][1]).page.draftId).toBe(page().draftId);
    release({ status: 200, answer: '' });
    await vi.advanceTimersByTimeAsync(PAUSE_MS - 1);
    expect(postJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(postJson).toHaveBeenCalledTimes(2));
    expect(JSON.parse(postJson.mock.calls[1][1]).page.draftId).toBe(second.draftId);
  });

  it('closes a page deleted before its turn in a batch, and sends the rest', async () => {
    vi.useFakeTimers();
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId), row(second.draftId)];
    let release;
    postJson.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await send([page(), second]);
    await vi.waitFor(() => expect(postJson).toHaveBeenCalledTimes(1));
    // The second is deleted while the first is sending: it doesn't go.
    db.drafts = [draft(page().draftId)];
    release({ status: 200, answer: '' });
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    await vi.waitFor(() =>
      expect(db.updates).toContainEqual({
        table: 'content_draft_deliveries',
        update: expect.objectContaining({
          status: 'failed',
          error: 'The page was deleted or archived before it was sent',
        }),
        filters: [
          ['eq', 'id', 'd-2'],
          ['eq', 'status', 'queued'],
        ],
      }),
    );
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('counts the pages past the day’s cap as skipped, and refuses once nothing is left', async () => {
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId)];
    expect((await send([page(), second])).skipped).toBe(1);

    db.queued = [];
    await expect(send()).rejects.toMatchObject({ code: 'daily_limit', status: 429 });
  });

  it('refuses a page of another brand, and a brand with no webhook taking the event', async () => {
    db.drafts = [];
    await expect(send()).rejects.toBeInstanceOf(DeliveryError);
    await expect(send()).rejects.toMatchObject({ code: 'not_found', status: 404 });

    db.drafts = [draft(page().draftId)];
    db.configs = [];
    await expect(send()).rejects.toMatchObject({ code: 'no_webhook', status: 409 });

    db.configs = [{ id: 'w1', webhook_url: 'https://x.example', events: ['opportunity.sent'] }];
    await expect(send()).rejects.toMatchObject({ code: 'webhook_not_subscribed', status: 409 });
    expect(db.rpc).toEqual([]);
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe('sendContentPages to Webflow (phase 2)', () => {
  const connection = {
    brand_id: 'b1',
    composio_account_id: 'ca_1',
    composio_entity_id: 'brand_b1',
    status: 'connected',
    collection_id: 'c1',
    field_map: { body: 'post-body' },
  };
  const toWebflow = (pages = [page()]) =>
    sendContentPages({ orgId: 'o1', brandId: 'b1', userId: 'u1', pages, target: 'webflow' });

  it('sends a page to the brand’s collection, not its webhooks, and keeps the item on the delivery', async () => {
    db.webflow = connection;
    sendToWebflow.mockResolvedValue({
      taken: true,
      externalId: 'item-1',
      collectionId: 'c1',
      updated: false,
      changed: { tables: 0, images: 0 },
    });
    const sent = await toWebflow();
    expect(db.rpc[0].args.p_target).toBe('webflow');
    expect(postJson).not.toHaveBeenCalled();
    expect(sendToWebflow).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        html: '<h2>Why</h2><p>Because.</p>',
        jsonLd: [],
        page: expect.objectContaining({ draftId: page().draftId, slug: 'best-aeo-tools' }),
      }),
    );
    const write = db.updates.find((u) => u.table === 'content_draft_deliveries');
    expect(write.update).toMatchObject({
      status: 'sent',
      error: null,
      http_status: null,
      external_id: 'item-1',
      target_collection: 'c1',
    });
    expect(sent.deliveries[0]).toMatchObject({ status: 'sent', updated: false });
  });

  it('keeps the agent run on a send an agent made on its own, before it goes (00444)', async () => {
    db.webflow = connection;
    sendToWebflow.mockResolvedValue({
      taken: true,
      externalId: 'item-1',
      collectionId: 'c1',
      updated: false,
      changed: { tables: 0, images: 0 },
    });
    await sendContentPages({
      orgId: 'o1',
      brandId: 'b1',
      userId: 'u1',
      pages: [page()],
      target: 'webflow',
      agentRunId: 'ar-1',
    });
    const writes = db.updates.filter((u) => u.table === 'content_draft_deliveries');
    expect(writes[0].update).toEqual({ agent_run_id: 'ar-1' });
    expect(writes[1].update).toMatchObject({ status: 'sent' });

    // A person's own send names no agent run.
    db.updates = [];
    await toWebflow();
    expect(db.updates.map((u) => u.update)).not.toContainEqual({ agent_run_id: 'ar-1' });
  });

  it('writes a page Webflow didn’t take as failed, with the reason', async () => {
    db.webflow = connection;
    sendToWebflow.mockResolvedValue({
      taken: false,
      failure: 'Another item in the collection has this slug',
    });
    const sent = await toWebflow();
    const write = db.updates.find((u) => u.table === 'content_draft_deliveries');
    expect(write.update).toMatchObject({
      status: 'failed',
      error: 'Another item in the collection has this slug',
    });
    expect(write.update).not.toHaveProperty('external_id');
    expect(sent.deliveries[0]).not.toHaveProperty('updated');
  });

  it('refuses before reserving when Webflow isn’t ready to take pages', async () => {
    db.webflowConfigured = false;
    await expect(toWebflow()).rejects.toMatchObject({
      code: 'webflow_not_configured',
      status: 503,
    });
    db.webflowConfigured = true;
    await expect(toWebflow()).rejects.toMatchObject({ code: 'no_webflow', status: 409 });
    db.webflow = { ...connection, status: 'auth_failed' };
    await expect(toWebflow()).rejects.toMatchObject({ code: 'webflow_refused', status: 409 });
    db.webflow = { ...connection, collection_id: null };
    await expect(toWebflow()).rejects.toMatchObject({ code: 'webflow_not_ready', status: 409 });
    db.webflow = { ...connection, field_map: {} };
    await expect(toWebflow()).rejects.toMatchObject({ code: 'webflow_not_ready' });
    expect(db.rpc).toEqual([]);
    expect(sendToWebflow).not.toHaveBeenCalled();
  });

  it('sends a batch one page after another, to Webflow', async () => {
    vi.useFakeTimers();
    db.webflow = connection;
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId), row(second.draftId)];
    sendToWebflow.mockResolvedValue({ taken: true, externalId: 'i', collectionId: 'c1' });
    await toWebflow([page(), second]);
    await vi.runAllTimersAsync();
    expect(sendToWebflow).toHaveBeenCalledTimes(2);
    expect(postJson).not.toHaveBeenCalled();
  });

  it('refuses a page already on its way to Webflow', async () => {
    db.webflow = connection;
    db.rpcError = { message: 'delivery_in_progress' };
    await expect(toWebflow()).rejects.toMatchObject({ code: 'in_progress', status: 409 });
    expect(sendToWebflow).not.toHaveBeenCalled();
  });

  it('stops a batch once Webflow refuses the token, closing the rest with the reason', async () => {
    vi.useFakeTimers();
    db.webflow = connection;
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId), row(second.draftId)];
    sendToWebflow.mockResolvedValue({
      taken: false,
      failure: 'Webflow refused the site token',
      refused: true,
    });
    await toWebflow([page(), second]);
    await vi.runAllTimersAsync();
    expect(sendToWebflow).toHaveBeenCalledTimes(1);
    const closed = db.updates.filter(
      (u) =>
        u.table === 'content_draft_deliveries' &&
        u.update.error === 'Webflow refused the site token',
    );
    expect(closed).toHaveLength(2);
  });

  it('keeps the item’s id even when the delivery’s row was written meanwhile', async () => {
    db.webflow = connection;
    db.told = { status: 'failed', error: 'Not sent: interrupted', published_url: null };
    sendToWebflow.mockResolvedValue({ taken: true, externalId: 'item-9', collectionId: 'c1' });
    await toWebflow();
    expect(db.updates.map((u) => u.update)).toContainEqual({
      external_id: 'item-9',
      target_collection: 'c1',
    });
  });
});

describe('sendContentPages to WordPress (phase 2, 00294)', () => {
  const connection = {
    id: 'cn1',
    brand_id: 'b1',
    status: 'connected',
    site_url: 'https://blog.acme.example',
  };
  const toWordPress = (pages = [page()]) =>
    sendContentPages({ orgId: 'o1', brandId: 'b1', userId: 'u1', pages, target: 'wordpress' });

  it('sends a page to the brand’s site, not its webhooks, and keeps the post on the delivery', async () => {
    db.wordpress = connection;
    sendToWordPress.mockResolvedValue({
      taken: true,
      externalId: '41',
      collectionId: 'blog.acme.example',
      updated: false,
      live: true,
    });
    const sent = await toWordPress();
    expect(db.rpc[0].args.p_target).toBe('wordpress');
    expect(postJson).not.toHaveBeenCalled();
    expect(sendToWebflow).not.toHaveBeenCalled();
    expect(sendToWordPress).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        html: '<h2>Why</h2><p>Because.</p>',
        page: expect.objectContaining({ draftId: page().draftId, slug: 'best-aeo-tools' }),
      }),
    );
    const write = db.updates.find((u) => u.table === 'content_draft_deliveries');
    expect(write.update).toMatchObject({
      status: 'sent',
      external_id: '41',
      target_collection: 'blog.acme.example',
    });
    // Its post was live: the page went as a new draft, and the answer says so.
    expect(sent.deliveries[0]).toMatchObject({ status: 'sent', updated: false, live: true });
  });

  it('refuses before reserving when WordPress isn’t connected or set up', async () => {
    db.wordpressConfigured = false;
    await expect(toWordPress()).rejects.toMatchObject({
      code: 'wordpress_not_configured',
      status: 503,
    });
    db.wordpressConfigured = true;
    await expect(toWordPress()).rejects.toMatchObject({ code: 'no_wordpress', status: 409 });
    db.wordpress = { ...connection, status: 'auth_failed' };
    await expect(toWordPress()).rejects.toMatchObject({ code: 'wordpress_refused', status: 409 });
    // A Webflow connection isn't a WordPress one.
    db.wordpress = null;
    db.webflow = {
      brand_id: 'b1',
      status: 'connected',
      collection_id: 'c1',
      field_map: { body: 'b' },
    };
    await expect(toWordPress()).rejects.toMatchObject({ code: 'no_wordpress' });
    expect(db.rpc).toEqual([]);
    expect(sendToWordPress).not.toHaveBeenCalled();
  });

  it('refuses a page already on its way to WordPress, naming it', async () => {
    db.wordpress = connection;
    db.rpcError = { message: 'delivery_in_progress' };
    await expect(toWordPress()).rejects.toMatchObject({
      code: 'in_progress',
      message: 'A page is already being sent to WordPress. Wait for it, then send again.',
    });
  });

  it('stops a batch once WordPress refuses the sign-in, closing the rest with the reason', async () => {
    vi.useFakeTimers();
    db.wordpress = connection;
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId), row(second.draftId)];
    sendToWordPress.mockResolvedValue({
      taken: false,
      failure: 'WordPress refused the user or the Application Password.',
      refused: true,
    });
    await toWordPress([page(), second]);
    await vi.runAllTimersAsync();
    expect(sendToWordPress).toHaveBeenCalledTimes(1);
    const closed = db.updates.filter(
      (u) =>
        u.table === 'content_draft_deliveries' &&
        u.update.error === 'WordPress refused the user or the Application Password.',
    );
    expect(closed).toHaveLength(2);
  });
});

describe('sendContentPages to Framer (phase 2, 00295)', () => {
  const connection = {
    id: 'cn1',
    brand_id: 'b1',
    status: 'connected',
    site_id: 'AbCdEfGhIj0123456789',
    collection_id: 'cBlog',
    field_map: { title: 'fTitle', body: 'fBody' },
    updated_at: '2026-10-27T09:00:00Z',
  };
  const toFramer = (pages = [page()]) =>
    sendContentPages({ orgId: 'o1', brandId: 'b1', userId: 'u1', pages, target: 'framer' });

  it('sends a page to the brand’s collection, not its webhooks, and keeps the item on the delivery', async () => {
    db.framer = connection;
    sendToFramer.mockResolvedValue({
      taken: true,
      externalId: 'item-1',
      collectionId: 'cBlog',
      updated: true,
      live: true,
      changed: { images: 2 },
    });
    const sent = await toFramer();
    expect(db.rpc[0].args.p_target).toBe('framer');
    expect(postJson).not.toHaveBeenCalled();
    expect(sendToWebflow).not.toHaveBeenCalled();
    expect(sendToWordPress).not.toHaveBeenCalled();
    expect(sendToFramer).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        html: '<h2>Why</h2><p>Because.</p>',
        jsonLd: [],
        page: expect.objectContaining({ draftId: page().draftId, slug: 'best-aeo-tools' }),
      }),
    );
    const write = db.updates.find((u) => u.table === 'content_draft_deliveries');
    expect(write.update).toMatchObject({
      status: 'sent',
      error: null,
      external_id: 'item-1',
      target_collection: 'cBlog',
    });
    // How Framer took it goes in the answer, as Webflow's and WordPress's do.
    expect(sent.deliveries[0]).toMatchObject({
      status: 'sent',
      updated: true,
      live: true,
      changed: { images: 2 },
    });
  });

  it('writes a page Framer didn’t take as failed, with the reason', async () => {
    db.framer = connection;
    sendToFramer.mockResolvedValue({
      taken: false,
      failure: 'Another item in Blog has the slug "best-aeo-tools".',
    });
    const sent = await toFramer();
    const write = db.updates.find((u) => u.table === 'content_draft_deliveries');
    expect(write.update).toMatchObject({
      status: 'failed',
      error: 'Another item in Blog has the slug "best-aeo-tools".',
    });
    expect(write.update).not.toHaveProperty('external_id');
    expect(sent.deliveries[0]).toMatchObject({ refused: false });
  });

  it('refuses before reserving when Framer isn’t set up, connected or ready to take pages', async () => {
    db.wordpressConfigured = false;
    await expect(toFramer()).rejects.toMatchObject({
      code: 'framer_not_configured',
      status: 503,
      message: 'Framer is not set up on this server.',
    });
    db.wordpressConfigured = true;
    await expect(toFramer()).rejects.toMatchObject({
      code: 'no_framer',
      status: 409,
      message: 'Connect Framer in Settings › Integrations.',
    });
    db.framer = { ...connection, status: 'auth_failed' };
    await expect(toFramer()).rejects.toMatchObject({ code: 'framer_refused', status: 409 });
    for (const ready of [
      { collection_id: null },
      { field_map: { body: 'fBody' } },
      { field_map: { title: 'fTitle' } },
    ]) {
      db.framer = { ...connection, ...ready };
      await expect(toFramer()).rejects.toMatchObject({
        code: 'framer_not_ready',
        status: 409,
        message: 'Pick the Framer collection and its fields in Settings › Integrations.',
      });
    }
    // A WordPress connection isn't a Framer one.
    db.framer = null;
    db.wordpress = {
      id: 'cn2',
      brand_id: 'b1',
      status: 'connected',
      site_url: 'https://x.example',
    };
    await expect(toFramer()).rejects.toMatchObject({ code: 'no_framer' });
    expect(db.rpc).toEqual([]);
    expect(sendToFramer).not.toHaveBeenCalled();
  });

  it('refuses a page already on its way to Framer, naming it', async () => {
    db.framer = connection;
    db.rpcError = { message: 'delivery_in_progress' };
    await expect(toFramer()).rejects.toMatchObject({
      code: 'in_progress',
      message: 'A page is already being sent to Framer. Wait for it, then send again.',
    });
  });

  it('stops a batch once Framer refuses the key, closing the rest with the reason', async () => {
    vi.useFakeTimers();
    db.framer = connection;
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId), row(second.draftId)];
    sendToFramer.mockResolvedValue({
      taken: false,
      failure: 'Framer refused the API key.',
      refused: true,
    });
    await toFramer([page(), second]);
    await vi.runAllTimersAsync();
    expect(sendToFramer).toHaveBeenCalledTimes(1);
    const closed = db.updates.filter(
      (u) =>
        u.table === 'content_draft_deliveries' && u.update.error === 'Framer refused the API key.',
    );
    expect(closed).toHaveLength(2);
  });
});

describe('sendContentPages to Wix (phase 2, 00372)', () => {
  const connection = {
    id: 'cn1',
    brand_id: 'b1',
    status: 'connected',
    site_id: '2f8a1c3e-1111-4222-8333-944455556666',
    account: 'c00e8a5c-322b-4e77-8813-002e3ea7e811',
    updated_at: '2026-10-28T09:00:00Z',
  };
  const toWix = (pages = [page()]) =>
    sendContentPages({ orgId: 'o1', brandId: 'b1', userId: 'u1', pages, target: 'wix' });

  it('sends a page to the brand’s site, not its webhooks, and keeps the post on the delivery', async () => {
    db.wix = connection;
    sendToWix.mockResolvedValue({
      taken: true,
      externalId: '9124f6ef-a537-4bdd-bca3-e7306947deeb',
      collectionId: connection.site_id,
      updated: false,
      live: false,
      changed: { images: 0 },
    });
    const sent = await toWix();
    expect(db.rpc[0].args.p_target).toBe('wix');
    expect(postJson).not.toHaveBeenCalled();
    expect(sendToWebflow).not.toHaveBeenCalled();
    expect(sendToWordPress).not.toHaveBeenCalled();
    expect(sendToWix).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        html: '<h2>Why</h2><p>Because.</p>',
        page: expect.objectContaining({ draftId: page().draftId, slug: 'best-aeo-tools' }),
      }),
    );
    const write = db.updates.find((u) => u.table === 'content_draft_deliveries');
    expect(write.update).toMatchObject({
      status: 'sent',
      external_id: '9124f6ef-a537-4bdd-bca3-e7306947deeb',
      target_collection: connection.site_id,
    });
    expect(sent.deliveries[0]).toMatchObject({ status: 'sent', updated: false });
  });

  it('refuses before reserving when Wix isn’t connected or set up', async () => {
    db.wordpressConfigured = false;
    await expect(toWix()).rejects.toMatchObject({ code: 'wix_not_configured', status: 503 });
    db.wordpressConfigured = true;
    await expect(toWix()).rejects.toMatchObject({ code: 'no_wix', status: 409 });
    db.wix = { ...connection, status: 'auth_failed' };
    await expect(toWix()).rejects.toMatchObject({ code: 'wix_refused', status: 409 });
    // A WordPress connection isn't a Wix one.
    db.wix = null;
    db.wordpress = {
      id: 'cn2',
      brand_id: 'b1',
      status: 'connected',
      site_url: 'https://b.example',
    };
    await expect(toWix()).rejects.toMatchObject({ code: 'no_wix' });
    expect(db.rpc).toEqual([]);
    expect(sendToWix).not.toHaveBeenCalled();
  });

  it('refuses a page already on its way to Wix, naming it', async () => {
    db.wix = connection;
    db.rpcError = { message: 'delivery_in_progress' };
    await expect(toWix()).rejects.toMatchObject({
      code: 'in_progress',
      message: 'A page is already being sent to Wix. Wait for it, then send again.',
    });
    expect(sendToWix).not.toHaveBeenCalled();
  });

  it('stops a batch once Wix refuses the API key, closing the rest with the reason', async () => {
    vi.useFakeTimers();
    db.wix = connection;
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [draft(page().draftId), draft(second.draftId)];
    db.queued = [row(page().draftId), row(second.draftId)];
    sendToWix.mockResolvedValue({
      taken: false,
      failure: 'Wix refused the API key.',
      refused: true,
    });
    await toWix([page(), second]);
    await vi.runAllTimersAsync();
    expect(sendToWix).toHaveBeenCalledTimes(1);
    const closed = db.updates.filter(
      (u) =>
        u.table === 'content_draft_deliveries' && u.update.error === 'Wix refused the API key.',
    );
    expect(closed).toHaveLength(2);
  });
});
