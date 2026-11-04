import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TrafficTrendPoint } from '@/lib/actions/traffic';
import type { GoogleTrendPoint } from '@/lib/trafficGoogleTrend';

/**
 * The trend's "vs Google clicks" view (AT-008, spec §3.3): the AI line
 * against Google clicks, the 24-hour range offering the last 7 days, and
 * §3.8b's partial note without Search Console.
 */

const getTrafficGoogleTrend = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/trafficReads', () => ({
  getTrafficGoogleTrend: (...args: unknown[]) => getTrafficGoogleTrend(...args),
}));

// The chart draws with recharts; the test reads the points it is given.
const drawn: { points: GoogleTrendPoint[]; googleUntil: string | null }[] = [];
vi.mock('./_charts', async (original) => ({
  ...(await original<typeof import('./_charts')>()),
  GoogleTrendChart: (props: { points: GoogleTrendPoint[]; googleUntil: string | null }) => {
    drawn.push(props);
    return <div data-testid="chart" />;
  },
}));

const { GoogleTrendView } = await import('./_GoogleTrend');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WEEK: TrafficTrendPoint[] = [
  { date: '2026-10-12', 'chatgpt.com': 2 },
  { date: '2026-10-13', 'chatgpt.com': 4 },
  { date: '2026-10-14', 'chatgpt.com': 3 },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  drawn.length = 0;
  getTrafficGoogleTrend.mockReset().mockResolvedValue({
    firstDay: '2026-07-20',
    lastDay: '2026-10-13',
    clicks: [
      { day: '2026-10-12', clicks: 400 },
      { day: '2026-10-13', clicks: 300 },
    ],
    markers: [{ day: '2026-10-13', actions: 1, prompts: 3 }],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  trend: TrafficTrendPoint[],
  gscConnected: boolean | null = true,
  onShowWeek = () => {},
  rangeStart?: string,
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <GoogleTrendView
          brandId="b1"
          trend={trend}
          rangeStart={rangeStart}
          gscConnected={gscConnected}
          onShowWeek={onShowWeek}
        />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => container.textContent ?? '';

describe('GoogleTrendView', () => {
  it('draws both lines over the trend days and says where Google stops', async () => {
    await render(WEEK);
    expect(getTrafficGoogleTrend).toHaveBeenCalledWith('b1', '2026-10-12', '2026-10-14');
    const { points, googleUntil } = drawn.at(-1)!;
    expect(points.map((p) => [p.ai, p.google])).toEqual([
      [100, 100],
      [200, 75],
      [150, null],
    ]);
    expect(points[1]).toMatchObject({ actions: 1, prompts: 3 });
    expect(googleUntil).toBe('2026-10-13');
    expect(text()).toContain('Google clicks until Oct 13: Google reports about two days late.');
    expect(text()).toContain("can't be separated");
    expect(text()).toContain('Dashed amber lines mark the days');
  });

  it('keeps the AI line and says what the Google line needs without Search Console', async () => {
    await render(WEEK, false);
    const { points } = drawn.at(-1)!;
    expect(points.map((p) => p.ai)).toEqual([100, 200, 150]);
    expect(points.every((p) => p.google === null)).toBe(true);
    expect(text()).toContain('The Google clicks line needs Google Search Console.');
    expect(text()).not.toContain('Google clicks until');
  });

  it('says so when Google has no clicks for the range, or they failed to load', async () => {
    getTrafficGoogleTrend.mockResolvedValue({
      firstDay: null,
      lastDay: null,
      clicks: [],
      markers: [],
    });
    await render(WEEK);
    expect(text()).toContain('No Google clicks for this range in Google Search Console.');
    expect(text()).not.toContain('Dashed amber lines');

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    getTrafficGoogleTrend.mockRejectedValue(new Error('boom'));
    await render([...WEEK, { date: '2026-10-15', 'chatgpt.com': 1 }]);
    expect(text()).toContain("Google clicks couldn't be loaded.");
    expect(drawn.at(-1)!.points.map((p) => p.ai)).toEqual([100, 200, 150, 50]);
    quiet.mockRestore();
  });

  it('starts on the first whole day, and waits for the source states', async () => {
    await render(WEEK, null, () => {}, '2026-10-12T09:00:00.000Z');
    expect(getTrafficGoogleTrend).toHaveBeenCalledWith('b1', '2026-10-13', '2026-10-14');
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(text()).toBe('');

    await render(WEEK, true, () => {}, '2026-10-12T09:00:00.000Z');
    expect(drawn.at(-1)!.points.map((p) => [p.date, p.ai, p.google])).toEqual([
      ['2026-10-13', 100, 100],
      ['2026-10-14', 75, null],
    ]);
  });

  it('offers the last 7 days on the 24-hour range instead of a window of its own', async () => {
    const onShowWeek = vi.fn();
    await render([{ date: '2026-10-17T13:00:00.000Z', 'chatgpt.com': 1 }], true, onShowWeek);
    expect(getTrafficGoogleTrend).not.toHaveBeenCalled();
    expect(text()).toContain('Pick 7 days or longer');
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Show last 7 days',
    );
    act(() => button!.click());
    expect(onShowWeek).toHaveBeenCalled();
  });
});
