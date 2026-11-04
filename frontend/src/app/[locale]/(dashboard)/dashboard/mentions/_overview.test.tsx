import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { DEFAULT_MENTIONS_FILTERS } from '@/lib/mentionsFilters';
import type { MentionPlatformRow, MentionsOverview, MentionTotals } from '@/lib/mentionsOverview';
import { CompetitorTable } from './_CompetitorTable';
import { Headline } from './_headline';
import { MentionsOverviewTab } from './_overview';
import { OverviewKpis } from './_OverviewKpis';
import { PlatformTable } from './_PlatformTable';

const getMentionsOverview = vi.fn();
vi.mock('@/lib/actions/mentions', () => ({
  getMentionsOverview: (...args: unknown[]) => getMentionsOverview(...args),
}));
// The chart is loaded on demand and measured; its card is not what these tests read.
vi.mock('./_TrendCard', () => ({ TrendCard: () => null }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const totals = (over: Partial<MentionTotals>): MentionTotals => ({
  answers: 0,
  mentions: 0,
  occurrences: 0,
  positive: 0,
  negative: 0,
  positionSum: 0,
  positionCount: 0,
  prompts: 0,
  promptsWithMentions: 0,
  lastAnswerAt: null,
  ...over,
});

const platform = (
  id: string,
  now: [number, number, number, number],
  before: [number, number, number, number] = [0, 0, 0, 0],
): MentionPlatformRow => ({
  platform: id,
  answers: now[0],
  mentions: now[1],
  // Each response naming the brand names it twice here.
  occurrences: now[1] * 2,
  positive: now[2],
  negative: now[3],
  previous: { answers: before[0], mentions: before[1], positive: before[2], negative: before[3] },
});

// The mockup's story: net +34, down 6, most of it on Gemini, usually beside
// Profound and Peec AI.
const overview: MentionsOverview = {
  window: {
    from: '2026-09-17T09:00:00Z',
    to: '2026-10-17T09:00:00Z',
    days: 30,
    source: 'days',
    dayFrom: '2026-09-18',
    dayTo: '2026-10-17',
  },
  current: totals({
    answers: 400,
    mentions: 100,
    occurrences: 260,
    positive: 48,
    negative: 14,
    prompts: 20,
    promptsWithMentions: 15,
  }),
  previous: totals({
    answers: 400,
    mentions: 80,
    occurrences: 200,
    positive: 40,
    negative: 8,
    prompts: 20,
    promptsWithMentions: 12,
  }),
  platforms: [
    platform('chatgpt-web', [100, 50, 30, 3], [100, 50, 30, 3]),
    platform('gemini-web', [100, 50, 15, 18], [100, 50, 16, 10]),
    platform('claude', [40, 10, 5, 0]),
    platform('grok-web', [0, 0, 0, 0], [10, 5, 1, 1]),
  ],
  daily: [],
  competitors: [
    { competitorId: 'o', name: 'Otterly AI', mentions: 120, coMentions: 31, previousMentions: 0 },
    { competitorId: 'p', name: 'Profound', mentions: 260, coMentions: 41, previousMentions: 0 },
    { competitorId: 'e', name: 'Peec AI', mentions: 90, coMentions: 36, previousMentions: 0 },
  ],
};

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getMentionsOverview.mockReset();
  vi.useRealTimers();
});

describe('Headline', () => {
  it('writes the summary from the figures, and says what it is built from', () => {
    render(<Headline overview={overview} brand="GetCito" />);
    const [summary, basis] = container.querySelectorAll('p');
    expect(summary.textContent).toBe(
      'Net sentiment is +34 (↓ 6 vs the previous 30 days). Most of the drop is on ' +
        'Gemini (−18). AI usually names GetCito next to Profound and Peec AI.',
    );
    expect(basis.textContent).toBe(
      'Built from aggregates with a fixed template, no LLM call · Sep 18 – Oct 17 · ' +
        '400 tracked responses · 260 mentions',
    );
  });

  it('marks a net taken over fewer than 20 mentions as a low sample, with no change', () => {
    render(
      <Headline
        overview={{
          ...overview,
          current: totals({ answers: 2, mentions: 2, negative: 1 }),
          competitors: [],
        }}
        brand="GetCito"
      />,
    );
    expect(container.querySelector('p')?.textContent).toBe(
      'Net sentiment is −50 (low sample: 2 responses naming you).',
    );
  });

  it('says so when the brand was never named', () => {
    render(
      <Headline overview={{ ...overview, current: totals({ answers: 12 }) }} brand="GetCito" />,
    );
    expect(container.querySelector('p')?.textContent).toBe(
      "AI didn't name GetCito in the tracked responses of this period.",
    );
  });
});

