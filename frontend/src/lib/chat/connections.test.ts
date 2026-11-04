// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';

const db = vi.hoisted(() => ({ fake: null as FakeSupabase | null }));
vi.mock('@/lib/supabase/admin', async () => {
  const { createFakeSupabase } = await import('./testing/fakeSupabase');
  db.fake = createFakeSupabase();
  return { supabaseAdmin: db.fake };
});

const { CONNECTION_TOOLS, connectionRecords, readBrandAgents, readConnections } =
  await import('./connections');
const { readBrandConnections } = await import('./agentConnections');
const { NO_CONNECTION_ROWS } = await import('./connectionRows');

/**
 * Connections (W4-24): one list of a brand's tools from the one read the
 * agents' checks use too: status, account, who connected it and when,
 * what uses it, what would stop without it, up to two Suggested, and Soon
 * tools with nothing to click.
 */

const ORG = 'org-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const fake = () => db.fake!;
const byKey = (records: ReturnType<typeof connectionRecords>, key: string) =>
  records.find((r) => r.key === key);

beforeEach(() => {
  fake().tables = {};
  fake().failures = {};
});

describe('connectionRecords', () => {
  it('lists every live tool not connected and every Soon tool with nothing to click', () => {
    const records = connectionRecords({ rows: NO_CONNECTION_ROWS });
    expect(byKey(records, 'webflow')).toMatchObject({
      status: 'not_connected',
      account: null,
      access: 'read_write_drafts',
      uses: ['/winback', '/tasks', '/publish'],
      stops: [],
      settingsHref: '/dashboard/settings/integrations#webflow',
      disconnect: 'cms',
    });
    expect(byKey(records, 'hubspot')).toEqual({
      key: 'hubspot',
      category: 'crm',
      status: 'soon',
      account: null,
      connectedBy: null,
      connectedAt: null,
      access: null,
      uses: [],
      stops: [],
      suggested: false,
      settingsHref: null,
      disconnect: null,
    });
    // Merchant Center only where this deployment offers it.
    expect(byKey(records, 'merchant_center')).toBeUndefined();
    expect(
      byKey(
        connectionRecords({ rows: NO_CONNECTION_ROWS, merchantCenterOffered: true }),
        'merchant_center',
      ),
    ).toMatchObject({ status: 'not_connected' });
    // Every tool of the catalog in its order, but Merchant Center.
    expect(records.map((r) => r.key)).toEqual(
      CONNECTION_TOOLS.filter((t) => t.key !== 'merchant_center').map((t) => t.key),
    );
  });

  it('reads Search Console and Analytics from the brand’s properties, with who signed in and when', () => {
    const records = connectionRecords({
      rows: {
        ...NO_CONNECTION_ROWS,
        brand: { gsc_property: 'sc-domain:acme.com', ga_property_id: null },
      },
      signIns: [
        {
          provider: 'google-search-console',
          status: 'connected',
          connected_by: 'u1',
          created_at: '2026-10-02T09:00:00Z',
        },
      ],
      names: new Map([['u1', 'Sam Lee']]),
    });
    expect(byKey(records, 'google_search_console')).toMatchObject({
      status: 'connected',
      account: 'sc-domain:acme.com',
      connectedBy: 'Sam Lee',
      connectedAt: '2026-10-02T09:00:00Z',
      access: 'read_only',
      uses: ['/winback', '/report'],
      suggested: false,
    });
    expect(byKey(records, 'google_analytics')).toMatchObject({
      status: 'not_connected',
      suggested: true,
    });
  });

  it('fails Search Console and Analytics whose property is set but whose sign-in is gone', () => {
    const rows = {
      ...NO_CONNECTION_ROWS,
      brand: { gsc_property: 'sc-domain:acme.com', ga_property_id: '123456' },
    };
    const agents = [{ name: 'Traffic', needs: [{ kind: 'google_analytics', required: true }] }];
    // Disconnected in Settings: no sign-in row left, the property kept.
    for (const signIns of [undefined, []]) {
      const records = connectionRecords({ rows, agents, signIns });
      expect(byKey(records, 'google_search_console')).toMatchObject({
        status: 'failing',
        account: 'sc-domain:acme.com',
        suggested: false,
      });
      expect(byKey(records, 'google_analytics')).toMatchObject({
        status: 'failing',
        account: '123456',
        // The agent needing it would stop on Disconnect too.
        stops: ['Traffic'],
      });
    }
    // A sign-in for one tool doesn't connect the other.
    const one = connectionRecords({
      rows,
      signIns: [
        { provider: 'google-analytics', status: 'connected', connected_by: null, created_at: null },
        {
          provider: 'google-search-console',
          status: 'error',
          connected_by: null,
          created_at: null,
        },
      ],
    });
    expect(byKey(one, 'google_analytics')?.status).toBe('connected');
    expect(byKey(one, 'google_search_console')?.status).toBe('failing');
  });

  it('reads a CMS site, a failing sign-in, a webhook that takes pages and the catalog’s sources', () => {
    const records = connectionRecords({
      rows: {
        brand: null,
        cms: [
          {
            provider: 'webflow',
            status: 'connected',
            site_name: 'Acme site',
            connected_by: 'u1',
            created_at: '2026-10-09T00:00:00Z',
          },
          { provider: 'wix', status: 'auth_failed', site_name: 'Acme Wix' },
        ],
        webhooks: [
          { events: ['content_draft.sent'], name: 'Zap', created_at: '2026-10-01T00:00:00Z' },
          { events: ['action_task.sent'], name: 'Tasks only' },
        ],
        catalog: [
          {
            kind: 'feed_url',
            last_status: 'ok',
            label: null,
            url: 'https://feeds.acme.com/all.xml',
            created_at: '2026-10-03T00:00:00Z',
          },
          { kind: 'upload', last_status: 'ok' },
          { kind: 'feed_url', last_status: 'ok', label: 'Spring', url: 'https://x.example/s.xml' },
          { kind: 'woocommerce', last_status: 'auth_failed', account: 'shop.acme.com' },
        ],
      },
      names: new Map([['u1', 'Sam Lee']]),
    });
    expect(byKey(records, 'webflow')).toMatchObject({
      status: 'connected',
      account: 'Acme site',
      connectedBy: 'Sam Lee',
      connectedAt: '2026-10-09T00:00:00Z',
    });
    expect(byKey(records, 'wix')).toMatchObject({ status: 'failing', account: 'Acme Wix' });
    expect(byKey(records, 'webhook')).toMatchObject({
      status: 'connected',
      account: 'Zap',
      access: 'sends_pages',
      settingsHref: '/dashboard/content',
      disconnect: null,
    });
    expect(byKey(records, 'product_feed')).toMatchObject({
      status: 'connected',
      account: 'feeds.acme.com, Uploaded file +1',
      connectedAt: '2026-10-03T00:00:00Z',
      settingsHref: '/dashboard/settings/integrations#product-catalog',
      uses: ['/shopping'],
    });
    expect(byKey(records, 'woocommerce')).toMatchObject({
      status: 'failing',
      account: 'shop.acme.com',
    });
    // A failed sign-in counts as connected nowhere: Merchant Center shows once the brand has it.
    expect(byKey(records, 'merchant_center')).toBeUndefined();
  });

  it('names the agents that use a tool, and on Disconnect the ones that would stop', () => {
    const agents = [
      { name: 'Publisher', needs: [{ kind: 'cms', required: true }] },
      { name: 'Win back', needs: [{ kind: 'cms', required: false }] },
    ];
    const one = connectionRecords({
      rows: { ...NO_CONNECTION_ROWS, cms: [{ provider: 'webflow', status: 'connected' }] },
      agents,
    });
    expect(byKey(one, 'webflow')).toMatchObject({
      uses: ['/winback', '/tasks', '/publish', 'Publisher', 'Win back'],
      stops: ['Publisher'],
    });
    // Another CMS still connected keeps the agents going.
    const two = connectionRecords({
      rows: {
        ...NO_CONNECTION_ROWS,
        cms: [
          { provider: 'webflow', status: 'connected' },
          { provider: 'wordpress', status: 'connected' },
        ],
      },
      agents,
    });
    expect(byKey(two, 'webflow')?.stops).toEqual([]);
    expect(byKey(two, 'wordpress')?.stops).toEqual([]);
  });

  it('suggests at most two: what the brand’s agents lack first, then Search Console and Analytics', () => {
    const records = connectionRecords({
      rows: NO_CONNECTION_ROWS,
      agents: [
        { name: 'Traffic', needs: [{ kind: 'google_analytics', required: false }] },
        // A kind several tools give: nothing to pick for the person.
        { name: 'Publisher', needs: [{ kind: 'cms', required: true }] },
      ],
    });
    expect(records.filter((r) => r.suggested).map((r) => r.key)).toEqual([
      'google_search_console',
      'google_analytics',
    ]);
    const connected = connectionRecords({
      rows: { ...NO_CONNECTION_ROWS, brand: { gsc_property: 'sc', ga_property_id: 'ga' } },
      signIns: [
        {
          provider: 'google-search-console',
          status: 'connected',
          connected_by: null,
          created_at: null,
        },
        { provider: 'google-analytics', status: 'connected', connected_by: null, created_at: null },
      ],
    });
    expect(byKey(connected, 'google_analytics')?.status).toBe('connected');
    expect(connected.some((r) => r.suggested)).toBe(false);
  });

  it('never carries an id, a key or a token', () => {
    const text = JSON.stringify(
      connectionRecords({
        rows: {
          brand: { gsc_property: 'sc', ga_property_id: 'ga' },
          cms: [{ provider: 'webflow', status: 'connected', connected_by: 'u1' }],
          webhooks: [],
          catalog: [{ kind: 'merchant_center', last_status: 'ok', created_by: 'u1' }],
        },
        names: new Map(),
      }),
    );
    expect(text).not.toMatch(/"u1"|_id|secret|token|composio/);
  });
});

