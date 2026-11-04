import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptTableViews } from '@/lib/actions/promptTableViews';
import { DEFAULT_COLUMNS_VIEW, toggleColumn } from '@/lib/promptTableColumns';

const actions = vi.hoisted(() => ({
  savePromptTableView: vi.fn(),
  removePromptTableView: vi.fn(),
}));
vi.mock('@/lib/actions/promptTableViews', () => actions);
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ColumnsPanel } = await import('./_ColumnsPanel');

/** The Tracked Prompts table's Columns panel (PROMPT-015a). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-1111-1111-111111111111';
let container: HTMLDivElement;
let root: Root;
let views: PromptTableViews;
const onViewsChange = vi.fn((next: PromptTableViews) => {
  views = next;
  render();
});
let canManage = true;

function render() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ColumnsPanel
          brandId={BRAND}
          brandName="Northwind Coffee"
          canManage={canManage}
          views={views}
          onViewsChange={onViewsChange}
          locations={['US', 'TR']}
        />
      </NextIntlClientProvider>,
    );
  });
}

async function open() {
  render();
  const trigger = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Columns'),
  )!;
  await act(async () => trigger.click());
}

const item = (label: string) =>
  [...document.querySelectorAll('li')].find((li) => li.textContent?.includes(label))!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  actions.savePromptTableView.mockReset().mockResolvedValue({ ok: true });
  actions.removePromptTableView.mockReset().mockResolvedValue({ ok: true });
  toast.error.mockReset();
  onViewsChange.mockClear();
  views = { mine: null, brand: null };
  canManage = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('ColumnsPanel', () => {
  it('shows every column on by default, and saves a hidden one for the person', async () => {
    await open();
    expect(container.textContent).toContain('Columns · 12');
    expect(document.body.textContent).toContain('Saved for you only.');
    const competition = item('Competition').querySelector('[role="checkbox"]') as HTMLElement;
    expect(competition.getAttribute('aria-checked')).toBe('true');
    await act(async () => competition.click());
    expect(views.mine?.hidden).toEqual(['competition']);
    expect(container.textContent).toContain('Columns · 11');
    // Saved once, a moment after the last change.
    expect(actions.savePromptTableView).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(700));
    expect(actions.savePromptTableView).toHaveBeenCalledExactlyOnceWith(
      BRAND,
      { order: DEFAULT_COLUMNS_VIEW.order, hidden: ['competition'] },
      'mine',
    );
  });

  it('moves a column with its arrows', async () => {
    await open();
    const up = document.querySelector('button[aria-label="Move Status up"]') as HTMLButtonElement;
    await act(async () => up.click());
    expect(views.mine?.order.slice(0, 2)).toEqual(['status', 'topic']);
    expect(
      (document.querySelector('button[aria-label="Move Status up"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shares a manager's view with everyone on the brand, and stops sharing it", async () => {
    views = { mine: toggleColumn(DEFAULT_COLUMNS_VIEW, 'runs', false), brand: null };
    await open();
    const share = document.getElementById('prompt-columns-share') as HTMLElement;
    await act(async () => share.click());
    expect(actions.savePromptTableView).toHaveBeenCalledWith(BRAND, views.mine, 'brand');
    expect(views.brand).toEqual(views.mine);
    await act(async () => (document.getElementById('prompt-columns-share') as HTMLElement).click());
    expect(actions.removePromptTableView).toHaveBeenCalledWith(BRAND, 'brand');
    expect(views.brand).toBeNull();
  });

  it("shows a member the brand's view, offers no sharing, and resets to it", async () => {
    canManage = false;
    const brand = toggleColumn(DEFAULT_COLUMNS_VIEW, 'work', false);
    views = { mine: toggleColumn(brand, 'runs', false), brand };
    await open();
    expect(document.getElementById('prompt-columns-share')).toBeNull();
    expect(document.body.textContent).toContain('Admins and managers can share a view');
    const reset = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === "Reset to the brand's view",
    )!;
    await act(async () => reset.click());
    expect(actions.removePromptTableView).toHaveBeenCalledWith(BRAND, 'mine');
    expect(views).toEqual({ mine: null, brand });
  });

  it('adds a metric in one of the brand’s locations as a column, and removes it (PROMPT-015b)', async () => {
    await open();
    const [metric, location] = [...document.querySelectorAll('select')] as HTMLSelectElement[];
    await act(async () => {
      metric.value = 'position';
      metric.dispatchEvent(new Event('change', { bubbles: true }));
      location.value = 'TR';
      location.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const add = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
    await act(async () => add.click());
    expect(views.mine?.order.at(-1)).toBe('loc:position:TR');
    expect(item('Position · Türkiye')).toBeDefined();
    const remove = document.querySelector(
      'button[aria-label="Remove Position · Türkiye"]',
    ) as HTMLButtonElement;
    await act(async () => remove.click());
    expect(views.mine?.order).not.toContain('loc:position:TR');
  });

  it("keeps a member's change off the brand's view when they have none of their own", async () => {
    canManage = false;
    const brand = toggleColumn(DEFAULT_COLUMNS_VIEW, 'work', false);
    views = { mine: null, brand };
    await open();
    expect(document.body.textContent).toContain('Showing the view shared on Northwind Coffee.');
    await act(async () =>
      (item('Competition').querySelector('[role="checkbox"]') as HTMLElement).click(),
    );
    expect(views).toEqual({ mine: toggleColumn(brand, 'competition', false), brand });
    await act(async () => vi.advanceTimersByTime(700));
    expect(actions.savePromptTableView).toHaveBeenCalledExactlyOnceWith(
      BRAND,
      toggleColumn(brand, 'competition', false),
      'mine',
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps a manager's change for them alone until they share it", async () => {
    const brand = toggleColumn(DEFAULT_COLUMNS_VIEW, 'work', false);
    views = { mine: null, brand };
    await open();
    const share = document.getElementById('prompt-columns-share') as HTMLElement;
    expect(share.getAttribute('aria-checked')).toBe('false');
    await act(async () =>
      (item('Competition').querySelector('[role="checkbox"]') as HTMLElement).click(),
    );
    expect(views.brand).toEqual(brand);
    await act(async () => vi.advanceTimersByTime(700));
    expect(actions.savePromptTableView).toHaveBeenCalledExactlyOnceWith(
      BRAND,
      toggleColumn(brand, 'competition', false),
      'mine',
    );
  });

  it("keeps a shared view linked: the manager's later changes update the brand's too", async () => {
    await open();
    await act(async () => (document.getElementById('prompt-columns-share') as HTMLElement).click());
    // Saved as theirs too, so the link holds after a reload.
    expect(actions.savePromptTableView).toHaveBeenCalledWith(BRAND, DEFAULT_COLUMNS_VIEW, 'brand');
    expect(actions.savePromptTableView).toHaveBeenCalledWith(BRAND, DEFAULT_COLUMNS_VIEW, 'mine');
    expect(document.body.textContent).toContain('your changes also update the brand');
    actions.savePromptTableView.mockClear();
    await act(async () =>
      (item('Competition').querySelector('[role="checkbox"]') as HTMLElement).click(),
    );
    const next = toggleColumn(DEFAULT_COLUMNS_VIEW, 'competition', false);
    expect(views).toEqual({ mine: next, brand: next });
    await act(async () => vi.advanceTimersByTime(700));
    expect(actions.savePromptTableView).toHaveBeenCalledWith(BRAND, next, 'mine');
    expect(actions.savePromptTableView).toHaveBeenCalledWith(BRAND, next, 'brand');
  });

  it('says so when a view could not be saved', async () => {
    actions.savePromptTableView.mockResolvedValue({ ok: false, error: 'forbidden' });
    await open();
    await act(async () => (document.getElementById('prompt-columns-share') as HTMLElement).click());
    expect(toast.error).toHaveBeenCalledWith(
      'Only admins and managers can share a view with the brand.',
    );
    expect(views.brand).toBeNull();
  });
});
