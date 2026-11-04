import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { TrafficDateWindow, TrafficUntrackedQueries } from '@/lib/actions/traffic';

/**
 * Google queries you don't track yet (AT-009, spec §3.6): the top Search
 * Console queries by clicks that no tracked prompt covers, Track for one and
 * Track all within the plan's prompt slots (PROMPT-012).
 */

const getUntrackedGoogleQueries = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/trafficReads', () => ({
  getUntrackedGoogleQueries: (...args: unknown[]) => getUntrackedGoogleQueries(...args),
}));
const getLocationQuota = vi.fn();
vi.mock('@/lib/actions/prompt', () => ({
  getLocationQuota: (...args: unknown[]) => getLocationQuota(...args),
}));
const trackPagePrompts = vi.fn();
vi.mock('@/lib/actions/promptSuggestions', () => ({
  trackPagePrompts: (...args: unknown[]) => trackPagePrompts(...args),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// Adding a topic is for admins and managers.
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { UntrackedQueriesCard } = await import('./_UntrackedQueries');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WEEK: TrafficDateWindow = { dateFrom: '2026-10-12T09:00:00.000Z' };

const queries = (over: Partial<TrafficUntrackedQueries> = {}): TrafficUntrackedQueries => ({
  lastDay: '2026-10-17',
  since: '2026-10-11',
  until: '2026-10-17',
  count: 3,
  capped: false,
  rows: [
    { query: 'cold brew ratio', clicks: 25, impressions: 610 },
    { query: 'how to descale an espresso machine', clicks: 9, impressions: 400 },
    { query: 'oat milk latte', clicks: 4, impressions: 120 },
  ],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getUntrackedGoogleQueries.mockReset().mockResolvedValue(queries());
  getLocationQuota.mockReset().mockResolvedValue({ maxPrompts: 50, used: 40 });
  trackPagePrompts.mockReset().mockResolvedValue({ promptIds: ['n1'] });
  toast.success.mockReset();
  toast.error.mockReset();
  onTracked.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const onTracked = vi.fn();
const openUpgrade = vi.fn();

async function render(canTrack = true, isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <UntrackedQueriesCard
            brandId="b1"
            dateWindow={WEEK}
            canTrack={canTrack}
            onTracked={onTracked}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('UntrackedQueriesCard', () => {
  it('lists the queries by clicks with the days read and the slots left', async () => {
    await render();
    expect(getUntrackedGoogleQueries).toHaveBeenCalledWith('b1', WEEK);
    expect(getLocationQuota).toHaveBeenCalledWith('b1');
    const rows = [...container.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['cold brew ratio', '25', '610', 'Track'],
      ['how to descale an espresso machine', '9', '400', 'Track'],
      ['oat milk latte', '4', '120', 'Track'],
    ]);
    expect(text()).toContain('Oct 11 – Oct 17');
    expect(text()).toContain('3 of 3 queries');
    expect(text()).toContain('10 prompt slots left on your plan.');
  });

  it('tracks one query as a prompt, then reads the list again', async () => {
    await render();
    await act(async () => button('Track')!.click());
    expect(trackPagePrompts).toHaveBeenCalledWith('b1', null, [
      { text: 'cold brew ratio', topic: '' },
    ]);
    expect(toast.success).toHaveBeenCalledWith('Tracking 1 query as a prompt');
    expect(getUntrackedGoogleQueries).toHaveBeenCalledTimes(2);
    expect(onTracked).toHaveBeenCalledTimes(1);
  });

  it('asks for a topic first on a brand without one, with a way to the Topics tab', async () => {
    trackPagePrompts.mockResolvedValue({
      promptIds: [],
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await render();
    await act(async () => button('Track')!.click());
    expect(document.body.textContent).toContain('Add a topic first');
    const link = [...document.body.querySelectorAll('a')].find(
      (a) => a.textContent === 'Add a topic',
    );
    expect(link?.getAttribute('href')).toBe('/dashboard/prompts/topics?new=1');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onTracked).not.toHaveBeenCalled();
  });

  it('tracks nothing on a read-only workspace: Track opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    await render(true, true);
    await act(async () => button('Track')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Tracking prompts needs a plan');
    expect(trackPagePrompts).not.toHaveBeenCalled();
  });

  it('tracks as many as the slots allow, and says when the plan ran out', async () => {
    getLocationQuota.mockResolvedValue({ maxPrompts: 50, used: 48 });
    trackPagePrompts.mockResolvedValue({ promptIds: ['n1'], error: 'limit', code: 'plan_limit' });
    await render();
    const all = button('Track all (2)');
    expect(all).toBeTruthy();
    await act(async () => all!.click());
    expect(trackPagePrompts).toHaveBeenCalledWith('b1', null, [
      { text: 'cold brew ratio', topic: '' },
      { text: 'how to descale an espresso machine', topic: '' },
    ]);
    expect(toast.error).toHaveBeenCalledWith(
      "1 query needs another prompt slot: your plan's are used up.",
    );
  });

  it('turns tracking off without slots or for members', async () => {
    getLocationQuota.mockResolvedValue({ maxPrompts: 50, used: 50 });
    await render();
    expect(button('Track')!.disabled).toBe(true);
    expect(button('Track all (0)')!.disabled).toBe(true);
    expect(button('Track')!.parentElement!.getAttribute('title')).toBe(
      'No prompt slots left on your plan',
    );

    getLocationQuota.mockResolvedValue({ maxPrompts: -1, used: 3 });
    act(() => root.unmount());
    root = createRoot(container);
    await render(false);
    expect(button('Track')!.disabled).toBe(true);
    expect(button('Track all (3)')!.parentElement!.getAttribute('title')).toBe(
      'Only admins and managers can add prompts.',
    );
    expect(text()).not.toContain('slots left');
  });

  it('says why there are no rows, and a floor past the scan', async () => {
    getUntrackedGoogleQueries.mockResolvedValue(queries({ count: 7000, capped: true }));
    await render();
    expect(text()).toContain('3 of 7,000+ queries');

    const empties: [Partial<TrafficUntrackedQueries>, string][] = [
      [{ rows: [], count: 0 }, 'Every Google query with clicks in this range is tracked.'],
      [{ lastDay: null, rows: [] }, 'Google Search Console has no queries for this brand yet.'],
    ];
    for (const [over, says] of empties) {
      getUntrackedGoogleQueries.mockResolvedValue(queries(over));
      act(() => root.unmount());
      root = createRoot(container);
      await render();
      expect(text()).toContain(says);
    }

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUntrackedGoogleQueries.mockRejectedValue(new Error('boom'));
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(text()).toContain("Couldn't load these queries.");
    quiet.mockRestore();
  });
});
