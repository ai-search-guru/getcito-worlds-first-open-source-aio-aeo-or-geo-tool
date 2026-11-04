import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { CompetitorTimeline } from '@/lib/competitorTimeline';

/** A competitor's pages over time (learning C3), on the Competitors page. */

// The chart draws in a browser; here it says what it was given.
vi.mock('next/dynamic', () => ({
  default: () =>
    function Chart({ marks }: { marks: { week: string }[] }) {
      return <div data-testid="chart" data-marks={marks.map((m) => m.week).join(',')} />;
    },
}));

const { CompetitorTimelineCard } = await import('./_TimelineCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(timeline: CompetitorTimeline | null | 'failed') {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CompetitorTimelineCard timeline={timeline} brandName="Acme" competitorName="Rival" />
      </NextIntlClientProvider>,
    ),
  );
  return container.textContent ?? '';
}

const weeks = [
  { week: '2026-10-19', brand: 4, competitor: 2 },
  { week: '2026-10-26', brand: 5, competitor: 9 },
];
const changed = {
  kind: 'changed' as const,
  at: '2026-10-28T03:00:00Z',
  url: 'https://www.rival.com/kettles/',
  domain: 'rival.com',
  answers: null,
  gained: [
    { key: 'faq-schema', label: 'FAQ schema' },
    { key: 'tables', label: 'Tables' },
  ],
  lost: [{ key: 'author-byline', label: 'Author byline' }],
};
const firstCited = {
  kind: 'first_cited' as const,
  at: '2026-10-20T00:00:00Z',
  url: 'https://rival.com/guide',
  domain: 'rival.com',
  answers: 3,
  gained: [],
  lost: [],
};

describe('CompetitorTimelineCard', () => {
  it("shows the weeks' mentions and what happened to the competitor's pages, newest first", () => {
    const text = render({ weeks, events: [changed, firstCited] });
    expect(text).toContain("Rival's pages over time");
    expect(text).toContain('Answers mentioning Rival and Acme each week');
    expect(container.querySelector('[data-testid="chart"]')?.getAttribute('data-marks')).toBe(
      '2026-10-19,2026-10-26',
    );
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'Oct 28, 2026Changed rival.com/kettlesnow has FAQ schema, Tables · no longer has Author byline',
      'Oct 20, 2026First cited in your tracked answers rival.com/guide3 answers had cited it when GetCito found it',
    ]);
    expect(container.querySelector('a[href="https://www.rival.com/kettles/"]')).not.toBeNull();
  });

  it('says a page whose checks stayed the same changed in its words', () => {
    render({ weeks, events: [{ ...changed, gained: [], lost: [] }] });
    expect(container.querySelector('li')?.textContent).toContain('its words changed');
  });

  it('lists eight events, then all on asking', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      ...firstCited,
      url: `https://rival.com/p${i}`,
    }));
    render({ weeks, events });
    expect(container.querySelectorAll('li')).toHaveLength(8);
    const all = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Show all 10'),
    )!;
    act(() => all.click());
    expect(container.querySelectorAll('li')).toHaveLength(10);
  });

  it('says what it reads before anything happened, and when it could not be read', () => {
    expect(render({ weeks, events: [] })).toContain(
      "Nothing yet: GetCito reads Rival's pages cited in your answers each night",
    );
    expect(render('failed')).toContain("Couldn't load the timeline.");
    render(null);
    expect(container.querySelector('[data-testid="chart"]')).toBeNull();
  });
});
