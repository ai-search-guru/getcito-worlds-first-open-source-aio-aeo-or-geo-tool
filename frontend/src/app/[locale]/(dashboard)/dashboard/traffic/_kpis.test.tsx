import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { DateRangePreset } from '@/components/filters/DateRangeFilter';
import type {
  TrafficDateWindow,
  TrafficGoogleTotals,
  TrafficSources,
  TrafficSummary,
} from '@/lib/actions/traffic';
import type { SourceState } from '@/lib/actions/integrations';

/**
 * AT-017 (spec §3.2): the AI Traffic page's KPI cards, two rows of four —
 * the snippet's visits, and what Google Analytics and Google Search Console
 * add — with each Google card's connection state until its source has data.
 */

const getTrafficGoogleTotals = vi.fn();
// The summary line above the cards (AT-007) counts the Cited, not clicked pages.
const getTrafficPages = vi.fn(async () => ({
  counts: { noAiTraffic: 0, citedNotClicked: 0, trafficNoPrompt: 0, all: 0 },
  rows: [],
}));
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/trafficReads', () => ({
  getTrafficGoogleTotals: (...args: unknown[]) => getTrafficGoogleTotals(...args),
  getTrafficPageCounts: async (...args: unknown[]) =>
    (await getTrafficPages(...(args as []))).counts,
  // The summary line's untracked Google queries (AT-009): tested with the line.
  getUntrackedQueryCount: async () => ({ count: 0, capped: false }),
}));
const connect = vi.fn();
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { TrafficKpis } = await import('./_kpis');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const synced = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-09-01T06:00:00.000Z',
  lastDataAt: '2026-10-18T06:00:00.000Z',
  property: '123456789',
  ...over,
});
const notConnected = synced({ connected: false, mapped: false, lastDataAt: null, property: null });

const sources = (ga: SourceState, gsc: SourceState): TrafficSources => ({
  snippetLastVisitAt: '2026-10-18T09:00:00.000Z',
  snippetFoundAt: null,
  snippetCheckedAt: null,
  ga,
  gsc,
});

const summary = (over: Partial<TrafficSummary> = {}): TrafficSummary => ({
  totalVisits: 4,
  totalVisitsPrev: 3,
  totalPageviews: 7,
  analyticsDays: [],
  hasPreviousPeriod: true,
  platformBreakdown: [
    { platform: 'gemini.google.com', visits: 2, visitsPrev: 1, analytics: null, surfaces: [] },
    { platform: 'chatgpt.com', visits: 1, visitsPrev: 1, analytics: null, surfaces: [] },
    { platform: 'perplexity.ai', visits: 1, visitsPrev: 1, analytics: null, surfaces: [] },
  ],
  topPages: [],
  hasAnyData: true,
  ...over,
});

const TOTALS: TrafficGoogleTotals = {
  ga: {
    sessions: 812,
    aiSessions: 4,
    aiEngagedSessions: 3,
    aiKeyEvents: 1,
    aiKeyEventSessions: 1,
    aiRevenue: 0,
    // Google organic: 58% engaged, as in the mockup.
    organic: { sessions: 1000, engagedSessions: 580, keyEvents: 60, keyEventSessions: 50 },
  },
  gsc: {
    since: '2026-10-16',
    until: '2026-10-16',
    clicks: 412,
    prevClicks: 438,
  },
};

const DAY: TrafficDateWindow = { dateFrom: '2026-10-17T12:30:00.000Z' };

let container: HTMLDivElement;
let root: Root;
const onRangeChange = vi.fn();
const onConnected = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getTrafficGoogleTotals.mockResolvedValue(TOTALS);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render({
  preset = '24h',
  dateWindow = DAY,
  sum = summary(),
  summaryLoading = false,
  src = sources(synced(), synced({ property: 'sc-domain:acme.example' })),
  sourcesFailed = false,
  canConnect = true,
}: {
  preset?: DateRangePreset;
  dateWindow?: TrafficDateWindow;
  sum?: TrafficSummary | null;
  summaryLoading?: boolean;
  src?: TrafficSources | null;
  sourcesFailed?: boolean;
  canConnect?: boolean;
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TrafficKpis
          brandId="b1"
          dateWindow={dateWindow}
          preset={preset}
          summary={sum}
          summaryLoading={summaryLoading}
          sources={src}
          sourcesFailed={sourcesFailed}
          canConnect={canConnect}
          onConnected={onConnected}
          onRangeChange={onRangeChange}
          rangeLabel="last 7 days"
        />
      </NextIntlClientProvider>,
    );
  });
}