describe('readBrandAgents', () => {
  const agent = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    organization_id: ORG,
    name: `Agent ${id}`,
    status: 'active',
    owner_id: 'owner',
    visibility: 'workspace',
    version: 1,
    ...extra,
  });
  const version = (agentId: string, extra: Record<string, unknown> = {}) => ({
    agent_id: agentId,
    version: 1,
    skill_ids: ['publish'],
    connections: [],
    scope: { brand_ids: [BRAND] },
    ...extra,
  });

  it('reads the agents a person sees on the brand, active or paused, with what they need by kind', async () => {
    fake().tables.chat_agents = [
      agent('a'),
      agent('b', { status: 'paused' }),
      agent('c', { status: 'draft' }),
      agent('d', { visibility: 'private' }),
      agent('e'),
      agent('f'),
    ];
    fake().tables.chat_agent_versions = [
      version('a'),
      version('b', { skill_ids: ['report'], connections: [{ key: 'ga4', required: false }] }),
      version('c'),
      version('d'),
      version('e', { scope: { brand_ids: [OTHER] } }),
      version('f', { skill_ids: ['quality'], connections: [{ key: 'hubspot', required: true }] }),
    ];
    const manager = { userId: 'me', role: 'manager' as const, brandAccess: 'all' as const };
    expect(await readBrandAgents(ORG, BRAND, manager)).toEqual([
      { name: 'Agent a', needs: [{ kind: 'cms', required: true }] },
      // Its saved list; a skill adds only what it can't work without.
      { name: 'Agent b', needs: [{ kind: 'google_analytics', required: false }] },
    ]);
    // An Admin sees others' private agents too.
    const admin = { ...manager, role: 'admin' as const };
    expect((await readBrandAgents(ORG, BRAND, admin)).map((a) => a.name)).toEqual([
      'Agent a',
      'Agent b',
      'Agent d',
    ]);
  });
});

