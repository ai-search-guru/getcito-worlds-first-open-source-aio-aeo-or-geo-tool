import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Settings › Organization: an admin renames the organization; on a
 * read-only workspace (plan not active) Save opens the upgrade dialog.
 */

const org = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  updateOrganizationName: vi.fn(),
}));
vi.mock('@/lib/actions/organization', () => org);
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ canAdmin: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { OrganizationSection } = await import('./OrganizationSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  org.getOrganization.mockResolvedValue({
    name: 'Acme',
    slug: 'acme',
    plan: 'growth',
    memberCount: 2,
  });
  org.updateOrganizationName.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renameTo(name: string, isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <OrganizationSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  const input = container.querySelector<HTMLInputElement>('#org-name')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Save changes',
  )!;
  await act(async () => save.click());
}

describe('OrganizationSection', () => {
  it('renames nothing on a read-only workspace: Save opens the upgrade dialog', async () => {
    await renameTo('Acme Inc', true);
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Renaming the organization needs a plan');
    expect(org.updateOrganizationName).not.toHaveBeenCalled();
  });

  it('renames the organization on an active plan', async () => {
    await renameTo('Acme Inc', false);
    expect(org.updateOrganizationName).toHaveBeenCalledWith('Acme Inc');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
