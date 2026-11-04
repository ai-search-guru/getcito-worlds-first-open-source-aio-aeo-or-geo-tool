import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { BrandFact, BrandFactsRead } from '@/lib/content/brandFacts';
import { BrandFactsTab } from './_BrandFactsTab';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const getBrandFacts = vi.fn();
const readBrandFactsAgain = vi.fn();
const setBrandFactStatus = vi.fn();
vi.mock('@/lib/actions/brandFacts', () => ({
  getBrandFacts: (...args: unknown[]) => getBrandFacts(...args),
  readBrandFactsAgain: (...args: unknown[]) => readBrandFactsAgain(...args),
  setBrandFactStatus: (...args: unknown[]) => setBrandFactStatus(...args),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Brand settings › Brand facts (Quality CE-047): the facts read from the
 * brand's own site, each approved or rejected by a member, with where it
 * was read and what it would replace.
 */

const NOW = Date.parse('2026-10-24T12:00:00Z');
const fact = (over: Partial<BrandFact>): BrandFact => ({
  id: 'f1',
  kind: 'price',
  value: { plan: 'Pro', amount: 49, currency: 'USD', period: 'month', billed: null, per: null },
  quote: '$49 per month',
  sourceUrl: 'https://ledgerly.example/pricing',
  sourceKind: 'pricing',
  status: 'pending',
  reviewedAt: null,
  firstSeenAt: '2026-10-24T11:00:00Z',
  gone: false,
  replaces: null,
  ...over,
});
const READ: BrandFactsRead = {
  facts: [
    fact({
      replaces: {
        id: 'f0',
        value: {
          plan: 'Pro',
          amount: 59,
          currency: 'USD',
          period: 'month',
          billed: null,
          per: null,
        },
      },
    }),
    fact({
      id: 'f2',
      kind: 'trial',
      value: { days: 14 },
      quote: '14-day free trial',
      status: 'approved',
    }),
    fact({
      id: 'f3',
      kind: 'claim',
      value: {},
      quote: 'SOC 2 Type II certified',
      status: 'approved',
      gone: true,
    }),
    fact({
      id: 'f4',
      kind: 'founded',
      value: { year: 2015 },
      quote: 'Founded in 2015',
      status: 'rejected',
      sourceKind: 'about',
    }),
  ],
  pages: [
    {
      kind: 'pricing',
      url: 'https://ledgerly.example/pricing',
      status: 'ok',
      checkedAt: '2026-10-24T11:59:00Z',
    },
    { kind: 'about', url: null, status: 'blocked', checkedAt: '2026-10-24T11:59:00Z' },
  ],
  checkedAt: '2026-10-24T11:59:00Z',
  recheckAt: '2026-10-24T12:09:00Z',
  paused: false,
  noDomain: false,
};

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const render = async (isLocked = false) => {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <BrandFactsTab brandId="b1" />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
};
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
/** A section by its heading (aria-labelledby). */
const section = (label: string) =>
  [...container.querySelectorAll('section')].find(
    (s) => document.getElementById(s.getAttribute('aria-labelledby')!)?.textContent === label,
  )!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  getBrandFacts.mockReset().mockResolvedValue(READ);
  readBrandFactsAgain.mockReset();
  setBrandFactStatus.mockReset();
  toast.error.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('BrandFactsTab', () => {
  it('lists the facts to approve, approved and rejected, with their words, page and what they replace', async () => {
    await render();
    expect(getBrandFacts).toHaveBeenCalledWith('b1');
    const toApprove = section('To approve (1)');
    expect(toApprove.textContent).toContain('Pro · $49 / month');
    expect(toApprove.textContent).toContain('“$49 per month”');
    expect(toApprove.textContent).toContain('Was Pro · $59 / month');
    expect(toApprove.querySelector('a')?.getAttribute('href')).toBe(
      'https://ledgerly.example/pricing',
    );
    expect(button('Approve', toApprove)?.getAttribute('aria-label')).toBe(
      'Approve Pro · $49 / month',
    );

    const approved = section('Approved');
    expect(approved.textContent).toContain('14 days');
    expect(approved.textContent).toContain('“SOC 2 Type II certified”');
    expect(approved.textContent).toContain('No longer on your site');
    // An approved fact can only be rejected; a rejected one approved again.
    expect(button('Approve', approved)).toBeUndefined();
    const rejected = container.querySelector('details')!;
    expect(rejected.querySelector('summary')?.textContent).toBe('Rejected (1)');
    expect(rejected.textContent).toContain('2015');

    // Each page read, and how.
    expect(container.textContent).toContain('Pricing page: read');
    expect(container.textContent).toContain('About page: turned our reader away');
  });

  it('approves a fact as the member, in the list at once, dropping the gone one it replaces', async () => {
    const gone = fact({ id: 'f0', status: 'approved', gone: true, quote: '$59 per month' });
    getBrandFacts.mockResolvedValue({ ...READ, facts: [...READ.facts, gone] });
    await render();
    setBrandFactStatus.mockResolvedValue({ id: 'f1', status: 'approved' });
    await act(async () => button('Approve', section('To approve (1)'))!.click());
    expect(setBrandFactStatus).toHaveBeenCalledWith('f1', 'approved');
    // No read of the site, nor of the list: the review is the list's.
    expect(getBrandFacts).toHaveBeenCalledTimes(1);
    expect(section('To approve (1)')).toBeUndefined();
    const approved = section('Approved');
    expect(approved.textContent).toContain('Pro · $49 / month');
    expect(approved.textContent).not.toContain('$59 per month');
  });

  it('reviews nothing on a read-only workspace: Approve opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    await render(true);
    await act(async () => button('Approve', section('To approve (1)'))!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Reviewing brand facts needs a plan');
    expect(setBrandFactStatus).not.toHaveBeenCalled();
    expect(section('To approve (1)')).toBeDefined();
  });

  it('reads the list again when a review fails (a read removed the fact meanwhile)', async () => {
    await render();
    setBrandFactStatus.mockResolvedValue({ error: 'failed' });
    getBrandFacts.mockResolvedValueOnce({ ...READ, facts: READ.facts.slice(1) });
    await act(async () => button('Approve', section('To approve (1)'))!.click());
    expect(toast.error).toHaveBeenCalledWith("That fact couldn't be saved. Try again.");
    expect(getBrandFacts).toHaveBeenCalledTimes(2);
    expect(section('To approve (1)')).toBeUndefined();
  });

  it('does one thing at a time: no second review, and no read of the site, while one is out', async () => {
    vi.setSystemTime(Date.parse('2026-10-24T12:10:00Z'));
    await render();
    let answer: (value: unknown) => void = () => {};
    setBrandFactStatus.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await act(async () => button('Approve', section('To approve (1)'))!.click());
    expect(button('Approve', section('To approve (1)'))!.disabled).toBe(true);
    expect(button('Read again')!.disabled).toBe(true);
    expect(section('To approve (1)').querySelector('li')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => answer({ id: 'f1', status: 'approved' }));
    expect(button('Read again')!.disabled).toBe(false);
  });

  it('reads the site again only once the API allows it', async () => {
    await render();
    expect(button('Read again')?.disabled).toBe(true);
    vi.setSystemTime(Date.parse('2026-10-24T12:10:00Z'));
    getBrandFacts.mockResolvedValue({ ...READ, recheckAt: '2026-10-24T12:09:00Z' });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    readBrandFactsAgain.mockResolvedValue({ ...READ, paused: true, facts: [] });
    await act(async () => button('Read again')!.click());
    expect(readBrandFactsAgain).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain("This month's AI usage is used up");
    expect(container.textContent).toContain('No facts were found on your site yet.');
  });

  it('says when the API has them off', async () => {
    getBrandFacts.mockResolvedValueOnce({ error: 'off' });
    await render();
    expect(container.textContent).toContain("Brand facts aren't available yet.");
  });

  it('says when the brand has no domain, and when the facts can’t be read', async () => {
    getBrandFacts.mockResolvedValueOnce({ ...READ, noDomain: true, facts: [] });
    await render();
    expect(container.textContent).toContain("Add your site's domain under Domains");
    expect(button('Read again')).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    getBrandFacts.mockResolvedValueOnce({ error: 'failed' });
    await render();
    expect(container.textContent).toContain("Your brand facts couldn't be read.");
  });
});
