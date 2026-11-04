import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { CatalogSource } from '@/lib/catalog';
import type { StoreResult } from '@/lib/catalogClient';
import type { CatalogSourcesRead } from './CatalogSourcesCard';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const listSignInAccounts = vi.fn();
const connectSignInAccount = vi.fn();
vi.mock('@/lib/catalogClient', () => ({
  listSignInAccounts: (...args: unknown[]) => listSignInAccounts(...args),
  connectSignInAccount: (...args: unknown[]) => connectSignInAccount(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
// Two brands, the active one switched by the tests.
const brandStore = vi.hoisted(() => ({
  activeBrandId: 'b1' as string | null,
  brands: [
    { id: 'b1', name: 'Acme' },
    { id: 'b2', name: 'Bolt' },
  ],
}));
vi.mock('@/state/useBrandStore', () => ({ useBrandStore: () => brandStore }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// The picker's popup isn't what's tested: a plain select stands in for it.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string | null;
    onValueChange: (v: string | null) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="Choose an account"
      value={value ?? ''}
      onChange={(e) => onValueChange(e.target.value || null)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    disabled,
    children,
  }: {
    value: string;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <option value={value} disabled={disabled}>
      {children}
    </option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const { MerchantCenterAccounts, OWN_ERRORS, accountLabel } =
  await import('./MerchantCenterAccounts');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Google Merchant Center (#1270): a brand picks its account. */

let container: HTMLDivElement;
let root: Root;
const onConnected = vi.fn();
const openUpgrade = vi.fn();
// A read-only workspace (plan not active) when set.
let isLocked = false;

async function render(sources?: CatalogSourcesRead | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <MerchantCenterAccounts onConnected={onConnected} sources={sources} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const select = () => container.querySelector('select')!;
const options = () => [...container.querySelectorAll('option')];
async function pick(value: string) {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
}
/** Switches the active brand, as the sidebar's brand switcher does. */
async function switchTo(brandId: string) {
  brandStore.activeBrandId = brandId;
  await render();
}
/** A connect that answers when the test says. */
function heldConnect() {
  let answer!: (result: StoreResult) => void;
  connectSignInAccount.mockReturnValue(new Promise<StoreResult>((r) => (answer = r)));
  return (result: StoreResult) => act(async () => answer(result));
}
const source = (account: string): CatalogSource => ({
  id: `gmc-${account}`,
  kind: 'merchant_center',
  format: 'auto',
  url: null,
  account,
  label: null,
  lastSyncedAt: null,
  lastStatus: null,
  lastError: null,
  lastCounts: null,
  products: 0,
});

beforeEach(() => {
  role.canManage = true;
  brandStore.activeBrandId = 'b1';
  listSignInAccounts.mockReset().mockResolvedValue({
    ok: true,
    accounts: [
      { id: '123', name: 'Acme Outdoor' },
      { id: '456', name: null },
    ],
  });
  connectSignInAccount.mockReset().mockResolvedValue({ ok: true });
  onConnected.mockReset();
  openUpgrade.mockReset();
  isLocked = false;
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('accountLabel', () => {
  it('names an account by its name and id, or its id', () => {
    expect(accountLabel({ id: '123', name: 'Acme Outdoor' })).toBe('Acme Outdoor (123)');
    expect(accountLabel({ id: '456', name: null })).toBe('456');
  });
});

describe('MerchantCenterAccounts', () => {
  it("lists the accounts the workspace's Google sign-in opens, and adds the picked one to the brand", async () => {
    await render();
    expect(listSignInAccounts).toHaveBeenCalledWith('b1', 'merchant_center');
    const text = container.textContent ?? '';
    expect(text).toContain('Merchant Center account for Acme');
    expect(options().map((o) => o.textContent)).toEqual(['', 'Acme Outdoor (123)', '456']);
    expect(button('Add account')!.disabled).toBe(true);

    await pick('123');
    await act(async () => button('Add account')!.click());
    expect(connectSignInAccount).toHaveBeenCalledWith('b1', 'merchant_center', '123');
    expect(toast.success).toHaveBeenCalledWith(
      'Acme Outdoor (123) added to Acme. Its products are being read now.',
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(select().value).toBe('');
  });

  it("drops the pick when the brand changes: another brand never adds the first one's account", async () => {
    await render();
    await pick('123');
    expect(button('Add account')!.disabled).toBe(false);

    await switchTo('b2');
    expect(listSignInAccounts).toHaveBeenLastCalledWith('b2', 'merchant_center');
    expect(container.textContent).toContain('Merchant Center account for Bolt');
    expect(select().value).toBe('');
    expect(button('Add account')!.disabled).toBe(true);
    await act(async () => button('Add account')!.click());
    expect(connectSignInAccount).not.toHaveBeenCalled();

    // Nor does the second brand's pick carry back to the first.
    await pick('456');
    await switchTo('b1');
    expect(select().value).toBe('');
    expect(button('Add account')!.disabled).toBe(true);
  });

  it('adds the account to the brand it was picked for when the brand changes while adding', async () => {
    const answer = heldConnect();
    await render();
    await pick('123');
    await act(async () => button('Add account')!.click());
    await switchTo('b2');
    // One add at a time, and Bolt's picker has nothing picked.
    expect(button('Add account')!.disabled).toBe(true);
    expect(select().value).toBe('');

    await answer({ ok: true });
    expect(connectSignInAccount).toHaveBeenCalledTimes(1);
    expect(connectSignInAccount).toHaveBeenCalledWith('b1', 'merchant_center', '123');
    expect(toast.success).toHaveBeenCalledWith(
      'Acme Outdoor (123) added to Acme. Its products are being read now.',
    );
    expect(container.textContent).toContain('Merchant Center account for Bolt');
    expect(select().value).toBe('');
    await pick('456');
    expect(button('Add account')!.disabled).toBe(false);
  });

  it('adds once when the button is clicked twice while adding', async () => {
    const answer = heldConnect();
    await render();
    await pick('123');
    await act(async () => {
      button('Add account')!.click();
      button('Add account')!.click();
    });
    expect(button('Add account')!.disabled).toBe(true);
    await act(async () => button('Add account')!.click());
    await answer({ ok: true });
    expect(connectSignInAccount).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('marks the accounts the brand has already, and they cannot be picked', async () => {
    await render({ brandId: 'b1', sources: [source('123')] });
    const [, added, other] = options();
    expect(added.textContent).toBe('Acme Outdoor (123) · already added');
    expect(added.disabled).toBe(true);
    expect(other.textContent).toBe('456');
    expect(other.disabled).toBe(false);
    await pick('123');
    expect(button('Add account')!.disabled).toBe(true);

    // Another brand's sources mark nothing here.
    await render({ brandId: 'b2', sources: [source('123')] });
    expect(options()[1].disabled).toBe(false);
  });

  it("says why it couldn't add the account, in plain words", async () => {
    connectSignInAccount.mockResolvedValue({ ok: false, code: 'duplicate', message: null });
    await render();
    await pick('123');
    await act(async () => button('Add account')!.click());
    expect(toast.error).toHaveBeenCalledWith('This account is added to the brand already.');

    connectSignInAccount.mockResolvedValue({ ok: false, code: 'failed', message: null });
    await act(async () => button('Add account')!.click());
    expect(toast.error).toHaveBeenLastCalledWith(
      "Couldn't add the account. Try again in a moment.",
    );
    expect(onConnected).not.toHaveBeenCalled();
    // The pick stays, to try again.
    expect(select().value).toBe('123');
  });

  it("reads the accounts again with Try again when they couldn't be read", async () => {
    listSignInAccounts.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the Merchant Center accounts.");
    expect(container.querySelector('select')).toBeNull();

    listSignInAccounts.mockResolvedValue({ ok: false, code: 'unreachable' });
    await act(async () => button('Try again')!.click());
    expect(listSignInAccounts).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      "Merchant Center couldn't be reached. Try again in a moment.",
    );

    listSignInAccounts.mockResolvedValue({ ok: true, accounts: [{ id: '123', name: 'Acme' }] });
    await act(async () => button('Try again')!.click());
    expect(listSignInAccounts).toHaveBeenCalledTimes(3);
    expect(options().map((o) => o.textContent)).toEqual(['', 'Acme (123)']);
    expect(button('Try again')).toBeUndefined();
  });

  it('says when the sign-in no longer opens Merchant Center, or opens no account', async () => {
    listSignInAccounts.mockResolvedValue({ ok: false, code: 'not_connected' });
    await render();
    expect(container.textContent).toContain(
      'The Google sign-in no longer opens Merchant Center. Disconnect it and connect again.',
    );

    listSignInAccounts.mockResolvedValue({ ok: true, accounts: [] });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain(
      "This Google sign-in doesn't open any Merchant Center account. Ask an admin of the account to add you in Merchant Center, then try again.",
    );
    expect(button('Try again')).toBeDefined();
  });

  it("says who can fix a Merchant Center this server can't open, and reads again once they have", async () => {
    // The API's 503 not_configured: Composio or Google refused this server's setup (not_set_up).
    listSignInAccounts.mockResolvedValue({ ok: false, code: 'not_configured' });
    await render();
    expect(container.textContent).toContain(
      "Merchant Center isn't set up correctly on this server, or this Google account can't open Merchant Center. Ask whoever runs your GetCito server, or check the account's users in Merchant Center.",
    );
    listSignInAccounts.mockResolvedValue({ ok: true, accounts: [{ id: '123', name: 'Acme' }] });
    await act(async () => button('Try again')!.click());
    expect(options().map((o) => o.textContent)).toEqual(['', 'Acme (123)']);
  });

  it('says an advanced account holds no products when the sign-in opens more than one account', async () => {
    const advanced =
      "An advanced account that manages several stores holds no products itself: pick the store's own account (a sub-account).";
    await render();
    expect(container.textContent).toContain(advanced);

    listSignInAccounts.mockResolvedValue({ ok: true, accounts: [{ id: '123', name: 'Acme' }] });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).not.toContain(advanced);
  });

  it('has words of its own for each error it names', () => {
    for (const code of OWN_ERRORS) {
      expect(messages.settings.merchantCenter.errors).toHaveProperty(code);
    }
  });

  it('tells members who picks the account, in words of its own, and asks the API nothing', async () => {
    role.canManage = false;
    await render();
    expect(listSignInAccounts).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Admins and managers pick Acme's Merchant Center account.",
    );
    // The catalog card below says this one already.
    expect(container.textContent).not.toContain('Admins and managers can add and sync sources.');
  });

  it('adds no account on a read-only workspace: the pick opens the upgrade dialog', async () => {
    isLocked = true;
    await render();
    // The accounts still show.
    expect(options().map((o) => o.textContent)).toEqual(['', 'Acme Outdoor (123)', '456']);
    await pick('123');
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Connecting a store needs a plan');
    expect(select().value).toBe('');
    expect(button('Add account')!.disabled).toBe(true);
    expect(connectSignInAccount).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog, not a missing message, when the server says the plan has ended', async () => {
    connectSignInAccount.mockResolvedValue({ ok: false, code: 'subscription', message: null });
    await render();
    await pick('123');
    await act(async () => button('Add account')!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Connecting a store needs a plan');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    // The pick stays, to add it once there's a plan.
    expect(select().value).toBe('123');
  });
});
