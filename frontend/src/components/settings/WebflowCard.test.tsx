import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { WebflowConnection } from '@/lib/webflowClient';

const client = vi.hoisted(() => ({
  readWebflow: vi.fn(),
  connectWebflow: vi.fn(),
  listWebflowCollections: vi.fn(),
  readWebflowCollection: vi.fn(),
  saveWebflowSettings: vi.fn(),
  disconnectWebflow: vi.fn(),
}));
vi.mock('@/lib/webflowClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webflowClient')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
// The demo brand on screen, when a test says.
const demo = vi.hoisted(() => ({ on: false }));
vi.mock('@/components/context/DemoBrandProvider', () => ({
  useDemoBrand: () => ({ isDemo: demo.on }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// The read-only workspace's upgrade dialog.
const openUpgrade = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ isLocked: false }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({
    isLocked: gate.isLocked,
    openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        gate.isLocked ? openUpgrade(options.action) : fn(...args),
  }),
}));

const { WebflowCard } = await import('./WebflowCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Webflow (Send to CMS #1331, phase 2): a brand's site, collection and fields. */

let container: HTMLDivElement;
let root: Root;

const CONNECTED: WebflowConnection = {
  status: 'connected',
  siteId: 's1',
  siteName: 'Acme',
  collectionId: 'c1',
  collectionName: 'Blog Posts',
  fieldMap: { body: 'post-body', metaDescription: 'post-summary' },
  connectedAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
};
const FIELDS = [
  { slug: 'name', name: 'Name', type: 'PlainText', required: true },
  { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
  { slug: 'post-summary', name: 'Post Summary', type: 'PlainText', required: false },
];

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WebflowCard />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
/** The select a label names. */
const picker = (label: string) => {
  const name = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
  return container.querySelector(`[id="${name!.htmlFor}"]`)!;
};
/** The badges by the card's title. */
const badges = () =>
  [...container.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent);
const SETUP_STEP =
  "Last step: pick the collection your pages go to, check which field takes what, then Save. Pages can't be sent to Webflow until then.";
const SETUP_STEP_SITE =
  "Last step: pick the site and the collection your pages go to, check which field takes what, then Save. Pages can't be sent to Webflow until then.";
const option = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent === text,
  );
async function typeToken(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  role.canManage = true;
  gate.isLocked = false;
  openUpgrade.mockClear();
  client.readWebflow
    .mockReset()
    .mockResolvedValue({ ok: true, configured: true, connection: null });
  client.connectWebflow.mockReset().mockResolvedValue({
    ok: true,
    connection: { ...CONNECTED, collectionId: null, collectionName: null, fieldMap: {} },
    sites: [],
  });
  client.listWebflowCollections.mockReset().mockResolvedValue({
    ok: true,
    sites: [{ id: 's1', name: 'Acme' }],
    siteId: 's1',
    collections: [{ id: 'c1', name: 'Blog Posts', slug: 'post' }],
  });
  client.readWebflowCollection.mockReset().mockResolvedValue({
    ok: true,
    id: 'c1',
    name: 'Blog Posts',
    fields: FIELDS,
    suggested: { body: 'post-body' },
  });
  client.saveWebflowSettings.mockReset().mockResolvedValue({ ok: true, connection: CONNECTED });
  client.disconnectWebflow.mockReset().mockResolvedValue({ ok: true, success: true });
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('WebflowCard', () => {
  it('says when this server has no Webflow set up', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: false, connection: null });
    await render();
    expect(container.textContent).toContain("Webflow isn't set up on this server yet.");
    expect(container.querySelector('input')).toBeNull();
  });

  it('connects the brand’s site with a pasted token, then asks where pages go', async () => {
    await render();
    expect(client.readWebflow).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain(
      "Send to CMS puts Acme's pages in a Webflow collection",
    );
    await typeToken('  wf-token-123  ');
    expect(client.connectWebflow).toHaveBeenCalledWith('b1', 'wf-token-123');
    expect(toast.success).toHaveBeenCalledWith(
      'Webflow connected. Now pick a collection and save.',
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(client.listWebflowCollections).toHaveBeenCalledWith('b1', 's1');
    // The setup's last step: the collection picker, focused.
    expect(document.activeElement).toBe(picker('Collection'));
  });

  it('asks for the site first when the token reaches several, and focuses its picker (#1601)', async () => {
    client.connectWebflow.mockResolvedValue({
      ok: true,
      connection: {
        ...CONNECTED,
        siteId: null,
        collectionId: null,
        collectionName: null,
        fieldMap: {},
      },
      sites: [],
    });
    client.listWebflowCollections.mockImplementation(async (_brand: string, siteId?: string) => ({
      ok: true,
      sites: [
        { id: 's1', name: 'Acme' },
        { id: 's2', name: 'Acme Shop' },
      ],
      siteId: siteId ?? null,
      collections: siteId ? [{ id: 'c1', name: 'Blog Posts', slug: 'post' }] : [],
    }));
    await render();
    await typeToken('wf-token-123');
    expect(toast.success).toHaveBeenCalledWith(
      'Webflow connected. Now pick the site and the collection, and save.',
    );
    expect(container.textContent).toContain(SETUP_STEP_SITE);
    expect(document.activeElement).toBe(picker('Site'));

    await click(picker('Site'));
    const shop = option('Acme Shop')!;
    await act(async () => {
      shop.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(shop);
    expect(client.listWebflowCollections).toHaveBeenLastCalledWith('b1', 's2');
    // The site picked, the line asks for the collection alone.
    expect(container.textContent).toContain(SETUP_STEP);
  });

  it('asks for the site while the sites are read, not for the collection alone first (#1601)', async () => {
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: {
        ...CONNECTED,
        siteId: null,
        collectionId: null,
        collectionName: null,
        fieldMap: {},
      },
    });
    let answer!: (value: unknown) => void;
    client.listWebflowCollections.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    expect(container.textContent).toContain("Reading the site's collections…");
    expect(container.textContent).toContain(SETUP_STEP_SITE);
    expect(container.textContent).not.toContain(SETUP_STEP);

    await act(async () => {
      answer({
        ok: true,
        sites: [
          { id: 's1', name: 'Acme' },
          { id: 's2', name: 'Acme Shop' },
        ],
        siteId: null,
        collections: [],
      });
    });
    expect(container.textContent).toContain(SETUP_STEP_SITE);
    expect(container.textContent).not.toContain(SETUP_STEP);
  });

  it('says the setup isn’t finished until a collection is saved', async () => {
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, collectionId: null, collectionName: null, fieldMap: {} },
    });
    await render();
    expect(badges()).toEqual(['Setup not finished']);
    expect(container.textContent).toContain(SETUP_STEP);
    // Read on opening the page, the picker isn't focused: only right after connecting.
    expect(document.activeElement).not.toBe(picker('Collection'));

    await click(picker('Collection'));
    const blog = option('Blog Posts')!;
    await act(async () => {
      blog.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(blog);
    expect(container.textContent).toContain(SETUP_STEP);
    await click(button('Save'));
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c1',
      fieldMap: { body: 'post-body' },
    });
    expect(badges()).toEqual(['Connected']);
    expect(container.textContent).not.toContain(SETUP_STEP);
  });

  it('keeps the setup a new token for the same site keeps', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.connectWebflow.mockResolvedValue({ ok: true, connection: CONNECTED, sites: [] });
    await render();
    expect(badges()).toEqual(['Connected']);
    expect(container.textContent).not.toContain(SETUP_STEP);
    await click(button('Replace token'));
    await typeToken('wf-token-456');
    expect(toast.success).toHaveBeenCalledWith('Webflow connected');
    expect(badges()).toEqual(['Connected']);
    expect(document.activeElement).not.toBe(picker('Collection'));
  });

  it('says how to make the token, step by step above its field, and that it’s shown once', async () => {
    await render();
    const steps = container.querySelector('ol[aria-label="How to get a site token"]')!;
    expect([...steps.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'In Webflow, go to Site settings › Apps & Integrations › API access and click Generate API token.',
      'Enter a token name (4–80 characters), e.g. “GetCito connector”.',
      'Under Permissions, set CMS to Read and write and Sites to Read-only. Leave everything else on No access.',
      'Click Generate token, copy the token and paste it into the field below.',
    ]);
    const field = container.querySelector('input[type="password"]')!;
    expect(steps.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const described = field.getAttribute('aria-describedby')!.split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      steps.textContent,
      'Webflow shows the token only once. We store it securely and won’t display it again.',
    ]);
  });

  it('says why a token wasn’t taken, and keeps the form', async () => {
    client.connectWebflow.mockResolvedValue({ ok: false, code: 'missing_scopes' });
    await render();
    await typeToken('wf-token');
    expect(toast.error).toHaveBeenCalledWith(
      'The token needs CMS: Read and write and Sites: Read-only. Generate a new one with them.',
    );
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('asks for a new token when Webflow refused the saved one', async () => {
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, status: 'auth_failed' },
    });
    await render();
    expect(container.textContent).toContain('Token refused');
    expect(container.textContent).toContain('Webflow refused the saved token.');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('reads the saved collection’s fields with its map, and saves it', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(client.readWebflowCollection).toHaveBeenCalledWith('b1', 'c1', 's1');
    expect(container.textContent).toContain('Which field takes what');
    await act(async () => {
      button('Save')!.click();
    });
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c1',
      fieldMap: { body: 'post-body', metaDescription: 'post-summary' },
    });
    expect(toast.success).toHaveBeenCalledWith('Saved. Pages go to Blog Posts.');
  });

  it('gives a Webflow date field the day a page is first sent', async () => {
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, fieldMap: { body: 'post-body', date: 'date' } },
    });
    client.readWebflowCollection.mockResolvedValue({
      ok: true,
      id: 'c1',
      name: 'Blog Posts',
      fields: [...FIELDS, { slug: 'date', name: 'Date', type: 'DateTime', required: true }],
      suggested: { body: 'post-body', date: 'date' },
    });
    await render();
    expect(picker("Date (the day it's first sent)").textContent).toContain('Date (required)');
    expect(container.textContent).toContain(
      'The date field gets the day a page first goes to Webflow.',
    );
    await click(button('Save'));
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c1',
      fieldMap: { body: 'post-body', date: 'date' },
    });
  });

  it('lists what doesn’t fit when a map is refused', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.saveWebflowSettings.mockResolvedValue({
      ok: false,
      code: 'invalid_map',
      problems: ['The collection requires Category, which Send to CMS doesn’t fill'],
    });
    await render();
    await act(async () => {
      button('Save')!.click();
    });
    expect(toast.error).toHaveBeenCalledWith("The fields don't fit the collection.");
    expect(container.textContent).toContain('The collection requires Category');
  });

  it('shows a member where pages go, without the token or the settings', async () => {
    role.canManage = false;
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(container.textContent).toContain('Pages go to Blog Posts.');
    expect(container.querySelector('input')).toBeNull();
    expect(button('Disconnect')).toBeUndefined();
    expect(client.listWebflowCollections).not.toHaveBeenCalled();

    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: null });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain('Admins and managers can connect Webflow.');

    // Connected, no collection saved: pages can't go yet.
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, collectionId: null, collectionName: null, fieldMap: {} },
    });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(badges()).toEqual(['Setup not finished']);
    expect(container.textContent).toContain(
      "No collection picked yet. Pages can't go to Webflow until an admin or manager finishes the setup.",
    );
    expect(container.textContent).not.toContain(SETUP_STEP);
  });

  it('disconnects after asking', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    await act(async () => {
      button('Disconnect')!.click();
    });
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    await act(async () => {
      confirm[confirm.length - 1].click();
    });
    expect(client.disconnectWebflow).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith('Webflow disconnected');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('opens the upgrade dialog, not an error, for a read-only workspace', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.disconnectWebflow.mockResolvedValue({ ok: false, code: 'subscription' });
    openUpgrade.mockClear();
    await render();
    await act(async () => {
      button('Disconnect')!.click();
    });
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    await act(async () => {
      confirm[confirm.length - 1].click();
    });
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on a read-only workspace, connects and saves nothing, and still disconnects', async () => {
    gate.isLocked = true;
    await render();
    await typeToken('wf-token-123');
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(client.connectWebflow).not.toHaveBeenCalled();

    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Save'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Saving the CMS settings needs a plan');
    expect(client.saveWebflowSettings).not.toHaveBeenCalled();
    await click(button('Replace token'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(container.querySelector('input[type="password"]')).toBeNull();

    await act(async () => {
      button('Disconnect')!.click();
    });
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    await act(async () => {
      confirm[confirm.length - 1].click();
    });
    expect(client.disconnectWebflow).toHaveBeenCalledWith('b1');
    expect(openUpgrade).toHaveBeenCalledTimes(3);
  });

  it('gives another collection its own suggested map, not the saved one', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.listWebflowCollections.mockResolvedValue({
      ok: true,
      sites: [{ id: 's1', name: 'Acme' }],
      siteId: 's1',
      collections: [
        { id: 'c1', name: 'Blog Posts', slug: 'post' },
        { id: 'c2', name: 'Guides', slug: 'guide' },
      ],
    });
    await render();
    client.readWebflowCollection.mockResolvedValue({
      ok: true,
      id: 'c2',
      name: 'Guides',
      fields: FIELDS,
      suggested: { body: 'post-body' },
    });
    await click(picker('Collection'));
    // Base UI picks the highlighted option: the pointer moves onto it first.
    const guides = option('Guides')!;
    await act(async () => {
      guides.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(guides);
    expect(client.readWebflowCollection).toHaveBeenLastCalledWith('b1', 'c2', 's1');
    await click(button('Save'));
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c2',
      fieldMap: { body: 'post-body' },
    });
  });

  it('doesn’t save when the collection’s fields couldn’t be read', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.readWebflowCollection.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the collection's fields right now.");
    expect(button('Save')!.disabled).toBe(true);
  });

  it('says the collections couldn’t be read, not that there are none', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.listWebflowCollections.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the site's collections right now.");
    expect(container.textContent).not.toContain('This site has no CMS collections.');
  });

  it('reads the connection again when Webflow refuses its token, and asks for a new one', async () => {
    client.readWebflow
      .mockResolvedValueOnce({ ok: true, configured: true, connection: CONNECTED })
      .mockResolvedValue({
        ok: true,
        configured: true,
        connection: { ...CONNECTED, status: 'auth_failed' },
      });
    client.listWebflowCollections.mockResolvedValue({ ok: false, code: 'auth_failed' });
    await render();
    await act(async () => {});
    expect(client.readWebflow).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Webflow refused the saved token.');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('replaces the token, or goes back to the settings', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    await click(button('Replace token'));
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(button('Replace token')).toBeUndefined();
    await click(button('Cancel'));
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain('Which field takes what');
  });

  it('saves only what the pickers show, a field deleted in Webflow since left out', async () => {
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, fieldMap: { body: 'post-body', metaTitle: 'seo-title-gone' } },
    });
    await render();
    await click(button('Save'));
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c1',
      fieldMap: { body: 'post-body' },
    });
  });

  it('names a refused map’s parts by their labels, read out', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.saveWebflowSettings.mockResolvedValue({
      ok: false,
      code: 'invalid_map',
      problems: ['metaTitle: the collection has no field "x"', 'The collection requires Category'],
    });
    await render();
    await click(button('Save'));
    const list = container.querySelector('ul[role="alert"]')!;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Meta title: the collection has no field "x"',
      'The collection requires Category',
    ]);
  });

  it('tells a member that pages can’t go while the token is refused', async () => {
    role.canManage = false;
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, status: 'auth_failed' },
    });
    await render();
    expect(container.textContent).toContain(
      "Webflow refused the token. Pages can't go there until an admin or manager pastes a new one.",
    );
    expect(container.textContent).not.toContain('Pages go to Blog Posts.');
  });
});

describe('WebflowCard on the demo brand', () => {
  beforeEach(() => {
    demo.on = true;
    gate.isLocked = true;
  });
  afterEach(() => {
    demo.on = false;
    gate.isLocked = false;
  });

  it('shows the site connected with sample data, and where pages go, read from nowhere', async () => {
    await render();
    expect(badges()).toEqual(['Connected', 'Sample data']);
    expect(container.textContent).toContain('Acme');
    expect(container.textContent).toContain('Blog Posts');
    expect(client.readWebflow).not.toHaveBeenCalled();
    expect(client.listWebflowCollections).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('opens the plan dialog from Replace token and Disconnect', async () => {
    await render();
    await click(button('Replace token'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    await click(button('Disconnect'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Disconnecting an integration needs a plan');
    expect(client.disconnectWebflow).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
