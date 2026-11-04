import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentConversions } from '@/lib/content/conversions';
import type { ContentImpact, ContentResults, ResultSource } from '@/lib/content/impact';
import { ImpactTab } from './_ImpactTab';

const getContentImpact = vi.fn();
const getContentResults = vi.fn();
const getContentConversions = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  getContentImpact: (...args: unknown[]) => getContentImpact(...args),
  getContentResults: (...args: unknown[]) => getContentResults(...args),
  getContentConversions: (...args: unknown[]) => getContentConversions(...args),
}));
// The brand's kind of site, as the store holds it: guessed (B2B) unless a test says.
const store = vi.hoisted(() => ({ brands: [] as { id: string; siteType?: string }[] }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: typeof store) => unknown) => select(store),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = 'https://acme.example.com/pricing';

const impact = (over: Partial<ContentImpact> = {}): ContentImpact => ({
  citations: { cur: 45, prev: 30 },
  promptCounts: { cur: 1, prev: 2, lost: 1 },
  aiVisits: { cur: 4, prev: 2 },
  gscClicks: { cur: 12, prev: 0 },
  gscSince: '2026-01-01',
  prompts: [
    {
      id: 'p1',
      text: 'best crm for realtors',
      cur: 3,
      prev: 1,
      curPlatforms: ['chatgpt', 'perplexity'],
      prevPlatforms: ['chatgpt'],
    },
    {
      id: 'p2',
      text: 'crm pricing',
      cur: 0,
      prev: 2,
      curPlatforms: [],
      prevPlatforms: ['google-ai-overviews'],
    },
  ],
  overlap: [],
  ...over,
});

const source = (platform: string, over: Partial<ResultSource> = {}): ResultSource => ({
  platform,
  visits: 0,
  sessions: 0,
  keyEvents: 0,
  keyEventSessions: 0,
  transactions: 0,
  revenue: 0,
  ...over,
});

const results = (over: Partial<ContentResults> = {}): ContentResults => ({
  analytics: true,
  purchases: false,
  sources: [
    source('chatgpt.com', { visits: 30, sessions: 40, keyEvents: 6, keyEventSessions: 4 }),
    source('perplexity.ai', { visits: 8, sessions: 2, keyEvents: 1, keyEventSessions: 1 }),
    source('unknown', { visits: 3 }),
  ],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

const onUseLostPrompts = vi.fn();

async function render(pageUrl: string | null = PAGE, withLostPrompts = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ImpactTab
          brandId="b1"
          pageUrl={pageUrl}
          onUseLostPrompts={withLostPrompts ? onUseLostPrompts : undefined}
        />
      </NextIntlClientProvider>,
    );
  });
}

const metric = (label: string) =>
  [...container.querySelectorAll('.grid > div')].find(
    (cell) => cell.firstElementChild?.textContent === label,
  )?.textContent;
