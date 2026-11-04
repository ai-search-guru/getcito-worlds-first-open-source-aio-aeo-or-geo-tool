import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptUsageSummary } from '@/lib/promptUsageSummary';
import { getPromptUsage, isPromptLimitReached } from '@/lib/promptUsage';
import {
  PromptUsageCards,
  countByStatus,
  locationQuotaFromUsage,
  matchesStatusFilter,
  newFirst,
  promptStatus,
  type PromptUsageState,
} from './_UsageCards';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const summary = (over: Partial<PromptUsageSummary> = {}): PromptUsageSummary => ({
  plan: { key: 'starter', name: 'Starter plan', locationLimit: 50, cta: 'upgrade_growth' },
  brand: { active: 44, paused: 2, total: 46 },
  account: { activePrompts: 44, brands: 1, locationsUsed: 46 },
  updatedAt: '2026-10-15T09:00:00.000Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onFilter = vi.fn();
const onRetry = vi.fn();

function render(state: PromptUsageState, newCount = 0, { open = true } = {}) {
  // Added an hour before the provider's clock, so they read as New.
  const prompts = Array.from({ length: newCount }, () => ({
    isActive: true,
    createdAt: '2026-10-15T08:00:00.000Z',
  }));
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="UTC"
        now={new Date('2026-10-15T09:00:10.000Z')}
      >
        <PromptUsageCards
          state={state}
          brandName="Acme Coffee"
          readOnly={false}
          prompts={prompts}
          filter="tracked"
          onFilter={onFilter}
          onRetry={onRetry}
        />
      </NextIntlClientProvider>,
    );
  });
  // The cards open folded; most tests read them open.
  const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
  if (open && toggle.getAttribute('aria-expanded') === 'false') act(() => toggle.click());
}

const values = () =>
  [...container.querySelectorAll('.text-2xl')].map((el) => el.textContent?.trim());
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

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

