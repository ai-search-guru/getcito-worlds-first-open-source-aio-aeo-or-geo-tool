import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type {
  AuditAutoStatus,
  AuditOverview,
  AuditQuota,
  SiteCoverage,
} from '@/lib/actions/audits';
import { AuditOverviewCards } from './_OverviewCards';

// The report's helpers come with its Settings link (00449).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const overview = (over: Partial<AuditOverview> = {}): AuditOverview => ({
  primaryHost: 'acme.com',
  pages: 48,
  otherPages: 0,
  siteScore: 0.68,
  siteScoreChange: 4,
  authority: 0.38,
  eeat: 0.36,
  lowestCategory: { key: 'eeat', score: 0.36 },
  gaps: [
    { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 31 },
    { key: 'press-mentions', label: 'Press mentions', category: 'eeat', pages: 22 },
    { key: 'case-study-evidence', label: 'Case study evidence', category: 'eeat', pages: 9 },
  ],
  ...over,
});

const growth: AuditQuota = { used: 245, running: 5, limit: 500, remaining: 250 };

/** Growth with auto-audit: four runs done (100 audits), day 28's 25 still to come. */
const auto = (over: Partial<AuditAutoStatus> = {}): AuditAutoStatus => ({
  enabled: true,
  setting: null,
  emailAfterRun: false,
  perRun: 25,
  reserved: 25,
  used: 100,
  running: 0,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  runs: [1, 7, 14, 21, 28].map((day) => ({
    day,
    at: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    done: day < 28,
  })),
  nextRun: { day: 28, at: '2026-10-28T00:00:00.000Z' },
  ...over,
});
const growthAuto: AuditQuota = {
  used: 250,
  running: 0,
  limit: 500,
  remaining: 225,
  auto: auto(),
};
const onOpenSettings = vi.fn();
/** The day before day 28's run. */
const NOW = new Date('2026-10-27T12:00:00Z');

let container: HTMLDivElement;
let root: Root;

function render(data: AuditOverview | null, quota: AuditQuota | null = growth, now = NOW) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditOverviewCards
          overview={data}
          quota={quota}
          now={now}
          onOpenSettings={onOpenSettings}
        />
      </NextIntlClientProvider>,
    );
  });
}

/** Each card's label, value, change and sub-line, as text. */
const cards = () =>
  [...container.querySelectorAll('[data-slot=card]')].map((card) => card.textContent ?? '');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Pages audited, once the site’s pages are read (customer priorities item 11)', () => {
  const renderCoverage = (coverage: SiteCoverage | null, onShowNotAudited = vi.fn()) => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AuditOverviewCards
            overview={overview({ pages: 20 })}
            quota={growth}
            now={NOW}
            coverage={coverage}
            staleDays={90}
            onShowNotAudited={onShowNotAudited}
          />
        </NextIntlClientProvider>,
      );
    });
    return onShowNotAudited;
  };

  it('says how many of the site’s pages have a current audit, and opens the rest', () => {
    const open = renderCoverage({ pages: 36, audited: 18, never: 15, stale: 3 });
    const pages = cards()[1];
    expect(pages).toContain('18of 36 site pages');
    expect(pages).toContain('15 never audited · 3 not in 90 days');
    const see = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'See the 18 not audited →',
    )!;
    act(() => see.click());
    expect(open).toHaveBeenCalled();
  });

  it('offers nothing to open once every page is audited, and reads as before without site pages', () => {
    renderCoverage({ pages: 12, audited: 12, never: 0, stale: 0 });
    expect(cards()[1]).toContain('12of 12 site pages');
    expect(container.textContent).not.toContain('not audited →');
    renderCoverage({ pages: 0, audited: 0, never: 0, stale: 0 });
    expect(cards()[1]).toContain('20');
    expect(cards()[1]).toContain('on acme.com');
    renderCoverage(null);
    expect(cards()[1]).toContain('on acme.com');
  });
});