const periodButton = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00Z'), toFake: ['Date'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentImpact.mockReset();
  getContentResults.mockReset().mockResolvedValue(results());
  getContentConversions.mockReset().mockResolvedValue(null);
  store.brands = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the Live page tab', () => {
  it('shows what the page earns over the last 30 days against the 30 before', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();

    // The live page's numbers, not a forecast for the draft (gkhngyk's reading).
    expect(container.textContent).toContain('The live page today');
    expect(container.textContent).toContain(
      'How the live page does now, not a forecast of what this draft will get.',
    );
    expect(getContentImpact).toHaveBeenCalledWith('b1', PAGE, 30);
    expect(getContentResults).toHaveBeenCalledWith('b1', PAGE, 30);
    expect(periodButton('30d').getAttribute('aria-pressed')).toBe('true');
    expect(metric('Citations')).toBe('Citations45+50%');
    expect(metric('AI visits')).toBe('AI visits4Low sample');
    expect(metric('Google clicks')).toBe('Google clicks12New');
    // One prompt cites it now, as two did before.
    expect(metric('Prompts cited')).toBe('Prompts cited1−1');
  });

  it('lists the prompts, the lost one with where it was cited', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();

    expect(container.textContent).toContain('Prompts cited · 1 · 1 lost');
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'best crm for realtorsChatGPT, PerplexityCited 3×',
      'crm pricingWas cited on Google AI OverviewsLost',
    ]);
    expect(
      container.querySelector('a[href^="/dashboard/citations/url"]')!.getAttribute('href'),
    ).toBe(`/dashboard/citations/url?u=${encodeURIComponent(PAGE)}`);
  });

  it('uses the lost prompts in the draft', async () => {
    onUseLostPrompts.mockReset();
    getContentImpact.mockResolvedValue(impact());
    await render();
    await act(async () => periodButton('Use the lost prompt in this draft').click());
    expect(onUseLostPrompts).toHaveBeenCalledWith(['p2']);

    // Nothing lost, or nowhere to use them: no button.
    getContentImpact.mockResolvedValue(impact({ prompts: impact().prompts.slice(0, 1) }));
    await act(async () => periodButton('7d').click());
    expect(container.textContent).not.toContain('lost prompt');
    await render(PAGE, false);
    expect(container.textContent).not.toContain('in this draft');
  });

  it('counts the prompts over all of them, not the list it shows', async () => {
    // The list is cut at 100 (lost prompts last); the counts come whole.
    getContentImpact.mockResolvedValue(impact({ promptCounts: { cur: 140, prev: 150, lost: 12 } }));
    await render();
    expect(metric('Prompts cited')).toBe('Prompts cited140−10');
    expect(container.textContent).toContain('Prompts cited · 140 · 12 lost');
  });

  it('names the brand’s other pages cited for the same prompts', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();
    expect(container.textContent).toContain('The only page cited for its prompt · no overlap');

    getContentImpact.mockResolvedValue(
      impact({ overlap: [{ page: 'https://acme.example.com/blog/crm-guide', prompts: 1 }] }),
    );
    await act(async () => periodButton('7d').click());
    expect(container.textContent).toContain('/blog/crm-guide1 of 1 prompt');
  });

  it('reads the period picked', async () => {
    getContentImpact.mockResolvedValue(impact());
    await render();
    await act(async () => periodButton('90d').click());
    expect(getContentImpact).toHaveBeenLastCalledWith('b1', PAGE, 90);
    expect(getContentResults).toHaveBeenLastCalledWith('b1', PAGE, 90);
    expect(periodButton('90d').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('The last 90 days against the 90 before');
  });

  it('says when Search Console has no data, or doesn’t reach back far enough', async () => {
    getContentImpact.mockResolvedValue(impact({ gscSince: null }));
    await render();
    expect(metric('Google clicks')).toBe('Google clicks—No Search Console data');

    // 190 days of page data: 1y starts before it, so no change is shown.
    getContentImpact.mockResolvedValue(
      impact({ gscSince: '2026-04-14', gscClicks: { cur: 300, prev: 0 } }),
    );
    await act(async () => periodButton('1y').click());
    expect(metric('Google clicks')).toBe('Google clicks300—');
    expect(container.textContent).toContain('Search Console keeps 190 days of page data');
  });

  it('says when no prompt cited the page', async () => {
    getContentImpact.mockResolvedValue(
      impact({
        citations: { cur: 0, prev: 0 },
        promptCounts: { cur: 0, prev: 0, lost: 0 },
        prompts: [],
        overlap: [],
      }),
    );
    await render();
    expect(container.textContent).toContain('No tracked prompt cited this page');
    expect(container.textContent).not.toContain('no overlap');
  });

  it('offers to retry when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentImpact.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(impact());
    await render();
    expect(container.textContent).toContain("Couldn't load the live page's numbers.");

    await act(async () => periodButton('Retry').click());
    expect(getContentImpact).toHaveBeenCalledTimes(2);
    expect(metric('Citations')).toBe('Citations45+50%');
  });

  describe('results from AI visits', () => {
    const resultRows = () =>
      [...container.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((cell) => cell.textContent),
      );
    const headers = () => [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    it('shows the key events from AI visits and each source’s visits and key events', async () => {
      getContentImpact.mockResolvedValue(impact());
      await render();

      expect(container.textContent).toContain('Results from AI visits');
      expect(metric('Key events')).toBe('Key events7');
      // 5 of 42 Analytics sessions had a key event.
      expect(metric('Key event rate')).toBe('Key event rate11.9%');
      expect(metric('Orders')).toBeUndefined();
      expect(headers()).toEqual(['AI source', 'Visits', 'Key events']);
      expect(resultRows()).toEqual([
        ['ChatGPT', '30', '6'],
        ['Perplexity', '8', '1'],
        ['Other', '3', '0'],
      ]);
    });

    it('adds orders and revenue when the property reports purchases', async () => {
      getContentImpact.mockResolvedValue(impact());
      getContentResults.mockResolvedValue(
        results({
          purchases: true,
          sources: [
            source('chatgpt.com', {
              visits: 12,
              sessions: 12,
              keyEvents: 3,
              keyEventSessions: 3,
              transactions: 2,
              revenue: 1234.6,
            }),
          ],
        }),
      );
      await render();

      expect(metric('Orders')).toBe('Orders2');
      expect(metric('Revenue')).toBe('Revenue1,235');
      // 12 sessions: too few for a rate.
      expect(metric('Key event rate')).toBe('Key event rate—Low sample · 12 sessions');
      expect(headers()).toEqual(['AI source', 'Visits', 'Key events', 'Revenue']);
      expect(resultRows()).toEqual([['ChatGPT', '12', '3', '1,235']]);
    });

    it('lists the visits per source, and where to connect Google Analytics, without it', async () => {
      getContentImpact.mockResolvedValue(impact());
      getContentResults.mockResolvedValue(
        results({ analytics: false, sources: [source('claude.ai', { visits: 5 })] }),
      );
      await render();

      expect(metric('Key events')).toBeUndefined();
      expect(container.textContent).toContain('come from Google Analytics');
      expect(container.querySelector('a[href="/dashboard/traffic"]')!.textContent).toBe(
        'Open AI Traffic',
      );
      expect(headers()).toEqual(['AI source', 'Visits']);
      expect(resultRows()).toEqual([['Claude', '5']]);
      expect(container.textContent).toContain('Visits come from the tracking snippet.');
    });

    it('says when no AI visits reached the page', async () => {
      getContentImpact.mockResolvedValue(impact());
      getContentResults.mockResolvedValue(results({ sources: [] }));
      await render();
      expect(metric('Key events')).toBe('Key events0');
      expect(container.textContent).toContain('No AI visits to this page in this period.');
      expect(container.querySelector('table')).toBeNull();
    });

    it('counts a failed read of the results as a failed tab', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentImpact.mockResolvedValue(impact());
      getContentResults.mockRejectedValueOnce(new Error('boom'));
      await render();
      expect(container.textContent).toContain("Couldn't load the live page's numbers.");
    });
  });

  it('has nothing to measure for a new page', async () => {
    await render(null);
    expect(getContentImpact).not.toHaveBeenCalled();
    expect(getContentResults).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This draft is a new page, not live yet');
  });

  describe('conversions from AI journeys through the page (CE-017)', () => {
    const conversions = (over: Partial<ContentConversions> = {}): ContentConversions => ({
      page: '/pricing',
      enabled: true,
      goals: [
        { goal: 'demo', count: 4, units: 0 },
        { goal: 'signup', count: 2, units: 0 },
        { goal: 'newsletter', count: 1, units: 0 },
      ],
      revenue: [],
      sources: [
        { platform: 'perplexity.ai', conversions: 2 },
        { platform: 'chatgpt.com', conversions: 5 },
      ],
      journeys: [
        {
          source: 'chatgpt.com',
          pages: ['/blog/crm-data-hygiene', '/pricing'],
          goal: 'demo',
          count: 4,
        },
      ],
      ...over,
    });
    const section = () =>
      [...container.querySelectorAll('section')].find((el) =>
        el.textContent?.startsWith('Conversions from AI journeys'),
      )!;

    it('shows a B2B site’s signups and demo forms, by source, and its journeys with this page', async () => {
      getContentImpact.mockResolvedValue(impact());
      getContentConversions.mockResolvedValue(conversions());
      await render();
      expect(getContentConversions).toHaveBeenCalledWith('b1', PAGE, 30);
      const cards = [...section().querySelectorAll('.grid > div')].map((el) => el.textContent);
      // Its own goals first, then a card for each other goal it had.
      expect(cards).toEqual(['Signups2', 'Demo forms4', 'Newsletter signups1']);
      const rows = [...section().querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((cell) => cell.textContent),
      );
      expect(rows).toEqual([
        ['ChatGPT', '5'],
        ['Perplexity', '2'],
      ]);
      const journey = section().querySelector('ol li')!;
      expect(journey.textContent).toBe(
        'ChatGPT/blog/crm-data-hygieneThis pageDemo form4 4 conversions',
      );
    });

    it('keeps this page in view when a long journey is shortened', async () => {
      getContentImpact.mockResolvedValue(impact());
      getContentConversions.mockResolvedValue(
        conversions({
          journeys: [
            {
              source: 'chatgpt.com',
              pages: ['/blog/a', '/blog/b', '/pricing', '/c', '/d', '/e', '/checkout'],
              goal: 'demo',
              count: 1,
            },
          ],
        }),
      );
      await render();
      expect(section().querySelector('ol li')!.textContent).toBe(
        'ChatGPT/blog/a…This page…/checkoutDemo form1 1 conversion',
      );
    });

    it('shows a shop’s orders, revenue per currency and units sold', async () => {
      store.brands = [{ id: 'b1', siteType: 'ecommerce' }];
      getContentImpact.mockResolvedValue(impact());
      getContentConversions.mockResolvedValue(
        conversions({
          goals: [{ goal: 'order', count: 3, units: 7 }],
          revenue: [{ currency: 'EUR', value: 1290 }],
          journeys: [],
        }),
      );
      await render();
      const cards = [...section().querySelectorAll('.grid > div')].map((el) => el.textContent);
      expect(cards).toEqual(['Orders3', 'Revenue€1,290', 'Units sold7']);
    });

    it('says where to turn them on while the brand has them off, and what they counted before', async () => {
      getContentImpact.mockResolvedValue(impact());
      getContentConversions.mockResolvedValue(conversions({ enabled: false }));
      await render();
      expect(section().textContent).toContain("Conversions aren't on for this brand");
      expect(section().querySelector('a')!.getAttribute('href')).toBe(
        '/dashboard/brands/b1/settings?tab=tracking',
      );
      expect(section().querySelectorAll('.grid > div')).toHaveLength(3);

      // Nothing counted: the note alone.
      getContentConversions.mockResolvedValue(
        conversions({ enabled: false, goals: [], sources: [], journeys: [] }),
      );
      await act(async () => root.unmount());
      root = createRoot(container);
      await render();
      expect(section().querySelector('.grid')).toBeNull();
      expect(section().querySelector('table')).toBeNull();
    });

    it('leaves the rest of the tab when they can’t be read', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentImpact.mockResolvedValue(impact());
      getContentConversions.mockRejectedValue(new Error('boom'));
      await render();
      expect(metric('Citations')).toBe('Citations45+50%');
      expect(container.textContent).not.toContain('Conversions from AI journeys');
    });
  });
});
