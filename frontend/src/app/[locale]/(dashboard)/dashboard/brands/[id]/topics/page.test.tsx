import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Manage topics on a read-only workspace (plan not active): Add and a topic's
 * Edit open the upgrade dialog instead of writing.
 */

const actions = vi.hoisted(() => ({
  getTopics: vi.fn(),
  getPromptCountByTopic: vi.fn(async () => 0),
  createTopic: vi.fn(),
  updateTopic: vi.fn(),
  deleteTopic: vi.fn(),
}));
vi.mock('@/lib/actions/topic', () => actions);
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: BrandTopicsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Already settled, so `use(params)` reads it without suspending.
const params = Object.assign(Promise.resolve({ id: 'b1' }), {
  status: 'fulfilled',
  value: { id: 'b1' },
});

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <BrandTopicsPage params={params} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const typeName = async (name: string) => {
  const input = container.querySelector<HTMLInputElement>('#add-topic input')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const add = () =>
  [...container.querySelectorAll<HTMLButtonElement>('#add-topic button')].find(
    (b) => b.textContent?.trim() === 'Add',
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  actions.getTopics.mockResolvedValue([
    { id: 't1', brandId: 'b1', name: 'Coffee', isActive: true, createdAt: '2026-10-01' },
  ]);
  actions.createTopic.mockResolvedValue({ id: 't2', name: 'Tea' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Manage topics on a read-only workspace', () => {
  it('adds nothing and opens no rename, and says why', async () => {
    await render(true);
    await typeName('Tea');
    await act(async () => add().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding topics needs a plan');
    expect(actions.createTopic).not.toHaveBeenCalled();

    const edit = container.querySelector<HTMLButtonElement>('[aria-label="Edit topic"]')!;
    await act(async () => edit.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Editing topics needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Save topic changes"]')).toBeNull();
  });

  it('adds a topic on an active plan', async () => {
    await render(false);
    await typeName('Tea');
    await act(async () => add().click());
    expect(actions.createTopic).toHaveBeenCalledWith('b1', 'Tea');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
