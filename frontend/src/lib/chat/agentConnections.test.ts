// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { connectedKinds, connectionGaps, connectionKindOf, neededConnections } =
  await import('./agentConnections');

/**
 * What an agent's connections need of a brand (CHAT-21 §D item 21, §H item
 * 42): any CMS is any connected site or a webhook that takes sent pages,
 * any catalog source one whose sign-in works; products saved agents name
 * count as their kind; what no integration offers yet isn't held against
 * a run.
 */

const none = { brand: null, cms: [], webhooks: [], catalog: [] };

describe('connectedKinds', () => {
  it('reads any CMS from a connected site of any provider, or a webhook that takes sent pages', () => {
    expect(connectedKinds(none)).toEqual(new Set());
    for (const provider of ['webflow', 'wordpress', 'framer', 'wix']) {
      expect(connectedKinds({ ...none, cms: [{ provider, status: 'connected' }] })).toEqual(
        new Set(['cms']),
      );
    }
    expect(
      connectedKinds({ ...none, cms: [{ provider: 'webflow', status: 'auth_failed' }] }),
    ).toEqual(new Set());
    expect(connectedKinds({ ...none, webhooks: [{ events: ['content_draft.sent'] }] })).toEqual(
      new Set(['cms']),
    );
    // A webhook for Action Center tasks only doesn't take pages.
    expect(
      connectedKinds({ ...none, webhooks: [{ events: ['action_task.sent'] }, { events: null }] }),
    ).toEqual(new Set());
  });

  it('reads any catalog source whose sign-in works, and the brand’s Search Console and Analytics', () => {
    expect(
      connectedKinds({
        ...none,
        catalog: [
          { kind: 'shopify', last_status: 'auth_failed' },
          { kind: 'feed_url', last_status: null },
        ],
      }),
    ).toEqual(new Set(['catalog']));
    expect(
      connectedKinds({
        ...none,
        catalog: [{ kind: 'merchant_center', last_status: 'auth_failed' }],
      }),
    ).toEqual(new Set());
    expect(
      connectedKinds({
        ...none,
        brand: { gsc_property: 'sc-domain:a.example', ga_property_id: '123' },
      }),
    ).toEqual(new Set(['google_search_console', 'google_analytics']));
  });

  it('given the sign-ins, counts a property only while its Google sign-in is connected', () => {
    const rows = { ...none, brand: { gsc_property: 'sc-domain:a.example', ga_property_id: '123' } };
    // Disconnected in Settings: the property is kept, the sign-in gone.
    expect(connectedKinds(rows, [])).toEqual(new Set());
    expect(
      connectedKinds(rows, [
        { provider: 'google-search-console', status: 'connected' },
        { provider: 'google-analytics', status: 'error' },
      ]),
    ).toEqual(new Set(['google_search_console']));
    expect(connectedKinds(rows, [{ provider: 'google-analytics', status: 'connected' }])).toEqual(
      new Set(['google_analytics']),
    );
  });
});

describe('connectionGaps', () => {
  it('splits what the brand lacks into Required and Optional, products as their kind', () => {
    const connected = new Set(['cms']);
    expect(
      connectionGaps(
        [
          { key: 'cms', required: true },
          { key: 'google_search_console', required: false },
          { key: 'catalog', required: true },
          { key: 'webflow', required: true },
          { key: 'shopify', required: false },
        ],
        connected,
      ),
    ).toEqual({ required: ['catalog'], optional: ['google_search_console', 'shopify'] });
  });

  it('holds nothing against a run for a connection no integration offers yet', () => {
    expect(connectionKindOf('hubspot')).toBeNull();
    expect(connectionGaps([{ key: 'hubspot', required: true }], new Set())).toEqual({
      required: [],
      optional: [],
    });
    expect(connectionKindOf('wix')).toBe('cms');
    expect(connectionKindOf('merchant_center')).toBe('catalog');
  });
});

describe('neededConnections', () => {
  it('adds what the skills can’t work without, Required, to the saved list', () => {
    expect(neededConnections(['publish'], [])).toEqual([{ key: 'cms', required: true }]);
    expect(
      neededConnections(
        ['winback', 'shopping'],
        [
          { key: 'catalog', required: false },
          { key: 'google_analytics', required: false },
        ],
      ),
    ).toEqual([
      { key: 'catalog', required: true },
      { key: 'google_analytics', required: false },
    ]);
    // Optional uses aren't added: /winback runs without them.
    expect(neededConnections(['winback', 'report'], [])).toEqual([]);
  });
});
