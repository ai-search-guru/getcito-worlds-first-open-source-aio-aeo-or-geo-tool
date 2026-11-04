import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Composio for Webflow (Send to CMS, #1331 phase 2): a brand's site token as an API-key account. */

const sdk = {
  initiate: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
  proxyExecute: vi.fn(),
};
vi.mock('@composio/core', () => ({
  AuthScheme: { APIKey: (val) => ({ authScheme: 'API_KEY', val }) },
  Composio: class {
    connectedAccounts = {
      initiate: (...args) => sdk.initiate(...args),
      list: (...args) => sdk.list(...args),
      delete: (...args) => sdk.delete(...args),
    };
    tools = {
      execute: (...args) => sdk.execute(...args),
      proxyExecute: (...args) => sdk.proxyExecute(...args),
    };
  },
}));

const {
  connectWebflowToken,
  entityIdFor,
  executeWebflowTool,
  forgetWebflowAccounts,
  getActiveConnection,
  isWebflowConfigured,
  listGaProperties,
  listGscSites,
  proxyRequest,
  queryGscSearchAnalytics,
  runGaReport,
} = await import('./composio.js');

beforeEach(() => {
  vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
  vi.stubEnv('COMPOSIO_WEBFLOW_AUTH_CONFIG_ID', 'ac_webflow');
  for (const fn of Object.values(sdk)) fn.mockReset();
});

afterAll(() => vi.unstubAllEnvs());

describe('Webflow on Composio', () => {
  it('is set up with the API key and the Webflow auth config', () => {
    expect(isWebflowConfigured()).toBe(true);
    vi.stubEnv('COMPOSIO_WEBFLOW_AUTH_CONFIG_ID', '');
    expect(isWebflowConfigured()).toBe(false);
  });

  it('connects a token as one more API-key account of the brand: the one it replaces is still there', async () => {
    sdk.initiate.mockResolvedValue({ id: 'ca_new', status: 'ACTIVE' });
    expect(await connectWebflowToken('brand_b1', 'wf-token')).toBe('ca_new');
    expect(sdk.initiate).toHaveBeenCalledWith('brand_b1', 'ac_webflow', {
      config: { authScheme: 'API_KEY', val: { api_key: 'wf-token' } },
      allowMultiple: true,
    });
  });

  it('removes the brand’s Webflow accounts but the one kept', async () => {
    sdk.list.mockResolvedValue({ items: [{ id: 'ca_old' }, { id: 'ca_new' }, { id: 'ca_left' }] });
    await forgetWebflowAccounts('brand_b1', 'ca_new');
    expect(sdk.list).toHaveBeenCalledWith({ authConfigIds: ['ac_webflow'], userIds: ['brand_b1'] });
    expect(sdk.delete.mock.calls).toEqual([['ca_old'], ['ca_left']]);

    sdk.delete.mockClear();
    await forgetWebflowAccounts('brand_b1');
    expect(sdk.delete).toHaveBeenCalledTimes(3);

    sdk.delete.mockRejectedValueOnce(new Error('down'));
    await expect(forgetWebflowAccounts('brand_b1')).rejects.toThrow('down');
  });

  it('runs a tool on the brand’s own account, pinned to a toolkit version', async () => {
    sdk.execute.mockResolvedValueOnce({ successful: true, data: { sites: [] } });
    expect(
      await executeWebflowTool(
        'WEBFLOW_LIST_WEBFLOW_SITES',
        {
          entityId: 'brand_b1',
          accountId: 'ca_new',
        },
        {},
      ),
    ).toEqual({ sites: [] });
    expect(sdk.execute).toHaveBeenCalledWith('WEBFLOW_LIST_WEBFLOW_SITES', {
      userId: 'brand_b1',
      connectedAccountId: 'ca_new',
      arguments: {},
      version: '20260826_00',
    });
    sdk.execute.mockResolvedValueOnce({ successful: false, error: '401 Unauthorized' });
    await expect(
      executeWebflowTool('WEBFLOW_LIST_WEBFLOW_SITES', { entityId: 'b', accountId: 'a' }, {}),
    ).rejects.toThrow('401 Unauthorized');
  });
});

describe('the workspace entity', () => {
  it('is one per organization: org_ and its id (#577)', () => {
    expect(entityIdFor('org-9')).toBe('org_org-9');
  });
});

/**
 * Several sign-ins may share one entity (BRAND-ACCESS PR 14): an entity
 * holds more than one connected account of an auth config when they are
 * linked with allowMultiple, as Webflow's are. A Google call therefore names
 * the connected account the brand uses; with only the entity, Composio would
 * pick one itself.
 */
describe('Google calls on a named connected account', () => {
  const connection = { entityId: 'org_org-1', accountId: 'ca_2' };

  beforeEach(() => {
    vi.stubEnv('COMPOSIO_GSC_AUTH_CONFIG_ID', 'ac_gsc');
  });

  it('runs Search Console and Analytics tools on that account', async () => {
    sdk.execute.mockResolvedValue({ successful: true, data: { siteEntry: [], rows: [] } });
    await listGscSites(connection);
    await queryGscSearchAnalytics(connection, { site_url: 'sc-domain:acme.com' });
    await runGaReport(connection, '123', { limit: 10 });
    for (const [, body] of sdk.execute.mock.calls) {
      expect(body).toMatchObject({ userId: 'org_org-1', connectedAccountId: 'ca_2' });
    }
    expect(sdk.execute.mock.calls[2][1].arguments).toEqual({
      property: 'properties/123',
      limit: 10,
    });
  });

  it('reads the property streams on the same account', async () => {
    sdk.execute
      .mockResolvedValueOnce({
        successful: true,
        data: {
          accountSummaries: [
            {
              displayName: 'Acme',
              propertySummaries: [{ property: 'properties/9', displayName: 'Web' }],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        successful: true,
        data: { dataStreams: [{ webStreamData: { defaultUri: 'https://acme.com' } }] },
      });
    expect(await listGaProperties(connection)).toEqual([
      { propertyId: '9', displayName: 'Web', accountName: 'Acme', siteUrls: ['https://acme.com'] },
    ]);
    expect(sdk.execute).toHaveBeenCalledTimes(2);
    for (const [, body] of sdk.execute.mock.calls) {
      expect(body).toMatchObject({ userId: 'org_org-1', connectedAccountId: 'ca_2' });
    }
  });

  it('lists the property ids alone, without the streams, when asked', async () => {
    sdk.execute.mockResolvedValueOnce({
      successful: true,
      data: {
        accountSummaries: [
          {
            displayName: 'Acme',
            propertySummaries: [{ property: 'properties/9', displayName: 'Web' }],
          },
        ],
      },
    });
    expect(await listGaProperties(connection, { streams: false })).toEqual([
      { propertyId: '9', displayName: 'Web', accountName: 'Acme', siteUrls: [] },
    ]);
    expect(sdk.execute).toHaveBeenCalledTimes(1);
  });

  it('runs on the entity alone when no account is known, as before', async () => {
    sdk.execute.mockResolvedValue({ successful: true, data: { siteEntry: [] } });
    await listGscSites({ entityId: 'org_org-1', accountId: null });
    expect(sdk.execute.mock.calls[0][1]).not.toHaveProperty('connectedAccountId');
    expect(sdk.execute.mock.calls[0][1].userId).toBe('org_org-1');
  });

  it('finds the named account among the entity’s active ones, or none', async () => {
    sdk.list.mockResolvedValue({ items: [{ id: 'ca_1' }, { id: 'ca_2' }] });
    expect(await getActiveConnection('google-search-console', 'org_org-1', 'ca_2')).toEqual({
      id: 'ca_2',
    });
    expect(sdk.list).toHaveBeenCalledWith({
      authConfigIds: ['ac_gsc'],
      userIds: ['org_org-1'],
      statuses: ['ACTIVE'],
    });
    expect(await getActiveConnection('google-search-console', 'org_org-1', 'ca_9')).toBeNull();
    // Without one, the first, as the Account's own card reads it.
    expect(await getActiveConnection('google-search-console', 'org_org-1')).toEqual({ id: 'ca_1' });
  });
});

describe('proxyRequest (#1270)', () => {
  const ENDPOINT = 'https://merchantapi.googleapis.com/accounts/v1/accounts';

  it("calls the provider's API on one connected account, the query as parameters", async () => {
    sdk.proxyExecute.mockResolvedValueOnce({
      status: 200,
      headers: { 'retry-after': '1' },
      data: { accounts: [] },
    });
    const signal = new AbortController().signal;
    await expect(
      proxyRequest('ca_1', {
        endpoint: ENDPOINT,
        query: { pageSize: 500, pageToken: undefined, filter: '', other: null },
        signal,
      }),
    ).resolves.toEqual({ status: 200, headers: { 'retry-after': '1' }, data: { accounts: [] } });
    expect(sdk.proxyExecute).toHaveBeenCalledWith(
      {
        endpoint: ENDPOINT,
        method: 'GET',
        parameters: [{ in: 'query', name: 'pageSize', value: '500' }],
        connectedAccountId: 'ca_1',
      },
      { signal },
    );
  });

  it("answers the API's own status, whatever it is, and lets Composio's refusals through", async () => {
    sdk.proxyExecute.mockResolvedValueOnce({ status: 403 });
    await expect(proxyRequest('ca_1', { endpoint: ENDPOINT })).resolves.toEqual({
      status: 403,
      headers: {},
      data: null,
    });
    expect(sdk.proxyExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ parameters: [] }),
      undefined,
    );
    const refused = Object.assign(new Error('403 No permission'), { status: 403 });
    sdk.proxyExecute.mockRejectedValueOnce(refused);
    await expect(proxyRequest('ca_1', { endpoint: ENDPOINT })).rejects.toBe(refused);
  });
});
