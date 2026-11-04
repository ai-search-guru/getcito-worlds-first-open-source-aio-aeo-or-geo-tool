import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditOpportunity, ExcludedPage } from '@/lib/actions/audits';
import {
  OPPORTUNITIES_STEP,
  OpportunitiesTable,
  opportunityAuditUrls,
} from './_OpportunitiesTable';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const opportunity = (over: Partial<AuditOpportunity> = {}): AuditOpportunity => ({
  key: 'acme.com/pricing',
  url: 'https://acme.com/pricing',
  path: '/pricing',
  title: 'Pricing',
  reasons: [
    {
      type: 'no_ai_traffic',
      signal: 'revenue',
      percentile: 95.4,
      citationState: 'targeted_not_cited',
    },
  ],
  pinned: false,
  running: false,
  aiVisits: 0,
  lastAudit: { at: '2026-10-14T12:00:00.000Z', score: 0.63, auditId: 'a1' },
  priority: 88,
  priorityParts: { value: 0.96, opportunity: 0.9, ease: 0.8 },
  ...over,
});

const blog = opportunity({
  key: 'acme.com/blog',
  url: 'https://acme.com/blog',
  path: '/blog',
  reasons: [{ type: 'never_audited' }],
  pinned: true,
  aiVisits: 12,
  lastAudit: null,
  priority: 41,
  priorityParts: { value: 0.3, opportunity: 0.4, ease: 0.8 },
});

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onRestore = vi.fn();

