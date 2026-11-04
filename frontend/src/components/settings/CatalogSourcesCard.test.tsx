import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { CatalogSource } from '@/lib/catalog';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { CatalogSourcesRead } from './CatalogSourcesCard';

const listCatalogSources = vi.fn();
const addFeedSource = vi.fn();
const removeCatalogSource = vi.fn();
vi.mock('@/lib/actions/catalog', () => ({
  listCatalogSources: (...args: unknown[]) => listCatalogSources(...args),
  addFeedSource: (...args: unknown[]) => addFeedSource(...args),
  removeCatalogSource: (...args: unknown[]) => removeCatalogSource(...args),
}));
const syncCatalogSource = vi.fn();
const uploadCatalogFile = vi.fn();
const listStoreConnectors = vi.fn();
const connectStore = vi.fn();
const updateStoreSignIn = vi.fn();
const removeStore = vi.fn();
vi.mock('@/lib/catalogClient', () => ({
  syncCatalogSource: (...args: unknown[]) => syncCatalogSource(...args),
  uploadCatalogFile: (...args: unknown[]) => uploadCatalogFile(...args),
  listStoreConnectors: (...args: unknown[]) => listStoreConnectors(...args),
  connectStore: (...args: unknown[]) => connectStore(...args),
  updateStoreSignIn: (...args: unknown[]) => updateStoreSignIn(...args),
  removeStore: (...args: unknown[]) => removeStore(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { CatalogSourcesCard } = await import('./CatalogSourcesCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Product catalog (#1263): a brand's feed URLs, uploads and stores. */

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

const FEED: CatalogSource = {
  id: 's1',
  kind: 'feed_url',
  format: 'auto',
  url: 'https://shop.example/feed.xml',
  account: null,
  label: null,
  lastSyncedAt: '2026-10-25T08:00:00Z',
  lastStatus: 'ok',
  lastError: null,
  lastCounts: {
    format: 'google_xml',
    items: 4,
    skipped: 1,
    errors: ['Item 2: price is missing.'],
    products: { added: 2, changed: 0, removed: 0, unchanged: 0 },
    variants: { added: 3, changed: 0, removed: 0, unchanged: 0 },
  },
  products: 2,
};

const STORE: CatalogSource = {
  ...FEED,
  id: 'st1',
  kind: 'acme_store',
  url: 'https://acme-shop.example',
  account: 'acme-shop.example',
  label: 'Acme Outdoor',
  lastStatus: 'auth_failed',
  lastError: 'The store refused the saved sign-in. Update it in Settings › Integrations.',
  lastCounts: null,
};

/** A Google Merchant Center account (#1270), named "Acme Outdoor" in Merchant Center. */
const GMC: CatalogSource = {
  ...FEED,
  id: 'gmc1',
  kind: 'merchant_center',
  url: 'https://merchants.google.com/mc/overview?a=123456789',
  account: '123456789',
  label: 'Acme Outdoor',
  lastCounts: {
    ...FEED.lastCounts!,
    skipped: 0,
    errors: [],
    issues: { items: 3, disapproved: 1, demoted: 2, not_impacted: 0 },
  },
  products: 40,
};
const GMC_SIGN_IN = {
  kind: 'merchant_center',
  label: 'Google Merchant Center',
  provider: 'google-merchant-center',
  configured: true,
};

const ACME = {
  kind: 'acme_store',
  label: 'Acme Store',
  fields: [
    {
      name: 'url',
      label: 'Store address',
      secret: false,
      placeholder: 'https://shop.example',
      help: null,
    },
    { name: 'apiKey', label: 'API key', secret: true, placeholder: null, help: 'Read-only key.' },
  ],
};

async function render({
  isLocked = false,
  refreshKey,
  onSources,
}: {
  isLocked?: boolean;
  refreshKey?: number;
  onSources?: (read: CatalogSourcesRead | null) => void;
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <CatalogSourcesCard refreshKey={refreshKey} onSources={onSources} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** The text of each source's row. */
const rows = () => [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
function remount() {
  act(() => root.unmount());
  root = createRoot(container);
}
const storeForm = () =>
  container.querySelector<HTMLFormElement>('form[aria-label="Acme Store sign-in"]');
async function fillAndSubmit(form: HTMLFormElement) {
  const [address, key] = [...form.querySelectorAll<HTMLInputElement>('input')];
  await type(address, 'https://acme-shop.example');
  await type(key, 'ak_secret');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  role.canManage = true;
  listCatalogSources.mockReset().mockResolvedValue([FEED]);
  addFeedSource.mockReset().mockResolvedValue({ ok: true, id: 's2' });
  removeCatalogSource.mockReset().mockResolvedValue(undefined);
  syncCatalogSource.mockReset().mockResolvedValue({
    ok: true,
    status: 'ok',
    error: null,
    counts: { items: 12 },
  });
  uploadCatalogFile.mockReset();
  listStoreConnectors.mockReset().mockResolvedValue({ connectors: [], ready: true, signIns: [] });
  connectStore.mockReset().mockResolvedValue({ ok: true });
  updateStoreSignIn.mockReset().mockResolvedValue({ ok: true });
  removeStore.mockReset().mockResolvedValue({ ok: true });
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

describe('CatalogSourcesCard', () => {
  it("lists the brand's sources with their products, status and skipped products", async () => {
    await render();
    expect(listCatalogSources).toHaveBeenCalledWith('b1');
    const text = container.textContent ?? '';
    expect(text).toContain("Where Acme's products come from");
    expect(text).toContain('https://shop.example/feed.xml');
    expect(text).toContain('Synced');
    expect(text).toContain('2 products');
    expect(text).toContain('1 product was skipped');
    expect(text).toContain('Item 2: price is missing.');
  });

  it('recommends the feed URL, read every day, and calls an upload one-off', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain(
      "RecommendedYour product feed's URL: read every day, so prices and stock stay current.",
    );
    expect(text).toContain('One-off: prices and stock stay as uploaded until you upload again.');
  });

  it("says when a file was uploaded, and that its prices and stock don't refresh", async () => {
    listCatalogSources.mockResolvedValue([
      { ...FEED, id: 's3', kind: 'upload', url: null, lastCounts: null },
    ]);
    await render();
    const row = container.querySelector('li')!.textContent ?? '';
    expect(row).toContain('Uploaded file');
    expect(row).toContain('Last uploaded');
    expect(row).toContain("prices and stock don't refresh by themselves");
    expect(row).not.toContain('Synced ');
  });

  it('adds a feed URL and reads it at once', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'https://shop.example/meta.csv');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(addFeedSource).toHaveBeenCalledWith('b1', 'https://shop.example/meta.csv');
    expect(syncCatalogSource).toHaveBeenCalledWith('s2');
    expect(toast.success).toHaveBeenCalledWith('12 products read');
    expect(listCatalogSources).toHaveBeenCalledTimes(2);
  });

  it('adds, syncs, uploads and removes nothing on a read-only workspace', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    openUpgrade.mockClear();
    await render({ isLocked: true });
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await type(input, 'https://shop.example/meta.csv');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding catalog sources needs a plan');
    await act(async () => button('Upload a file')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding catalog sources needs a plan');
    await act(async () => button('Sync now')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Syncing the catalog needs a plan');
    await act(async () => button('Remove')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing catalog sources needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(4);
    expect(confirm).not.toHaveBeenCalled();
    expect(addFeedSource).not.toHaveBeenCalled();
    expect(syncCatalogSource).not.toHaveBeenCalled();
    expect(removeCatalogSource).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('still removes a store on a read-only workspace (a disconnect), but not a feed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    openUpgrade.mockClear();
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true, signIns: [] });
    listCatalogSources.mockResolvedValue([FEED, STORE]);
    await render({ isLocked: true });
    const removeIn = (text: string) =>
      [...container.querySelectorAll('li')]
        .find((li) => li.textContent?.includes(text))!
        .querySelector<HTMLButtonElement>('button[aria-label="Remove"]')!;

    await act(async () => removeIn('acme-shop.example').click());
    expect(removeStore).toHaveBeenCalledWith('st1');
    expect(openUpgrade).not.toHaveBeenCalled();

    await act(async () => removeIn('https://shop.example/feed.xml').click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Removing catalog sources needs a plan');
    expect(removeCatalogSource).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("says why a feed couldn't be added, or read", async () => {
    addFeedSource.mockResolvedValue({ ok: false, code: 'duplicate' });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'https://shop.example/feed.xml');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(toast.error).toHaveBeenCalledWith('This feed is already a source.');
    expect(syncCatalogSource).not.toHaveBeenCalled();

    syncCatalogSource.mockResolvedValue({
      ok: true,
      status: 'format_error',
      error: "This isn't a Google product feed: it has no <rss> or <feed> element.",
      counts: null,
    });
    await act(async () => button('Sync now')!.click());
    expect(toast.error).toHaveBeenLastCalledWith(
      "This isn't a Google product feed: it has no <rss> or <feed> element.",
    );
  });

  it("says how many products the plan's cap left out, with Upgrade for managers (ECOM-019)", async () => {
    // Starter's cap (5,000).
    const capped = { ...FEED, lastCounts: { ...FEED.lastCounts!, overLimit: 1240, limit: 5000 } };
    listCatalogSources.mockResolvedValue([capped]);
    await render();
    expect(container.textContent).toContain(
      "1,240 products aren't in the catalog: your plan tracks up to 5,000 products across your brands. Upgrade",
    );
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')?.textContent).toBe(
      'Upgrade',
    );
    act(() => root.unmount());
    root = createRoot(container);
    role.canManage = false;
    await render();
    expect(container.textContent).toContain("1,240 products aren't in the catalog");
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')).toBeNull();
  });

  it("shows the sources, not to change, to members who aren't admins or managers", async () => {
    role.canManage = false;
    await render();
    expect(container.textContent).toContain('https://shop.example/feed.xml');
    expect(container.textContent).toContain('Admins and managers can add and sync sources.');
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(button('Sync now')).toBeUndefined();
    expect(button('Remove')).toBeUndefined();
  });

  it('offers no store when the API has no store connectors', async () => {
    await render();
    expect(container.textContent).not.toContain('Connect a store');
  });

  it('connects a store with the fields its connector asks for, the secret one hidden', async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true, signIns: [] });
    await render();
    expect(container.textContent).toContain('Connect a store');
    await act(async () => button('Connect Acme Store')!.click());
    const form = storeForm()!;
    const inputs = [...form.querySelectorAll<HTMLInputElement>('input')];
    expect(inputs.map((i) => i.type)).toEqual(['text', 'password']);
    expect(form.textContent).toContain('Read-only key.');
    await fillAndSubmit(form);
    expect(connectStore).toHaveBeenCalledWith('b1', 'acme_store', {
      url: 'https://acme-shop.example',
      apiKey: 'ak_secret',
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Acme Store connected. Its products are being read.',
    );
    expect(storeForm()).toBeNull();
    expect(listCatalogSources).toHaveBeenCalledTimes(2);
  });

  it("shows the store's own words when it couldn't connect, and keeps the form", async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true, signIns: [] });
    connectStore.mockResolvedValue({
      ok: false,
      code: 'connect_failed',
      message: "That isn't a web address.",
    });
    await render();
    await act(async () => button('Connect Acme Store')!.click());
    await fillAndSubmit(storeForm()!);
    expect(toast.error).toHaveBeenCalledWith("That isn't a web address.");
    expect(storeForm()).not.toBeNull();
  });

  it("says the server can't keep a sign-in yet, instead of offering the stores", async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: false, signIns: [] });
    await render();
    expect(container.textContent).toContain("Store connections aren't set up on this server yet.");
    expect(button('Connect Acme Store')).toBeUndefined();
  });

  it('names a store by its platform and account, replaces its sign-in, and removes it through the API', async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true, signIns: [] });
    listCatalogSources.mockResolvedValue([STORE]);
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Acme Store · acme-shop.example');
    expect(text).toContain('Sign-in refused');
    expect(text).toContain('The store refused the saved sign-in.');
    expect(button('Sync now')).toBeDefined();

    await act(async () => button('Update sign-in')!.click());
    await fillAndSubmit(storeForm()!);
    expect(updateStoreSignIn).toHaveBeenCalledWith('st1', {
      url: 'https://acme-shop.example',
      apiKey: 'ak_secret',
    });
    expect(toast.success).toHaveBeenCalledWith('Sign-in saved. The products are being read again.');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('Remove')!.click());
    expect(removeStore).toHaveBeenCalledWith('st1');
    expect(removeCatalogSource).not.toHaveBeenCalled();
  });

  it('names a Merchant Center account by its name and id, with its items that have issues (#1270)', async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [], ready: true, signIns: [GMC_SIGN_IN] });
    listCatalogSources.mockResolvedValue([GMC]);
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Google Merchant Center · Acme Outdoor (123456789)');
    expect(text).toContain('40 products · 3 with issues · synced');
    // Its sign-in is the workspace's Google one: there's none to update here.
    expect(button('Update sign-in')).toBeUndefined();
    expect(button('Sync now')).toBeDefined();
  });

  it("names a Merchant Center account by its platform when the API's connectors can't be read or don't list it", async () => {
    listCatalogSources.mockResolvedValue([GMC]);
    listStoreConnectors.mockResolvedValue(null);
    await render();
    expect(rows()[0]).toContain('Google Merchant Center · Acme Outdoor (123456789)');
    expect(rows()[0]).not.toContain('Acme Outdoor · 123456789');

    // An API that doesn't list its sign-in platforms (yet).
    listStoreConnectors.mockResolvedValue({ connectors: [], ready: true, signIns: [] });
    remount();
    await render();
    expect(rows()[0]).toContain('Google Merchant Center · Acme Outdoor (123456789)');
  });

  it('says one item with an issue, and nothing of issues when there are none or no counts yet', async () => {
    listCatalogSources.mockResolvedValue([
      {
        ...GMC,
        lastCounts: {
          ...GMC.lastCounts!,
          issues: { items: 1, disapproved: 0, demoted: 1, not_impacted: 0 },
        },
      },
      {
        ...GMC,
        id: 'gmc2',
        account: '222',
        products: 12,
        lastCounts: {
          ...GMC.lastCounts!,
          issues: { items: 0, disapproved: 0, demoted: 0, not_impacted: 0 },
        },
      },
      { ...GMC, id: 'gmc3', account: '333', products: 5, lastCounts: null },
    ]);
    await render();
    const [one, none, unread] = rows();
    expect(one).toContain('40 products · 1 with an issue · synced');
    expect(none).toContain('12 products · synced');
    expect(none).not.toContain('with');
    expect(unread).toContain('5 products · synced');
    expect(unread).not.toContain('with');
  });

  it('says how many listings were read again and kept once, only when there are some (#1270)', async () => {
    listCatalogSources.mockResolvedValue([
      { ...GMC, lastCounts: { ...GMC.lastCounts!, repeated: 2 } },
      { ...GMC, id: 'gmc2', account: '222', lastCounts: { ...GMC.lastCounts!, repeated: 1 } },
      { ...GMC, id: 'gmc3', account: '333', lastCounts: { ...GMC.lastCounts!, repeated: 0 } },
      // A sync from before it was counted.
      { ...GMC, id: 'gmc4', account: '444' },
    ]);
    await render();
    const [two, one, none, before] = rows();
    expect(two).toContain('40 products · 3 with issues · 2 listed again, kept once · synced');
    expect(one).toContain('3 with issues · 1 listed again, kept once · synced');
    expect(none).toContain('40 products · 3 with issues · synced');
    expect(before).toContain('40 products · 3 with issues · synced');
  });

  it("says when a source's workspace sign-in isn't connected anymore", async () => {
    listCatalogSources.mockResolvedValue([GMC]);
    removeStore.mockResolvedValue({ ok: false, code: 'not_connected', message: null });
    await render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('Remove')!.click());
    expect(removeStore).toHaveBeenCalledWith('gmc1');
    expect(toast.error).toHaveBeenCalledWith(
      "The workspace sign-in this source is read with isn't connected anymore. Connect it again above.",
    );
  });

  it('reads the sources again when the page asks (an account added above)', async () => {
    await render({ refreshKey: 0 });
    expect(listCatalogSources).toHaveBeenCalledTimes(1);
    await render({ refreshKey: 1 });
    expect(listCatalogSources).toHaveBeenCalledTimes(2);
  });

  it('tells the page what it read, for the brand', async () => {
    const onSources = vi.fn();
    await render({ refreshKey: 0, onSources });
    expect(onSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ brandId: 'b1', sources: [FEED] }),
    );
  });

  it("says the sources can't be read once a read takes too long, instead of a lasting skeleton", async () => {
    vi.useFakeTimers();
    try {
      listCatalogSources.mockReturnValue(new Promise(() => {}));
      const onSources = vi.fn();
      await render({ onSources });
      expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
      await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
      expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
      expect(container.textContent).toContain("Couldn't read the catalog's sources right now.");
      expect(onSources).toHaveBeenLastCalledWith(
        expect.objectContaining({ brandId: 'b1', sources: null }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
