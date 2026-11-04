import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MENTIONS_FILTERS,
  mentionsHref,
  mentionsQuery,
  mentionsStateParams,
  readMentionsState,
  type MentionsFilters,
} from './mentionsFilters';

const read = (query: string) => readMentionsState(new URLSearchParams(query));

describe('readMentionsState', () => {
  it('opens on the Overview tab over 30 days with no filters', () => {
    expect(read('')).toEqual({ tab: 'overview', filters: DEFAULT_MENTIONS_FILTERS });
  });

  it('reads every filter a shared link carries', () => {
    expect(
      read(
        'tab=mentions&range=custom&from=2026-10-01&to=2026-10-14&platform=gemini-web&region=US&topic=t1&q=integrations',
      ),
    ).toEqual({
      tab: 'mentions',
      filters: {
        range: 'custom',
        from: '2026-10-01',
        to: '2026-10-14',
        platform: 'gemini-web',
        region: 'US',
        topic: 't1',
        q: 'integrations',
      },
    });
  });

  it('falls back to the defaults on an unknown tab or range', () => {
    expect(read('tab=fact-check&range=1y')).toEqual({
      tab: 'overview',
      filters: DEFAULT_MENTIONS_FILTERS,
    });
  });

  it('ignores custom dates unless the range is custom', () => {
    expect(read('range=7d&from=2026-10-01&to=2026-10-14').filters).toMatchObject({
      range: '7d',
      from: '',
      to: '',
    });
  });
});

describe('mentionsStateParams', () => {
  it('leaves the defaults out, so the default view has a clean URL', () => {
    expect(
      Object.values(mentionsStateParams('overview', DEFAULT_MENTIONS_FILTERS)).every(
        (v) => v === null,
      ),
    ).toBe(true);
  });

  it('round-trips through the URL', () => {
    const filters: MentionsFilters = {
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-14',
      platform: 'chatgpt-web',
      region: 'GB',
      topic: 't2',
      q: 'pricing',
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(mentionsStateParams('perception', filters))) {
      if (v !== null) params.set(k, v);
    }
    expect(readMentionsState(params)).toEqual({ tab: 'perception', filters });
  });

  it('drops custom dates outside a custom range and trims the search', () => {
    expect(
      mentionsStateParams('overview', {
        ...DEFAULT_MENTIONS_FILTERS,
        range: '7d',
        from: '2026-10-01',
        q: '  pricing ',
      }),
    ).toMatchObject({ range: '7d', from: null, q: 'pricing' });
  });
});

describe('mentionsQuery', () => {
  const at = (iso: string) => {
    const real = Date.now;
    return <T>(fn: () => T): T => {
      Date.now = () => Date.parse(iso);
      try {
        return fn();
      } finally {
        Date.now = real;
      }
    };
  };

  it('turns a preset into its window and leaves empty filters out', () => {
    const q = at('2026-10-17T12:00:00.000Z')(() =>
      mentionsQuery({ ...DEFAULT_MENTIONS_FILTERS, range: '7d', platform: 'claude', q: ' faq ' }),
    );
    expect(q).toEqual({
      from: '2026-10-10T12:00:00.000Z',
      platform: 'claude',
      search: 'faq',
    });
  });

  // The days Insights reads and mentions_overview reads, wherever the viewer is.
  it('reads a custom range as whole UTC days, west of UTC too', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const q = at('2026-10-17T12:00:00.000Z')(() =>
        mentionsQuery({
          ...DEFAULT_MENTIONS_FILTERS,
          range: 'custom',
          from: '2026-10-01',
          to: '2026-10-14',
        }),
      );
      expect(q?.from).toBe('2026-10-01T00:00:00.000Z');
      expect(q?.to).toBe('2026-10-14T23:59:59.999Z');
    } finally {
      process.env.TZ = zone;
    }
  });

  it('is null for a custom range with no dates yet', () => {
    expect(mentionsQuery({ ...DEFAULT_MENTIONS_FILTERS, range: 'custom' })).toBeNull();
  });
});

describe('mentionsHref', () => {
  it("opens Mentions on another page's range and filters", () => {
    expect(mentionsHref({ range: '7d', region: 'us', topic: 't1' })).toBe(
      '/dashboard/mentions?range=7d&region=us&topic=t1',
    );
    expect(mentionsHref({ range: 'custom', from: '2026-10-01', to: '2026-10-14' })).toBe(
      '/dashboard/mentions?range=custom&from=2026-10-01&to=2026-10-14',
    );
  });

  it("leaves Mentions' default range out, and opens it for a range it lacks", () => {
    expect(mentionsHref({ range: '30d' })).toBe('/dashboard/mentions');
    expect(mentionsHref({ range: 'all', region: 'us' })).toBe('/dashboard/mentions?region=us');
  });
});
