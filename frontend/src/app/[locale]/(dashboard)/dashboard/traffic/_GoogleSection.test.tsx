import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { SourceState } from '@/lib/actions/integrations';
import type { TrafficDateWindow, TrafficGooglePages } from '@/lib/actions/traffic';

/**
 * The Google Search Console section (AT-008 part B, spec §3.6): pages whose
 * impressions rose while their CTR fell, over the days Google has reported,
 * each with its next step; and Search Console's own state in full until it
 * has data (§3.8b).
 */

const getTrafficGooglePages = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/trafficReads', () => ({
  getTrafficGooglePages: (...args: unknown[]) => getTrafficGooglePages(...args),
}));
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
// The Add prompts dialog has its own tests; this one reads which page it opens for.
const dialogPages: (string | null)[] = [];
vi.mock('./_PagePromptsDialog', () => ({
  PagePromptsDialog: ({ page }: { page: string | null }) => {
    dialogPages.push(page);
    return null;
  },
}));

// The untracked queries card has its own tests.
vi.mock('./_UntrackedQueries', () => ({ UntrackedQueriesCard: () => null }));
// The viewer: a manager unless a test says otherwise.
const viewer = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ canManage: viewer.canManage }),
}));

const { GoogleSection } = await import('./_GoogleSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WEEK: TrafficDateWindow = { dateFrom: '2026-10-12T09:00:00.000Z' };

const gsc = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-09-01T06:00:00.000Z',
  lastDataAt: '2026-10-18T06:00:00.000Z',
  property: 'sc-domain:acme.example',
  ...over,
});

const pages = (over: Partial<TrafficGooglePages> = {}): TrafficGooglePages => ({
  lastDay: '2026-10-17',
  since: '2026-10-11',
  until: '2026-10-17',
  prevSince: '2026-10-04',
  prevUntil: '2026-10-10',
  incomplete: false,
  count: 2,
  rows: [
    {
      page: '/blog/how-to-track-ai-overviews',
      url: 'https://acme.example/blog/how-to-track-ai-overviews',
      impressions: 1420,
      prevImpressions: 1000,
      clicks: 14,
      prevClicks: 31,
      promptId: 'p1',
    },
    {
      page: '/faq',
      url: 'https://acme.example/faq',
      impressions: 300,
      prevImpressions: 200,
      clicks: 2,
      prevClicks: 8,
      promptId: null,
    },
  ],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  viewer.canManage = true;
  dialogPages.length = 0;
  getTrafficGooglePages.mockReset().mockResolvedValue(pages());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(source: SourceState | null = gsc()) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <GoogleSection
          brandId="b1"
          dateWindow={WEEK}
          rangeLabel="last 7 days"
          source={source}
          domain="acme.example"
          canConnect
          onConnected={() => {}}
          canTrack
        />
      </NextIntlClientProvider>,
    );
  });
}

/** A fresh section: it reads its pages again. */
async function remount() {
  act(() => root.unmount());
  root = createRoot(container);
  await render();
}

const text = () => container.textContent ?? '';

describe('GoogleSection', () => {
  it('lists the pages with their rise, their CTR and the days compared', async () => {
    await render();
    expect(getTrafficGooglePages).toHaveBeenCalledWith('b1', WEEK);
    expect(text()).toContain('Google Search Console');
    expect(text()).toContain('Needs Google Search Console');
    expect(text()).toContain('data until Oct 17 (Google reports about two days late)');
    expect(text()).toContain('Oct 11 – Oct 17 vs Oct 4 – Oct 10');
    const rows = [...container.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['/blog/how-to-track-ai-overviews', '+42%', '3.1% → 1%', 'Positions'],
      ['/faq', '+50%', '4% → 0.7%', 'Add prompts'],
    ]);
    expect(text()).toContain('at least 100 impressions before');
    expect(text()).not.toContain('of 2 pages');
  });

  it("opens a page's prompt in Positions, or Add prompts for the page", async () => {
    await render();
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/dashboard/prompts?positions=p1');

    const add = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add prompts',
    );
    await act(async () => add!.click());
    expect(dialogPages.at(-1)).toBe('/faq');
  });

  it('says who adds prompts for a page, instead of Add prompts, to an analyst', async () => {
    viewer.canManage = false;
    await render();
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Add prompts',
    );
    expect(text()).toContain('Ask an admin or a manager to add prompts.');
  });

  it('says how many more pages the export has', async () => {
    getTrafficGooglePages.mockResolvedValue(pages({ count: 14 }));
    await render();
    expect(text()).toContain('2 of 14 pages · the export has them all');
  });

  it('says why there are no rows', async () => {
    getTrafficGooglePages.mockResolvedValue(pages({ rows: [], count: 0 }));
    await render();
    expect(text()).toContain("No page's impressions rose while its CTR fell this way.");

    getTrafficGooglePages.mockResolvedValue(pages({ lastDay: null, since: null, rows: [] }));
    await remount();
    expect(text()).toContain('arrives with the next daily sync');

    getTrafficGooglePages.mockResolvedValue(pages({ since: null, until: null, rows: [] }));
    await remount();
    expect(text()).toContain('All time has no period before it');

    getTrafficGooglePages.mockResolvedValue(pages({ incomplete: true, count: 0, rows: [] }));
    await remount();
    expect(text()).toContain("page history doesn't reach back to the period before this range");
  });

  it("shows Search Console's state in full until it has data (§3.8b)", async () => {
    await render(
      gsc({ connected: false, mapped: false, firstDataAt: null, lastDataAt: null, property: null }),
    );
    expect(getTrafficGooglePages).not.toHaveBeenCalled();
    expect(text()).toContain('Connect Google Search Console to see this');
    expect(text()).toContain('which pages AI may be taking Google clicks from');
  });
});