function render(
  opportunities: AuditOpportunity[],
  {
    excluded = [] as ExcludedPage[],
    selected = new Set<string>(),
    toolbar = null as React.ReactNode,
    // null: no onRestore, as for a member who can't change them.
    restore = onRestore as ((urls: string[]) => void) | null,
  } = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OpportunitiesTable
          opportunities={opportunities}
          excluded={excluded}
          staleDays={90}
          selected={selected}
          onSelect={onSelect}
          onRestore={restore ?? undefined}
          toolbar={toolbar}
        />
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('tbody > tr')];
const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent?.trim());
const box = (label: string) =>
  container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('OpportunitiesTable', () => {
  it('shows each page with why, its AI visits and its last audit', () => {
    render([
      blog,
      opportunity(),
      opportunity({
        key: 'k3',
        path: '/compare',
        aiVisits: null,
        reasons: [{ type: 'stale_audit', days: 120 }],
      }),
    ]);

    expect(rows().map(cells)).toEqual([
      ['', '41', '/blog', 'PinnedNever audited', '12', 'never'],
      [
        '',
        '88',
        '/pricing',
        'No AI trafficTop 5% by revenueTargeted, not cited',
        '0',
        'Oct 14 · 63',
      ],
      ['', '88', '/compare', 'Audited 120 days ago', '—', 'Oct 14 · 63'],
    ]);
    // The page opens the live page; the last audit its report.
    const [pageLink] = rows()[1].querySelectorAll('a');
    expect(pageLink.getAttribute('href')).toBe('https://acme.com/pricing');
    expect(pageLink.getAttribute('target')).toBe('_blank');
    expect(rows()[1].querySelectorAll('a')[1].getAttribute('href')).toBe('/dashboard/audit/a1');
  });

  it('names the competitor cited on the prompts closest to a page', () => {
    render([
      opportunity({
        reasons: [
          { type: 'competitor_cited', prompts: 3, competitors: ['Crema Club', 'Northline'] },
        ],
      }),
      opportunity({
        key: 'k2',
        path: '/gifts',
        reasons: [{ type: 'competitor_cited', prompts: 1, competitors: ['Crema Club'] }],
      }),
    ]);
    expect(rows().map((r) => cells(r)[3])).toEqual([
      'Crema Club +1 cited on 3 prompts',
      'Crema Club cited on 1 prompt',
    ]);
  });

  it("shows a template's row: its pages, the gaps they share and how many are audited (SA-007)", () => {
    const template = opportunity({
      key: 'template:/blog/*',
      url: null,
      path: '/blog/*',
      title: null,
      reasons: [
        {
          type: 'template_gaps',
          gaps: [
            { key: 'author-byline', label: 'Author byline' },
            { key: 'faq-schema', label: 'FAQ schema' },
          ],
        },
      ],
      aiVisits: 112,
      lastAudit: null,
      priority: 69,
      template: { pages: 38, audited: 12, toAudit: ['https://acme.com/blog/x'] },
    });
    render([template]);
    expect(cells(rows()[0])).toEqual([
      '',
      '69',
      '/blog/* · 38 pages',
      'Author bylineFAQ schema',
      '112',
      '12 of 38',
    ]);
    // Not a link: a template has no one page to open.
    expect(rows()[0].querySelectorAll('td')[2].querySelector('a')).toBeNull();
    expect(
      rows()[0].querySelectorAll('td')[2].querySelector('[title]')?.getAttribute('title'),
    ).toBe('Fix once, applies to 38 pages');
  });

  it('shows the priority, dark from 80, with its parts on hover', () => {
    render([opportunity(), blog]);
    const pill = (row: Element) => row.querySelectorAll('td')[1].querySelector('span')!;
    const [high, low] = rows().map(pill);
    expect(high.textContent).toBe('88');
    expect(high.className).toContain('bg-foreground');
    expect(high.getAttribute('title')).toBe('Value 0.96 × opportunity 0.90 × ease 0.80');
    expect(low.textContent).toBe('41');
    expect(low.className).toContain('bg-muted');
    expect(container.querySelector('thead')?.textContent).toContain('Priority');
  });

  it('selects pages not being audited, one by one or all shown', () => {
    const running = opportunity({ key: 'run', path: '/run', running: true, lastAudit: null });
    render([opportunity(), blog, running], {
      selected: new Set(['acme.com/blog']),
      toolbar: <div role="toolbar">bulk</div>,
    });

    expect(rows()[2].textContent).toContain('Running');
    expect(box('Select /run').disabled).toBe(true);
    expect(box('Select all opportunities shown').getAttribute('data-state')).toBe('indeterminate');
    expect(container.querySelector('[role=toolbar]')?.textContent).toBe('bulk');

    act(() => box('Select /pricing').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing'], true);
    act(() => box('Select all opportunities shown').click());
    expect(onSelect).toHaveBeenLastCalledWith(['acme.com/pricing', 'acme.com/blog'], true);
  });

  it('shows 50 pages at a time', () => {
    const many = Array.from({ length: OPPORTUNITIES_STEP + 5 }, (_, i) =>
      opportunity({ key: `p${i}`, path: `/p${i}` }),
    );
    render(many);
    expect(rows()).toHaveLength(OPPORTUNITIES_STEP);
    act(() => button('Show more')!.click());
    expect(rows()).toHaveLength(OPPORTUNITIES_STEP + 5);
    expect(button('Show more')).toBeUndefined();
  });

  it('lists the excluded pages on demand, each to restore', () => {
    render([opportunity()], {
      excluded: [
        { key: 'acme.com/legal', url: 'https://acme.com/legal', path: '/legal', title: null },
      ],
    });
    expect(container.textContent).toContain('1 excluded page');
    act(() => button('Show')!.click());
    act(() => button('Restore')!.click());
    expect(onRestore).toHaveBeenCalledWith(['https://acme.com/legal']);
  });

  it('lists the excluded pages without Restore for a member who cannot change them', () => {
    render([opportunity()], {
      excluded: [
        { key: 'acme.com/legal', url: 'https://acme.com/legal', path: '/legal', title: null },
      ],
      restore: null,
    });
    act(() => button('Show')!.click());
    expect(container.textContent).toContain('/legal');
    expect(button('Restore')).toBeUndefined();
    expect(container.textContent).toContain(
      'Only admins and managers can pin, exclude or restore pages.',
    );
  });

  it('says where opportunities come from when there are none', () => {
    render([]);
    expect(container.textContent).toContain('No pages to audit right now.');
    expect(container.textContent).toContain('not in 90 days');
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('opportunityAuditUrls', () => {
  it("audits each page, and a template's pages not audited yet, once each", () => {
    expect(
      opportunityAuditUrls([
        opportunity(),
        opportunity({
          key: 'template:/blog/*',
          url: null,
          path: '/blog/*',
          template: {
            pages: 3,
            audited: 1,
            toAudit: ['https://acme.com/blog/b', 'https://acme.com/pricing'],
          },
        }),
      ]),
    ).toEqual(['https://acme.com/pricing', 'https://acme.com/blog/b']);
  });
});
