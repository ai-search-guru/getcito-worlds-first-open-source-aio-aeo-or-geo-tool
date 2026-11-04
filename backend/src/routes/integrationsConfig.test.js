import { describe, expect, it, vi } from 'vitest';

/**
 * Which integrations this deployment has credentials for: what GET
 * /api/integrations/config answers a member and the internal endpoint the
 * MCP layer reads (Product Visibility asks for Merchant Center only where
 * it is offered). Booleans only.
 */

const configured = vi.hoisted(() => new Set());
vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/composio.js', () => ({
  isComposioConfigured: (provider) => configured.has(provider),
}));
vi.mock('../lib/gaSync.js', () => ({ runGaSync: vi.fn() }));
vi.mock('../lib/gscSync.js', () => ({ runGscSync: vi.fn() }));
vi.mock('../lib/pageOpportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: vi.fn(), assertAllBrands: vi.fn() }));

const { integrationsConfig } = await import('./integrations.js');

describe('integrationsConfig', () => {
  it('says Merchant Center is offered only with its auth config', () => {
    expect(integrationsConfig()).toMatchObject({
      googleSearchConsole: false,
      googleAnalytics: false,
      googleMerchantCenter: false,
    });
    configured.add('google-merchant-center');
    configured.add('google-search-console');
    expect(integrationsConfig()).toMatchObject({
      googleSearchConsole: true,
      googleAnalytics: false,
      googleMerchantCenter: true,
    });
  });
});
