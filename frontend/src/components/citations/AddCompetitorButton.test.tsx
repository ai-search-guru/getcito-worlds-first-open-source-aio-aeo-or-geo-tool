import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';

/**
 * Citations' "Add as competitor" on a read-only workspace (plan not active):
 * the upgrade dialog opens instead of its own, and nothing is added. Only
 * admins and managers see it.
 */

const addCompetitor = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/competitor', () => ({ addCompetitor }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AddCompetitorButton } = await import('./AddCompetitorButton');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const onAdded = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  addCompetitor.mockResolvedValue({ id: 'c1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean, role: TeamRole = 'manager') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <AddCompetitorButton brandId="b1" domain="rival.com" onAdded={onAdded} />
          </UpgradeDialogContext.Provider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const open = () =>
  act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Add rival.com as competitor"]')!
      .click(),
  );

describe('AddCompetitorButton', () => {
  it('adds nothing on a read-only workspace: the upgrade dialog opens instead', async () => {
    await render(true);
    await open();
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Adding competitors needs a plan');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(addCompetitor).not.toHaveBeenCalled();
  });

  it('asks for the name, then adds it, on an active plan', async () => {
    await render(false);
    await open();
    const add = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (b) => b.textContent?.trim() === 'Add',
    )!;
    await act(async () => add.click());
    expect(addCompetitor).toHaveBeenCalledWith('b1', { name: 'Rival', domain: 'rival.com' });
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it.each(['analyst', 'agency_partner'] as const)('is not shown to an %s', async (role) => {
    await render(false, role);
    expect(container.querySelector('button')).toBeNull();
  });
});