describe('AuditOverviewCards', () => {
  it('shows the four cards of the mockup', () => {
    render(overview());
    const [site, pages, authority, audits] = cards();

    expect(site).toContain('Site score');
    expect(site).toContain('68+4');
    expect(site).toContain('average of latest audits');

    expect(pages).toContain('Pages audited');
    expect(pages).toContain('48');
    expect(pages).toContain('on acme.com');

    expect(authority).toContain('Authority · E-E-A-T');
    expect(authority).toContain('38 · 36');
    expect(authority).toContain('Top gaps');
    const gaps = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(gaps).toEqual([
      'Author byline31 of 48',
      'Press mentions22 of 48',
      'Case study evidence9 of 48',
    ]);

    expect(audits).toContain('Audits this month');
    expect(audits).toContain('250of 500 left');
    // Running audits count as used; without auto-audit, all of it is the user's.
    expect(container.querySelector('[role=img][aria-label]')?.getAttribute('aria-label')).toBe(
      'Auto used 0 · Auto scheduled 0 · You used 250 · Free 250',
    );
    expect(audits).toContain('Auto-audit off · How it works');
  });

  it('says "No active plan" for 0 of 0 without one, with no count, bar or runs', () => {
    render(overview(), {
      used: 245,
      running: 0,
      limit: 0,
      remaining: 0,
      noPlan: true,
      auto: auto({ enabled: false, reserved: 0 }),
    });
    const audits = cards()[3];
    expect(audits).toContain('Audits this month');
    expect(audits).toContain('—');
    expect(audits).toContain('No active plan');
    expect(audits).not.toContain('of 0 left');
    expect(audits).not.toContain('How it works');
    expect(container.querySelector('[role=img][aria-label]')).toBeNull();
    expect(container.querySelector('.text-destructive')).toBeNull();
  });

  it('counts the pages on other sites apart, and says when there are no gaps or pages', () => {
    render(overview({ otherPages: 3, gaps: [] }));
    expect(cards()[1]).toContain('+ 3 on other sites');
    expect(cards()[2]).toContain('No Authority or E-E-A-T gaps');

    render(
      overview({
        primaryHost: null,
        pages: 0,
        siteScore: null,
        siteScoreChange: null,
        authority: null,
        eeat: null,
        gaps: [],
      }),
    );
    expect(cards()[0]).toContain('—');
    expect(cards()[1]).toContain('on your domain');
    expect(cards()[2]).toContain('— · —');
    expect(cards()[2]).toContain('No pages audited yet');
  });

  it("splits the month as the mockup: auto used, scheduled, the user's and free (SA-019)", () => {
    render(overview(), growthAuto);
    const audits = cards()[3];
    // What's left counts the runs' scheduled share.
    expect(audits).toContain('250of 500 left');
    const bar = container.querySelector('[role=img][aria-label]')!;
    expect(bar.getAttribute('aria-label')).toBe(
      'Auto used 100 · Auto scheduled 25 · You used 150 · Free 225',
    );
    expect([...bar.children].map((seg) => (seg as HTMLElement).style.width)).toEqual([
      '20%',
      '5%',
      '30%',
    ]);
    expect(audits).toContain('Auto 25% · How it works');

    // The five runs by date: done, done, done, done, next.
    const runs = [...container.querySelectorAll('ol[aria-label] li')];
    expect(runs.map((li) => li.textContent)).toEqual([
      'Oct 1done',
      'Oct 7done',
      'Oct 14done',
      'Oct 21done',
      'Oct 28next run',
    ]);
    expect(runs[4].className).toContain('font-semibold');
    expect(runs[4].getAttribute('title')).toBe('Day 28 of your billing month · Oct 28');
  });

  it('marks a run whose turn passed without running as skipped, not upcoming', () => {
    // Auto-audit came out on day 25: only day 28 ran.
    const late = auto({
      runs: [1, 7, 14, 21, 28].map((day) => ({
        day,
        at: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
        done: day === 28,
      })),
      nextRun: null,
    });
    // Seen on day 28, after the run.
    render(overview(), { ...growthAuto, auto: late }, new Date('2026-10-28T12:00:00Z'));
    expect(
      [...container.querySelectorAll('ol[aria-label] li .sr-only')].map((s) => s.textContent),
    ).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'done']);
  });

  it("counts a run's running audits as auto, not the user's", () => {
    render(overview(), {
      ...growthAuto,
      used: 240,
      running: 10,
      auto: auto({ used: 90, running: 10 }),
    });
    expect(container.querySelector('[role=img][aria-label]')?.getAttribute('aria-label')).toBe(
      'Auto used 100 · Auto scheduled 25 · You used 150 · Free 225',
    );
  });

  it('opens How it works under the cards, with Settings opening the settings', () => {
    render(overview(), growthAuto);
    expect(container.querySelector('#audit-how-it-works')).toBeNull();
    const toggle = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'How it works',
    )!;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const points = [...container.querySelectorAll('#audit-how-it-works li')].map(
      (li) => li.textContent,
    );
    expect(points).toEqual([
      'Your plan includes 500 audits a month.',
      '25% runs automatically: 5% on days 1, 7, 14, 21 and 28 of your billing month, on the top-priority pages.',
      'The other 75% is yours: a single URL, or in bulk from Opportunities.',
      'Turn auto-audit off in Settings to keep all 500.',
    ]);
    const settings = [...container.querySelectorAll('#audit-how-it-works button')][0];
    act(() => (settings as HTMLElement).click());
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("says all of it is the user's when auto-audit is off, without the runs", () => {
    render(overview(), { ...growth, auto: auto({ enabled: false, reserved: 0, used: 0 }) });
    expect(container.querySelector('ol[aria-label]')).toBeNull();
    act(() =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent === 'How it works')!
        .click(),
    );
    expect(container.querySelector('#audit-how-it-works')?.textContent).toContain(
      'Auto-audit is off, so all 500 are yours',
    );
  });

  it('shows an unlimited plan without a bar, and its runs when auto-audit is on', () => {
    render(overview(), { used: 0, running: 0, limit: -1, remaining: -1 });
    expect(cards()[3]).toContain('Unlimited');
    expect(cards()[3]).toContain('no monthly limit');
    expect(cards()[3]).not.toContain('left');
    expect(container.querySelector('ol[aria-label]')).toBeNull();

    render(overview(), {
      used: 0,
      running: 0,
      limit: -1,
      remaining: -1,
      auto: auto({ reserved: 0 }),
    });
    expect(container.querySelector('[role=img][aria-label]')).toBeNull();
    expect(container.querySelectorAll('ol[aria-label] li')).toHaveLength(5);
    expect(cards()[3]).toContain('Auto · 25 pages a run');
  });

  it('holds the cards with placeholders while loading', () => {
    render(null);
    expect(container.querySelectorAll('[data-slot=card]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(0);
    expect(container.textContent).toBe('');
  });
});