/** Each card's text, by its label. */
function card(label: string): string {
  const cards = [...container.querySelectorAll('[data-slot="card"]')];
  const found = cards.find((c) => c.textContent?.startsWith(label));
  if (!found) throw new Error(`No card "${label}" in: ${container.textContent}`);
  return found.textContent ?? '';
}

describe('TrafficKpis', () => {
  it('shows the snippet and Google cards in the spec order, the AI Overviews card hidden', async () => {
    await render();
    const labels = [...container.querySelectorAll('[data-slot="card"]')].map(
      (c) => c.querySelector('.truncate')?.textContent,
    );
    expect(labels).toEqual([
      'AI-referred visits',
      'Top platform',
      'Platforms',
      'AI share of traffic',
      'Engaged visits',
      'Key events from AI',
      'Google clicks',
    ]);
  });

  it('writes the snippet cards, with Low sample below 30 visits', async () => {
    await render();
    expect(card('AI-referred visits')).toContain('4Low sample');
    expect(card('AI-referred visits')).toContain('7 pageviews · 3 in the previous period');
    // Cut off on a narrow card, it reads in full on hover.
    expect(
      container.querySelector('[title="7 pageviews · 3 in the previous period"]'),
    ).not.toBeNull();
    expect(card('Top platform')).toContain('Gemini');
    expect(card('Top platform')).toContain('2 visits');
    expect(card('Platforms')).toContain('3unique AI sources');
  });

  // gkhngyk on #1229: the beacon is public, so a source key can be any text.
  it('names the top platform among those it can name, as the summary line does', async () => {
    await render({
      sum: summary({
        platformBreakdown: [
          { platform: 'made-up.example', visits: 5, visitsPrev: 0, analytics: null, surfaces: [] },
          { platform: 'chatgpt.com', visits: 1, visitsPrev: 1, analytics: null, surfaces: [] },
        ],
      }),
    });
    expect(card('Top platform')).toContain('ChatGPT');
    expect(card('Top platform')).toContain('1 visit');
    expect(card('Top platform')).not.toContain('made-up');
  });

  // #1283: ChatGPT Shopping's visits are part of ChatGPT's.
  it("gives the top platform's visits through a surface, without counting another platform", async () => {
    await render({
      sum: summary({
        platformBreakdown: [
          {
            platform: 'chatgpt.com',
            visits: 40,
            visitsPrev: 30,
            analytics: null,
            surfaces: [{ surface: 'shopping', visits: 11, visitsPrev: 4, analytics: null }],
          },
          { platform: 'perplexity.ai', visits: 2, visitsPrev: 1, analytics: null, surfaces: [] },
        ],
      }),
    });
    expect(card('Top platform')).toContain('ChatGPT');
    expect(card('Top platform')).toContain('40 visits · 11 from ChatGPT Shopping');
    expect(card('Platforms')).toContain('2unique AI sources');
  });

  it('says how many days came from Google Analytics instead of a partial pageview count (AT-004)', async () => {
    await render({
      preset: '30d',
      dateWindow: { dateFrom: '2026-09-18T12:30:00.000Z' },
      sum: summary({ analyticsDays: ['2026-10-01', '2026-10-02', '2026-10-03'] }),
    });
    expect(card('AI-referred visits')).toContain(
      '3 in the previous period · 3 days from Google Analytics',
    );
    expect(card('AI-referred visits')).not.toContain('pageviews');

    await render({
      preset: 'all',
      dateWindow: {},
      sum: summary({ analyticsDays: ['2026-10-01'], hasPreviousPeriod: false }),
    });
    expect(card('AI-referred visits')).toContain('1 day from Google Analytics');
  });

  it('shows a % change once both periods have 30 visits', async () => {
    await render({ sum: summary({ totalVisits: 45, totalVisitsPrev: 30 }) });
    expect(card('AI-referred visits')).toContain('45+50%');
  });

  it("asks for the range's Google totals, Search Console's latest day for 24 hours", async () => {
    await render();
    expect(getTrafficGoogleTotals).toHaveBeenCalledWith('b1', DAY, {
      ga: true,
      gsc: true,
      gscLatestDays: 1,
    });
  });

  it('writes the spec examples on the Google cards', async () => {
    await render();
    expect(card('AI share of traffic')).toContain('0.5%4 of 812 sessions');
    // 4 AI sessions: a rate, marked Low sample (§5.4).
    expect(card('Engaged visits')).toContain('75%Low samplevs 58% Google organic');
    // 1 of 4 AI sessions had a key event: a rate, on too few sessions to compare.
    expect(card('Key events from AI')).toContain('1Low sample25% of AI sessions');
    expect(card('Google clicks')).toContain('412−6%');
    expect(card('Google clicks')).toContain('Oct 16 · latest reported day');
  });

  it("names a week's latest days, and a longer range's previous period", async () => {
    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      gsc: { ...TOTALS.gsc!, since: '2026-10-10', until: '2026-10-16' },
    });
    await render({ preset: '7d', dateWindow: { dateFrom: '2026-10-11T12:30:00.000Z' } });
    expect(card('Google clicks')).toContain('Oct 10 – Oct 16 · latest reported days');

    getTrafficGoogleTotals.mockResolvedValue(TOTALS);
    await render({ preset: '30d', dateWindow: { dateFrom: '2026-09-18T12:30:00.000Z' } });
    expect(getTrafficGoogleTotals).toHaveBeenLastCalledWith(
      'b1',
      { dateFrom: '2026-09-18T12:30:00.000Z' },
      { ga: true, gsc: true, gscLatestDays: null },
    );
    expect(card('Google clicks')).toContain('438 in the previous period');
  });

  it('compares the key event rate with Google organic once both sides are big enough (AT-005)', async () => {
    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      // 10% of 100 AI sessions against 5% of organic's.
      ga: { ...TOTALS.ga!, aiSessions: 100, aiKeyEvents: 12, aiKeyEventSessions: 10 },
    });
    await render({ preset: '30d', dateWindow: { dateFrom: '2026-09-18T12:30:00.000Z' } });
    expect(card('Key events from AI')).toContain('122× organic10% of AI sessions');
  });

  it('adds purchase revenue when the property reports it', async () => {
    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      ga: {
        ...TOTALS.ga!,
        aiSessions: 100,
        aiKeyEvents: 3,
        aiKeyEventSessions: 3,
        aiRevenue: 1240.4,
      },
    });
    await render({ preset: '30d', dateWindow: { dateFrom: '2026-09-18T12:30:00.000Z' } });
    // 3 key events: too few to compare with organic (§5.4).
    expect(card('Key events from AI')).toBe('Key events from AI33% of AI sessions · 1,240 revenue');
  });

  it('keeps the plain line while a rate is unknown, and without organic data', async () => {
    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      // Synced before the session key event rate: key events, no sessions holding them.
      ga: {
        ...TOTALS.ga!,
        aiKeyEvents: 2,
        aiKeyEventSessions: 0,
        organic: { sessions: 0, engagedSessions: 0, keyEvents: 0, keyEventSessions: 0 },
      },
    });
    await render({ preset: '30d', dateWindow: { dateFrom: '2026-09-18T12:30:00.000Z' } });
    expect(card('Key events from AI')).toBe('Key events from AI2in 4 AI sessions');
    expect(card('Engaged visits')).toContain('3 of 4 AI sessions');
  });

  it('offers 30 days when a short range has no key events', async () => {
    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      ga: { ...TOTALS.ga!, aiKeyEvents: 0 },
    });
    await render();
    expect(card('Key events from AI')).toContain('0none in 24h · see 30d');

    const see30d = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'see 30d',
    )!;
    act(() => see30d.click());
    expect(onRangeChange).toHaveBeenCalledWith('30d');
  });

  it('says when Analytics has nothing for the days, or no AI sessions', async () => {
    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      ga: { ...TOTALS.ga!, sessions: 0, aiSessions: 0, aiEngagedSessions: 0, aiKeyEvents: 0 },
    });
    await render({ preset: '30d' });
    expect(card('AI share of traffic')).toContain('—No data in this range');
    expect(card('Engaged visits')).toContain('—No data in this range');

    getTrafficGoogleTotals.mockResolvedValue({
      ...TOTALS,
      ga: { ...TOTALS.ga!, aiSessions: 0, aiEngagedSessions: 0, aiKeyEvents: 0 },
    });
    await render({ preset: '90d', dateWindow: { dateFrom: '2026-07-20T12:30:00.000Z' } });
    expect(card('Engaged visits')).toContain('—No AI sessions in this range');
  });

  it('shows each Google card as needing its source, with Connect', async () => {
    await render({ src: sources(notConnected, notConnected) });
    expect(getTrafficGoogleTotals).not.toHaveBeenCalled();
    for (const label of ['AI share of traffic', 'Engaged visits', 'Key events from AI']) {
      expect(card(label)).toContain('—Needs Google Analytics');
    }
    expect(card('Google clicks')).toContain('—Needs Google Search Console');

    const buttons = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Connect',
    );
    expect(buttons).toHaveLength(4);
    act(() => buttons[0].click());
    expect(connect).toHaveBeenCalled();
  });

  it('reads only the source that has data', async () => {
    await render({ src: sources(notConnected, synced({ property: 'sc-domain:acme.example' })) });
    expect(getTrafficGoogleTotals).toHaveBeenCalledWith('b1', DAY, {
      ga: false,
      gsc: true,
      gscLatestDays: 1,
    });
    expect(card('Google clicks')).toContain('412');
  });

  it('says how long the first sync takes, and where to choose a property', async () => {
    await render({
      src: sources(
        synced({ lastDataAt: null }),
        synced({ mapped: false, lastDataAt: null, property: null }),
      ),
    });
    expect(card('Engaged visits')).toContain('Syncing… · about 15 min');
    expect(card('Google clicks')).toContain('Choose a property for this brand');
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/settings?tab=integrations',
    );
  });

  it('shows "—" while the sources load, and tries the numbers when they fail to', async () => {
    await render({ src: null });
    expect(getTrafficGoogleTotals).not.toHaveBeenCalled();
    expect(card('Google clicks')).toContain('—');

    await render({ src: null, sourcesFailed: true });
    expect(getTrafficGoogleTotals).toHaveBeenCalledWith('b1', DAY, {
      ga: true,
      gsc: true,
      gscLatestDays: 1,
    });
    expect(card('AI share of traffic')).toContain('0.5%');
  });

  it('shows "—" when the totals fail, and never a previous range\'s totals', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getTrafficGoogleTotals.mockRejectedValue(new Error('boom'));
    await render();
    expect(card('AI share of traffic')).toBe('AI share of traffic—');
    error.mockRestore();

    getTrafficGoogleTotals.mockResolvedValue(TOTALS);
    await render({ preset: '7d', dateWindow: { dateFrom: '2026-10-11T12:30:00.000Z' } });
    expect(card('AI share of traffic')).toContain('0.5%');
    // A new range: until its totals arrive, the old ones aren't shown.
    getTrafficGoogleTotals.mockReturnValue(new Promise(() => {}));
    await render({ preset: 'all', dateWindow: {} });
    expect(card('AI share of traffic')).toBe('AI share of traffic—');
  });

  it("waits for the range's visits before writing AI share of traffic", async () => {
    await render({ summaryLoading: true });
    expect(card('AI share of traffic')).toBe('AI share of traffic—');
    expect(card('Engaged visits')).toContain('75%');
  });
});