describe('PromptUsageCards', () => {
  it('shows the five numbers with the plan, and turns amber from 90% of the limit', () => {
    render({ status: 'ready', usage: summary() });

    expect(values()).toEqual(['44', '46', '44', '46 / 50', '4']);
    expect(container.textContent).toContain('Starter plan');
    expect(container.textContent).toContain('of 50 on Starter');
    expect(container.textContent).toContain('Counts updated just now');
    expect(container.querySelectorAll('.text-2xl')[4].className).toContain('text-amber-600');
    const upgrade = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Upgrade to Growth',
    );
    expect(upgrade?.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
  });

  it('marks an account over its limit after a downgrade, with no slots left', () => {
    render({
      status: 'ready',
      usage: summary({ account: { activePrompts: 60, brands: 1, locationsUsed: 64 } }),
    });

    expect(values().slice(3)).toEqual(['64 / 50', '0']);
    expect(container.textContent).toContain('over limit');
  });

  it('says an ended plan has ended, with no slots left and Choose a plan', () => {
    render({
      status: 'ready',
      usage: summary({
        plan: {
          key: 'growth',
          name: 'Growth plan',
          locationLimit: 200,
          cta: 'choose_plan',
          ended: true,
        },
      }),
    });

    expect(values().slice(3)).toEqual(['46 / 200', '0']);
    expect(container.textContent).toContain('Growth plan · ended');
    expect(container.textContent).toContain('Your Growth plan has ended · Choose a plan');
    expect(container.textContent).not.toContain('Starter');
    const choose = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Choose a plan',
    );
    expect(choose).toBeDefined();
  });

  it('asks an Enterprise account to contact us, against the limit set for it', () => {
    render({
      status: 'ready',
      usage: summary({
        plan: { key: 'enterprise', name: 'Enterprise plan', locationLimit: 1000, cta: 'contact' },
        brand: { active: 702, paused: 7, total: 709 },
        account: { activePrompts: 1248, brands: 3, locationsUsed: 781 },
      }),
    });

    expect(values()).toEqual(['702', '709', '1,248', '781 / 1,000', '219']);
    expect(container.textContent).toContain('across 3 brands');
    const contact = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Contact us',
    );
    expect(contact?.getAttribute('target')).toBe('_blank');
  });

  it('says Unlimited on self-hosted, with no plan page to link to', () => {
    render({
      status: 'ready',
      usage: summary({
        plan: { key: 'self_hosted', name: 'Self-Hosted plan', locationLimit: null, cta: null },
        account: { activePrompts: 57, brands: 1, locationsUsed: 74 },
      }),
    });

    expect(values().slice(3)).toEqual(['74', 'Unlimited']);
    expect(container.querySelector('[role=progressbar]')).toBeNull();
    expect(container.textContent).not.toContain('Plan & usage');
  });

  it('filters the table from the brand cards', () => {
    render({ status: 'ready', usage: summary() });

    act(() => button('Total prompts').click());
    expect(onFilter).toHaveBeenLastCalledWith('all');
    act(() => button('2 paused').click());
    expect(onFilter).toHaveBeenLastCalledWith('paused');
    // Active prompts counts the new ones too, so it shows them all.
    act(() => button('Active prompts').click());
    expect(onFilter).toHaveBeenLastCalledWith('tracked');
  });

  it('notes the new prompts the Active card counts, and filters to them', () => {
    render({ status: 'ready', usage: summary() });
    expect(container.textContent).not.toContain('new');

    render({ status: 'ready', usage: summary() }, 3);
    expect(values()[0]).toBe('44');
    expect(container.textContent).toContain('3 new · 2 paused · being tracked now');
    act(() => button('3 new').click());
    expect(onFilter).toHaveBeenLastCalledWith('new');
  });

  it('shows dashes and a retry when the counts fail to load', () => {
    render({ status: 'error' });

    expect(values()).toEqual(['–', '–', '–', '–', '–']);
    act(() => button("Couldn't load the counts · Retry").click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("falls back to the server's plan name for a plan this bundle doesn't know", () => {
    render({
      status: 'ready',
      usage: summary({
        plan: { key: 'team' as never, name: 'Team plan', locationLimit: 500, cta: 'contact' },
      }),
    });

    expect(container.textContent).toContain('Team plan');
    expect(container.textContent).toContain('of 500 on Team plan');
  });

  it('opens folded, with Show on the right after Plan & usage, and the whole bar opens it', () => {
    render({ status: 'ready', usage: summary() }, 0, { open: false });
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.textContent).toBe('Tracked Prompts: Show');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(body.className).toContain('hidden');
    // Show sits after Plan & usage, at the bar's right end.
    const plan = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Plan & usage',
    )!;
    expect(plan.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Tracked Prompts: Hide');
    expect(body.className).not.toContain('hidden');
    expect(values()[0]).toBe('44');

    // The bar itself, e.g. its title, folds it again.
    act(() => (container.querySelector('h2') as HTMLElement).click());
    expect(body.className).toContain('hidden');

    // Plan & usage goes to its page without folding or unfolding.
    plan.addEventListener('click', (e) => e.preventDefault());
    act(() => plan.click());
    expect(body.className).toContain('hidden');
  });

  it('says in the folded title when the prompt locations are nearly or fully used', () => {
    render({ status: 'ready', usage: summary() }, 0, { open: false });
    const pill = () =>
      [...container.querySelectorAll('h2 ~ span')].find((el) =>
        el.textContent?.includes('prompt locations'),
      ) as HTMLElement | undefined;
    expect(pill()?.textContent).toBe('46 / 50 prompt locations');
    expect(pill()?.className).toContain('amber');

    render(
      {
        status: 'ready',
        usage: summary({ account: { activePrompts: 50, brands: 1, locationsUsed: 52 } }),
      },
      0,
      { open: false },
    );
    expect(pill()?.textContent).toBe('52 / 50 prompt locations');
    expect(pill()?.className).toContain('red');

    // Open, the cards carry it instead.
    act(() => (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
    expect(pill()).toBeUndefined();
  });

  it('adds nothing to the folded title well under the limit, or with no limit', () => {
    render(
      {
        status: 'ready',
        usage: summary({ account: { activePrompts: 10, brands: 1, locationsUsed: 10 } }),
      },
      0,
      { open: false },
    );
    expect(container.querySelector('h2')?.parentElement?.textContent).not.toContain(
      'prompt locations',
    );
    render(
      {
        status: 'ready',
        usage: summary({
          plan: { key: 'self_hosted', name: 'Self-Hosted', locationLimit: null, cta: null },
        }),
      },
      0,
      { open: false },
    );
    expect(container.querySelector('h2')?.parentElement?.textContent).not.toContain(
      'prompt locations',
    );
  });

  it('shows skeletons, not zeros, while loading', () => {
    render({ status: 'loading' });

    expect(values()).toEqual([]);
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(0);
  });
});

describe('locationQuotaFromUsage', () => {
  it('gives the Add Prompt dialog the same limit and usage as the cards', () => {
    expect(locationQuotaFromUsage(summary())).toEqual({
      maxPrompts: 50,
      used: 46,
      planId: 'starter',
      planName: 'Starter',
    });
    expect(
      locationQuotaFromUsage(
        summary({
          plan: { key: 'self_hosted', name: 'Self-Hosted plan', locationLimit: null, cta: null },
        }),
      ).maxPrompts,
    ).toBe(-1);
  });

  it('leaves no slot to the Add Prompt dialog and bulk import once the plan has ended', () => {
    const ended = (locationLimit: number | null) =>
      locationQuotaFromUsage(
        summary({
          plan: {
            key: 'growth',
            name: 'Growth plan',
            locationLimit,
            cta: 'choose_plan',
            ended: true,
          },
        }),
      );

    // Limited or not, nothing can be added until a plan is chosen again.
    for (const quota of [ended(200), ended(null)]) {
      expect(quota).toMatchObject({ used: 46, planId: 'growth', planName: 'Growth' });
      const usage = getPromptUsage(quota.used, quota.maxPrompts);
      expect(usage.remaining).toBe(0);
      expect(isPromptLimitReached(usage)).toBe(true);
    }
  });
});

describe('the table status filter', () => {
  const now = Date.parse('2026-10-17T12:00:00.000Z');
  const old = '2026-10-01T09:00:00.000Z';
  const rows = [
    { isActive: true, createdAt: old },
    { isActive: true, createdAt: old },
    { isActive: true, createdAt: '2026-10-17T08:00:00.000Z' },
    { isActive: false, createdAt: old },
  ];

  it('opens on tracked rows, new ones included, and counts each filter for the title', () => {
    expect(rows.filter((r) => matchesStatusFilter(r, 'tracked', now))).toHaveLength(3);
    expect(rows.filter((r) => matchesStatusFilter(r, 'active', now))).toHaveLength(2);
    expect(rows.filter((r) => matchesStatusFilter(r, 'new', now))).toHaveLength(1);
    expect(rows.filter((r) => matchesStatusFilter(r, 'paused', now))).toHaveLength(1);
    expect(rows.filter((r) => matchesStatusFilter(r, 'all', now))).toHaveLength(4);
    expect(countByStatus(rows, now)).toEqual({ tracked: 3, active: 2, new: 1, paused: 1, all: 4 });
  });

  it('reads a tracked prompt as New for its first 24 hours', () => {
    const at = (createdAt: string, isActive = true) => promptStatus({ isActive, createdAt }, now);
    expect(at('2026-10-17T11:59:00.000Z')).toBe('new');
    expect(at('2026-10-16T12:00:01.000Z')).toBe('new');
    expect(at('2026-10-16T12:00:00.000Z')).toBe('active');
    expect(at(old)).toBe('active');
    // Paused wins: a prompt paused on its first day isn't tracked, so it isn't New.
    expect(at('2026-10-17T11:00:00.000Z', false)).toBe('paused');
  });

  it('leads the default order with the new prompts, newest first', () => {
    const row = (id: string, createdAt: string, isActive = true) => ({ id, isActive, createdAt });
    const sorted = [
      row('best', old),
      row('earlier-today', '2026-10-17T08:00:00.000Z'),
      row('paused-today', '2026-10-17T10:00:00.000Z', false),
      row('good', old),
      row('just-now', '2026-10-17T11:30:00.000Z'),
    ];
    expect(newFirst(sorted, now).map((r) => r.id)).toEqual([
      'just-now',
      'earlier-today',
      'best',
      'paused-today',
      'good',
    ]);
  });
});
