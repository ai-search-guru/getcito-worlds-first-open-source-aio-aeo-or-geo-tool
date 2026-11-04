import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Settings › Menu access: the sections each role sees, saved as they change;
 * Action Center and the admins' column can't be changed, and the page is for
 * admins and the managers they let change menus.
 */

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

let canManageMenus = true;
vi.mock('@/components/context/MenuAccessProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/context/MenuAccessProvider')>()),
  useCanManageMenus: () => canManageMenus,
}));
let chatOn = true;

const actions = vi.hoisted(() => ({
  getMenuAccessSettings: vi.fn(),
  setRoleMenu: vi.fn(),
}));
vi.mock('@/lib/actions/menuAccess', () => actions);

const { MenuAccessSection, hiddenForSet } = await import('./MenuAccessSection');
const { ChatAgenticProvider } = await import('@/components/context/ChatAgenticProvider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  canManageMenus = true;
  chatOn = true;
  actions.getMenuAccessSettings.mockResolvedValue({
    roles: { manager: [], analyst: ['content', 'audit'], agency_partner: [] },
    members: [],
    viewerIsAdmin: true,
  });
  actions.setRoleMenu.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatOn}>
          <MenuAccessSection />
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const box = (label: string) =>
  container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;

describe('MenuAccessSection', () => {
  it('ticks what each role sees, by the menu’s labels', async () => {
    await render();
    expect(box('Analyst sees Content')?.getAttribute('aria-checked')).toBe('false');
    expect(box('Analyst sees Audit')?.getAttribute('aria-checked')).toBe('false');
    expect(box('Analyst sees Brand Visibility')?.getAttribute('aria-checked')).toBe('true');
    expect(box('Analyst sees Competitors')?.getAttribute('aria-checked')).toBe('true');
    expect(box('Manager sees Content')?.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Product Visibility');
    expect(container.textContent).toContain('Execution');
    expect(container.textContent).toContain('Analytics');
  });

  it('lists Chat above the headings, as the menu does, and one Other group', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text.indexOf('Chat')).toBeGreaterThan(-1);
    expect(text.indexOf('Chat')).toBeLessThan(text.indexOf('Execution'));
    expect(text.match(/Other/g)).toHaveLength(1);
  });

  it('lists Agent Center right under Chat, every role seeing it until it is hidden', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text.indexOf('Agent Center')).toBeGreaterThan(text.indexOf('Chat'));
    expect(text.indexOf('Agent Center')).toBeLessThan(text.indexOf('Execution'));
    for (const role of ['Manager', 'Analyst', 'Agency Partner']) {
      expect(box(`${role} sees Agent Center`)?.getAttribute('aria-checked')).toBe('true');
    }
    await act(async () => box('Analyst sees Agent Center')!.click());
    expect(actions.setRoleMenu).toHaveBeenCalledWith('analyst', ['agents', 'content', 'audit']);
  });

  it('leaves Agent Center out while the new Chat is off, Chat staying', async () => {
    chatOn = false;
    await render();
    expect(container.textContent).not.toContain('Agent Center');
    expect(box('Analyst sees Agent Center')).toBeNull();
    expect(box('Analyst sees Chat')).not.toBeNull();
  });

  it('keeps Action Center and the admins’ column on', async () => {
    await render();
    expect(box('Everyone sees Action Center')?.disabled).toBe(true);
    expect(box('Admins see Content')?.disabled).toBe(true);
    expect(box('Admins see Content')?.getAttribute('aria-checked')).toBe('true');
  });

  it('saves a role’s menu as a box changes', async () => {
    await render();
    await act(async () => box('Analyst sees Content')!.click());
    expect(actions.setRoleMenu).toHaveBeenCalledWith('analyst', ['audit']);
    expect(box('Analyst sees Content')?.getAttribute('aria-checked')).toBe('true');

    await act(async () => box('Manager sees Reports')!.click());
    expect(actions.setRoleMenu).toHaveBeenLastCalledWith('manager', ['reports']);
  });

  it('reads the menus again when a save fails, keeping a save that went through', async () => {
    await render();
    // The first click's save fails after the second's went through.
    actions.setRoleMenu.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined);
    actions.getMenuAccessSettings.mockResolvedValueOnce({
      roles: { manager: ['reports'], analyst: ['content', 'audit'], agency_partner: [] },
      members: [],
      viewerIsAdmin: true,
    });
    await act(async () => {
      box('Manager sees Mentions')!.click();
      box('Manager sees Reports')!.click();
    });
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the menu. Try again.");
    expect(box('Manager sees Mentions')?.getAttribute('aria-checked')).toBe('true');
    expect(box('Manager sees Reports')?.getAttribute('aria-checked')).toBe('false');
  });

  it('fills a role from a ready-made set', async () => {
    await render();
    const trigger = container.querySelector(
      '[aria-label="Fill Manager from a ready-made set"]',
    ) as HTMLElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent === 'Brand & PR',
    ) as HTMLElement;
    // Base UI picks the highlighted option: the pointer moves onto it first.
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await act(async () => {
      option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      option.click();
    });
    expect(actions.setRoleMenu).toHaveBeenCalledWith('manager', [
      'content',
      'audit',
      'prompts',
      'shopping',
      'traffic',
    ]);
    expect(box('Manager sees Content')?.getAttribute('aria-checked')).toBe('false');
  });

  it('tells people who can’t change menus, without reading them', async () => {
    canManageMenus = false;
    await render();
    expect(container.textContent).toContain(
      'Only admins, and managers an admin lets, choose what each role sees on the menu.',
    );
    expect(actions.getMenuAccessSettings).not.toHaveBeenCalled();
  });

  it('says so when the settings can’t be read', async () => {
    actions.getMenuAccessSettings.mockRejectedValueOnce(new Error('down'));
    await render();
    expect(container.textContent).toContain("Couldn't load menu access.");
  });
});

describe('hiddenForSet', () => {
  it('hides what a ready-made set leaves out, never Action Center', () => {
    expect(hiddenForSet('brand')).toEqual(['content', 'audit', 'prompts', 'shopping', 'traffic']);
    // The sets that don't compare the brand with others leave Competitors off.
    expect(hiddenForSet('content')).toContain('competitors');
    expect(hiddenForSet('all')).toEqual([]);
  });
});