describe('readConnections and readBrandConnections', () => {
  it('read the same rows: the agents’ kinds and the page’s records agree', async () => {
    fake().tables.brands = [
      { id: BRAND, gsc_property: 'sc-domain:acme.com', ga_property_id: null },
    ];
    fake().tables.brand_cms_connections = [
      {
        brand_id: BRAND,
        provider: 'wordpress',
        status: 'connected',
        site_name: 'Blog',
        connected_by: 'u1',
      },
      { brand_id: OTHER, provider: 'webflow', status: 'connected', site_name: 'Not this brand' },
    ];
    fake().tables.webhook_configs = [
      { brand_id: BRAND, name: 'Off', events: ['content_draft.sent'], is_active: false },
    ];
    fake().tables.catalog_sources = [
      { brand_id: BRAND, kind: 'merchant_center', last_status: 'ok', account: '123' },
    ];
    fake().tables.integration_connections = [
      {
        organization_id: ORG,
        provider: 'google-search-console',
        status: 'connected',
        connected_by: 'u2',
      },
      { organization_id: ORG, provider: 'google-analytics', status: 'pending', connected_by: 'u2' },
    ];
    fake().tables.profiles = [
      { id: 'u1', organization_id: ORG, full_name: 'Sam Lee' },
      { id: 'u2', organization_id: ORG, full_name: ' Alex Kim ' },
    ];
    fake().tables.chat_agents = [];
    const records = await readConnections({
      organizationId: ORG,
      brandId: BRAND,
      viewer: { userId: 'u1', role: 'admin', brandAccess: 'all' },
      merchantCenterOffered: false,
    });
    const connected = records.filter((r) => r.status === 'connected');
    expect(connected.map((r) => [r.key, r.account, r.connectedBy])).toEqual([
      ['google_search_console', 'sc-domain:acme.com', 'Alex Kim'],
      ['wordpress', 'Blog', 'Sam Lee'],
      ['merchant_center', '123', null],
    ]);
    expect(await readBrandConnections(BRAND)).toEqual(
      new Set(['google_search_console', 'cms', 'catalog']),
    );
  });

  it('throws when a read fails, as the agents’ checks did', async () => {
    fake().failures.catalog_sources = { message: 'down' };
    await expect(readBrandConnections(BRAND)).rejects.toThrow(
      "Could not read the brand's connections: down",
    );
  });
});