describe('OverviewKpis', () => {
  it('shows each figure with its change and context', () => {
    render(<OverviewKpis overview={overview} brand="GetCito" />);
    const text = container.textContent;
    // Every time a response names the brand, as on Insights: 260 vs 200.
    expect(text).toContain('260+30%');
    expect(text).toContain('times responses named GetCito');
    expect(text).toContain('25.0%+5');
    expect(text).toContain('of 400 tracked responses');
    expect(text).toContain('15+25%');
    expect(text).toContain('of 20 tracked prompts');
    expect(text).toContain('+34−6');
    expect(text).toContain('n=100');
  });

  it('takes each change on the prompts both windows answered, as Insights does (00195)', () => {
    render(
      <OverviewKpis
        overview={{
          ...overview,
          // Over all prompts, 260 vs 200; on the 12 shared ones, 240 vs 160.
          same: {
            prompts: 12,
            newPrompts: 3,
            droppedPrompts: 1,
            current: totals({
              answers: 360,
              mentions: 90,
              occurrences: 240,
              positive: 45,
              negative: 9,
              promptsWithMentions: 12,
            }),
            previous: totals({
              answers: 360,
              mentions: 80,
              occurrences: 160,
              positive: 40,
              negative: 8,
              promptsWithMentions: 12,
            }),
          },
        }}
        brand="GetCito"
      />,
    );
    const text = container.textContent;
    // The values stay the whole window's; the changes are the shared prompts'.
    expect(text).toContain('260+50%');
    // Mention rate 90/360 vs 80/360: +2.8 points; prompts with mentions 12 vs 12.
    expect(text).toContain('25.0%+2.8');
    expect(text).toContain('15±0');
    // Net +34 shown; its change is (50 − 10) − (50 − 10) = 0.
    expect(text).toContain('+34±0');
  });

  // gkhngyk on #1230: the summary line also needs both shared windows to pass.
  it('shows no rate or net change when a shared window is a low sample', () => {
    render(
      <OverviewKpis
        overview={{
          ...overview,
          // The whole windows are large; the prompts both answered are few.
          same: {
            prompts: 2,
            newPrompts: 13,
            droppedPrompts: 10,
            current: totals({ answers: 18, mentions: 9, positive: 6, negative: 1 }),
            previous: totals({ answers: 30, mentions: 15, positive: 5, negative: 5 }),
          },
        }}
        brand="GetCito"
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('25.0%');
    expect(text).not.toMatch(/25\.0%[+−±]/);
    expect(text).toContain('+34');
    expect(text).not.toMatch(/\+34[+−±]/);
  });

  it('marks net sentiment over fewer than 20 mentions as a low sample, without a change', () => {
    render(
      <OverviewKpis
        overview={{
          ...overview,
          current: totals({ answers: 400, mentions: 12, positive: 6, negative: 1 }),
        }}
        brand="GetCito"
      />,
    );
    expect(container.textContent).toContain('Low sample · 12 responses');
    expect(container.textContent).toContain('+42');
    expect(container.textContent).not.toContain('+42−');
  });
});

describe('PlatformTable', () => {
  it('lists the platforms answering now, tints a negative one and notes the disagreement', () => {
    render(<PlatformTable rows={overview.platforms} />);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'ChatGPT',
      'Gemini (negative net sentiment)',
      'Claude',
    ]);
    expect(rows[1].className).toContain('bg-red-50');
    expect(rows[1].textContent).toContain('−6↓ 18');
    // Claude's 10 mentions are too few to judge: no colour, no change.
    expect(rows[2].textContent).toContain('+50Low sample');
    expect(container.textContent).toContain('Platforms disagree: ChatGPT is +54 but Gemini is −6.');
  });
});

describe('CompetitorTable', () => {
  it('puts you first, then competitors by mentions and how often they name you too', () => {
    render(<CompetitorTable overview={overview} brand="GetCito" />);
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent);
    // Responses naming each brand: occurrences aren't kept for competitors.
    expect(headers).toEqual(['Brand', 'Responses', 'Rate', 'Also names you']);
    const rows = [...container.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => td.textContent),
    );
    // The last column asks about competitors: empty for you, not "—".
    expect(rows[0]).toEqual(['GetCitoYou', '100', '25.0%', '']);
    // Each competitor's mentions that name you too, and their share.
    expect(rows.slice(1)).toEqual([
      ['Profound', '260', '65.0%', '41 · 16%'],
      ['Otterly AI', '120', '30.0%', '31 · 26%'],
      ['Peec AI', '90', '22.5%', '36 · 40%'],
    ]);
    // Sentiment is measured toward your brand alone, and shown in the KPI cards.
    expect(container.textContent).not.toMatch(/Sentiment|—/);
  });
});

describe('MentionsOverviewTab', () => {
  it('reads the overview once the filters settle and shows it', async () => {
    vi.useFakeTimers();
    getMentionsOverview.mockResolvedValue(overview);
    render(<MentionsOverviewTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />);
    expect(getMentionsOverview).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getMentionsOverview).toHaveBeenCalledTimes(1);
    expect(getMentionsOverview.mock.calls[0][0]).toBe('b1');
    expect(container.textContent).toContain('Net sentiment is +34');
  });

  it('says a read failed, and shows the skeleton again once a newer one is on its way', async () => {
    vi.useFakeTimers();
    getMentionsOverview.mockRejectedValueOnce(new Error('offline'));
    render(<MentionsOverviewTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toBe("Couldn't load the overview. Try again in a moment.");

    render(
      <MentionsOverviewTab
        brandId="b1"
        brand="GetCito"
        filters={{ ...DEFAULT_MENTIONS_FILTERS, range: '7d' }}
      />,
    );
    expect(container.textContent).toBe('');
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('asks for dates on a custom range without any', () => {
    render(
      <MentionsOverviewTab
        brandId="b1"
        brand="GetCito"
        filters={{ ...DEFAULT_MENTIONS_FILTERS, range: 'custom' }}
      />,
    );
    expect(container.textContent).toBe('Choose a start or end date to see the overview.');
    expect(getMentionsOverview).not.toHaveBeenCalled();
  });

  it('says when the period has no tracked responses, or the figures are unavailable', async () => {
    vi.useFakeTimers();
    getMentionsOverview.mockResolvedValueOnce({ ...overview, current: totals({}) });
    render(<MentionsOverviewTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toBe(
      'No tracked responses in this period. Try a longer range or clear the filters.',
    );

    getMentionsOverview.mockResolvedValueOnce(null);
    render(<MentionsOverviewTab brandId="b2" brand="Other" filters={DEFAULT_MENTIONS_FILTERS} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toContain("Mention figures aren't available yet.");
  });
});
