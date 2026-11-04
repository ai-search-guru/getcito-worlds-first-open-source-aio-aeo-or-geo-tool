import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { SourceState } from '@/lib/actions/integrations';
import type { TrafficConversions, TrafficDateWindow } from '@/lib/actions/traffic';

/**
 * Where AI visitors convert (AT-014, spec §3.4b): its two cards for the
 * page's range, ranked by key events or revenue, with Low sample below 30 AI
 * visits; the last 30 days when the range is too thin, said in the header;
 * and Google Analytics' own state in full until it has data (§3.8b).
 */

const getTrafficConversions = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/trafficReads', () => ({
  getTrafficConversions: (...args: unknown[]) => getTrafficConversions(...args),
}));
vi.mock('@/hooks/useIntegrationConnect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { ConversionsSection } = await import('./_conversions');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';
const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };

const ga = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-09-01T06:00:00.000Z',
  lastDataAt: '2026-10-18T06:00:00.000Z',
  property: '123456789',
  ...over,
});

const conversions = (over: Partial<TrafficConversions> = {}): TrafficConversions => ({
  aiVisits: 64,
  hasRevenue: false,
  widened: false,
  pageCount: 2,
  answerCount: 1,
  pages: [
    {
      page: '/gifts',
      aiVisits: 50,
      keyEvents: 5,
      keyEventSessions: 4,
      transactions: 1,
      revenue: 120.5,
      bestPlatform: 'chatgpt.com',
    },
    {
      page: '/pricing',
      aiVisits: 5,
      keyEvents: 2,
      keyEventSessions: 2,
      transactions: 0,
      revenue: 0,
      bestPlatform: 'gemini.google.com',
    },
  ],
  answers: [
    {
      platform: 'perplexity.ai',
      topicId: 't1',
      topic: 'Coffee gifts',
      pages: 2,
      aiVisits: 40,
      keyEvents: 4,
      keyEventSessions: 3,
      revenue: 0,
    },
  ],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getTrafficConversions.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(source: SourceState | null = ga()) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ConversionsSection
          brandId={BRAND}
          dateWindow={WEEK}
          rangeLabel="Last 7 days"
          source={source}
          domain="acme-coffee.example.com"
          canConnect
          onConnected={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => container.textContent ?? '';
const rows = (card: number) =>
  [...container.querySelectorAll('table')[card].querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  );

describe('ConversionsSection', () => {
  it('ranks converting pages and platform × topic for the page range', async () => {
    getTrafficConversions.mockResolvedValue(conversions());
    await render();

    expect(getTrafficConversions).toHaveBeenCalledWith(BRAND, WEEK);
    expect(text()).toContain('Where AI visitors convert');
    expect(text()).toContain('Needs Google Analytics');
    expect(text()).toContain('Ranked by key events from AI visits');
    expect(text()).toContain('Last 7 days');
    expect(rows(0)).toEqual([
      ['/gifts', '50', '5', '8%', 'ChatGPT'],
      ['/pricing', '5', '2', 'Low sample', 'Gemini'],
    ]);
    expect(rows(1)).toEqual([['Perplexity', 'Coffee gifts', '4', '7.5%']]);
  });

  it('adds revenue and ranks by it when the property reports purchases', async () => {
    getTrafficConversions.mockResolvedValue(conversions({ hasRevenue: true }));
    await render();
    expect(text()).toContain('Ranked by revenue from AI visits');
    expect(rows(0)[0]).toEqual(['/gifts', '50', '5', '121', '8%', 'ChatGPT']);
  });

  it('says when a thin range read the last 30 days instead', async () => {
    getTrafficConversions.mockResolvedValue(conversions({ widened: true }));
    await render();
    expect(text()).toContain(
      'Ranked by key events from AI visits · fewer than 30 AI visits in the selected range, so this uses the last 30 days',
    );
    expect(text()).toContain('Last 30 days');
    expect(text()).not.toContain('Last 7 days');
  });

  it('says when there are no conversions', async () => {
    getTrafficConversions.mockResolvedValue(conversions({ pages: [], answers: [] }));
    await render();
    expect(text()).toContain('No key events from AI visitors in this range.');
    expect(container.querySelector('table')).toBeNull();
  });

  it("says when they couldn't be read", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getTrafficConversions.mockRejectedValue(new Error('boom'));
    await render();
    expect(text()).toContain("Couldn't load where AI visitors convert.");
  });

  it("shows Google Analytics' state in full instead of the cards until it has data", async () => {
    await render(ga({ connected: false, mapped: false }));
    expect(getTrafficConversions).not.toHaveBeenCalled();
    expect(text()).toContain('Connect Google Analytics');
    expect(text()).toContain('where AI visitors convert');
    expect(container.querySelector('table')).toBeNull();
  });
});
