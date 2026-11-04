import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { FramerCollection, FramerConnection, FramerError } from '@/lib/framerClient';

const client = vi.hoisted(() => ({
  readFramer: vi.fn(),
  connectFramer: vi.fn(),
  readFramerCollections: vi.fn(),
  saveFramerTarget: vi.fn(),
  disconnectFramer: vi.fn(),
}));
vi.mock('@/lib/framerClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/framerClient')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
const store = vi.hoisted(() => ({ activeBrandId: 'b1' }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: () => ({
    activeBrandId: store.activeBrandId,
    brands: [
      { id: 'b1', name: 'Acme' },
      { id: 'b2', name: 'Beta' },
    ],
  }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
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

const { FramerCard } = await import('./FramerCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Framer (Send to CMS #1331, phase 2; 00295): a brand's project, collection and fields. */

// Every reason the client names has its words: a missing one fails typecheck. A read-only
// workspace's refusal opens the upgrade dialog instead.
const ERROR_TEXTS: Record<Exclude<FramerError, 'subscription'>, string> = messages.settings.framer
  .errors;
const TEXT = messages.settings.framer;

let container: HTMLDivElement;
let root: Root;

const PROJECT_ID = 'abcdefghij0123456789';
const KEY = 'fr_live_key_0123456789';
const CONNECTED: FramerConnection = {
  status: 'connected',
  projectId: PROJECT_ID,
  projectName: 'Acme Site',
  siteUrl: 'https://acme.framer.website',
  account: 'Jane Doe',
  collectionId: 'c1',
  collectionName: 'Blog',
  fieldMap: { title: 'f-title', body: 'f-content', metaDescription: 'f-summary' },
  connectedAt: '2026-10-27T10:00:00Z',
  updatedAt: '2026-10-27T10:00:00Z',
};
const BLOG: FramerCollection = {
  id: 'c1',
  name: 'Blog',
  titleField: 'f-title',
  fields: [
    { id: 'f-title', name: 'Title', type: 'string', required: true },
    { id: 'f-content', name: 'Content', type: 'formattedText', required: false },
    { id: 'f-summary', name: 'Summary', type: 'string', required: false },
    { id: 'f-cover', name: 'Cover', type: 'image', required: false },
    { id: 'f-seo', name: 'SEO Title', type: 'string', required: false },
  ],
};
const NEWS: FramerCollection = {
  id: 'c2',
  name: 'News',
  titleField: 'n-headline',
  fields: [
    { id: 'n-headline', name: 'Headline', type: 'string', required: true },
    { id: 'n-body', name: 'Body', type: 'formattedText', required: false },
    { id: 'n-excerpt', name: 'Excerpt', type: 'string', required: false },
  ],
};
const EVENTS: FramerCollection = {
  id: 'c3',
  name: 'Events',
  titleField: 'e-title',
  fields: [
    { id: 'e-title', name: 'Title', type: 'string', required: true },
    { id: 'e-body', name: 'Details', type: 'formattedText', required: false },
    { id: 'e-date', name: 'Date', type: 'date', required: true },
  ],
};

const NOTES: FramerCollection = {
  id: 'c4',
  name: 'Notes',
  titleField: 'x-title',
  fields: [
    { id: 'x-title', name: 'Title', type: 'string', required: false },
    { id: 'x-text', name: 'Text', type: 'string', required: false },
  ],
};

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <FramerCard />
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
/** The input or select a label names. */
const field = (label: string) => {
  const name = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
  return container.querySelector<HTMLInputElement>(`[id="${name!.htmlFor}"]`)!;
};
async function type(label: string, value: string) {
  const input = field(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const submit = async () => {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};
/** Opens the select a label names, and reads its own options (a closed one's stay mounted). */
async function open(label: string) {
  const trigger = field(label);
  await click(trigger);
  const list = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  return [...list.querySelectorAll<HTMLElement>('[role="option"]')];
}
const texts = (options: HTMLElement[]) => options.map((o) => o.textContent);
/** The badges by the card's title. */
const badges = () =>
  [...container.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent);
/** Connected to a project, with no collection saved yet. */
const NO_COLLECTION: FramerConnection = {
  ...CONNECTED,
  collectionId: null,
  collectionName: null,
  fieldMap: {},
};
const close = async () => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
};
/** Opens a select and picks one of its options. */
async function pick(label: string, text: string) {
  const option = (await open(label)).find((o) => o.textContent === text)!;
  // Base UI picks the highlighted option: the pointer moves onto it first.
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
  await click(option);
}
/** The texts an element's aria-describedby names, in order. */
const described = (el: Element) =>
  el
    .getAttribute('aria-describedby')!
    .split(' ')
    .map((id) => document.getElementById(id)!.textContent);
const connectedWith = (connection: FramerConnection | null) =>
  client.readFramer.mockResolvedValue({ ok: true, configured: true, connection });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  role.canManage = true;
  store.activeBrandId = 'b1';
  gate.isLocked = false;
  openUpgrade.mockReset();
  for (const fn of Object.values(client)) fn.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  connectedWith(null);
  client.readFramerCollections.mockResolvedValue({ ok: true, collections: [BLOG, NEWS, EVENTS] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('FramerCard', () => {
  it('connects the project with an API key, never keeping the key, then asks where pages go', async () => {
    client.connectFramer.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(client.readFramer).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain(
      "Send to CMS puts Acme's pages in a Framer CMS collection as draft items.",
    );
    expect(container.textContent).toContain('Site Settings › General');
    const key = field('API key');
    expect(key.type).toBe('password');
    expect(key.autocomplete).toBe('new-password');
    expect(key.getAttribute('spellcheck')).toBe('false');
    await type('Project address', ` https://framer.com/projects/Acme--${PROJECT_ID} `);
    await type('API key', ` ${KEY} `);
    await submit();
    expect(client.connectFramer).toHaveBeenCalledWith('b1', {
      project: `https://framer.com/projects/Acme--${PROJECT_ID}`,
      apiKey: KEY,
    });
    expect(toast.success).toHaveBeenCalledWith('Framer connected');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain(
      'Project: Acme Site · published at https://acme.framer.website · key acts as Jane Doe',
    );
    expect(client.readFramerCollections).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain('Pages go to Blog as draft items.');
  });

  it('leaves the collection for last on connecting a project, its picker focused', async () => {
    client.connectFramer.mockResolvedValue({ ok: true, connection: NO_COLLECTION });
    await render();
    await type('Project address', `https://framer.com/projects/Acme--${PROJECT_ID}`);
    await type('API key', KEY);
    await submit();
    expect(toast.success).toHaveBeenCalledWith('Framer connected. Now pick a collection and save.');
    expect(badges()).toEqual(['Setup not finished']);
    expect(container.textContent).toContain(TEXT.setupStep);
    // The setup's last step: the collection picker, focused.
    expect(document.activeElement).toBe(field('Collection'));
  });

  it('says the setup isn’t finished until a collection is saved', async () => {
    connectedWith(NO_COLLECTION);
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(badges()).toEqual(['Setup not finished']);
    expect(container.textContent).toContain(TEXT.setupStep);
    // Read on opening the page, the picker isn't focused: only right after connecting.
    expect(document.activeElement).not.toBe(field('Collection'));

    await pick('Collection', 'Blog');
    expect(container.textContent).toContain(TEXT.setupStep);
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        collectionId: 'c1',
      }),
    );
    expect(badges()).toEqual(['Connected']);
    expect(container.textContent).not.toContain(TEXT.setupStep);
    expect(container.textContent).toContain('Pages go to Blog as draft items.');
  });

  it('keeps the setup a new key for the same project keeps', async () => {
    connectedWith(CONNECTED);
    client.connectFramer.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(badges()).toEqual(['Connected']);
    await click(button('Replace key'));
    await type('API key', KEY);
    await submit();
    expect(toast.success).toHaveBeenCalledWith('Framer connected');
    expect(badges()).toEqual(['Connected']);
    expect(container.textContent).not.toContain(TEXT.setupStep);
    expect(document.activeElement).not.toBe(field('Collection'));
  });

  it('keeps Connect off until both are filled, and stops a key too short to be one', async () => {
    await render();
    expect(button('Connect')!.disabled).toBe(true);
    await type('Project address', PROJECT_ID);
    expect(button('Connect')!.disabled).toBe(true);
    await type('API key', 'fr_12');
    expect(button('Connect')!.disabled).toBe(true);
    expect(container.textContent).toContain(TEXT.keyShort);
    // Read out with the field: the hint, and why the key won't do.
    expect(described(field('API key'))).toEqual([TEXT.keyHint, TEXT.keyShort]);
    expect(described(field('Project address'))).toEqual([TEXT.keyHint]);
    expect(TEXT.keyHint).toContain('or its id');
    await type('API key', KEY);
    expect(button('Connect')!.disabled).toBe(false);
    expect(container.textContent).not.toContain(TEXT.keyShort);
    expect(described(field('API key'))).toEqual([TEXT.keyHint]);
    await type('Project address', '  ');
    expect(button('Connect')!.disabled).toBe(true);
    await submit();
    expect(client.connectFramer).not.toHaveBeenCalled();
  });

  it('says why Framer didn’t take it, in our words, and keeps what was typed', async () => {
    client.connectFramer.mockResolvedValue({ ok: false, code: 'no_access' });
    await render();
    await type('Project address', PROJECT_ID);
    await type('API key', KEY);
    await submit();
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.no_access);
    expect(field('Project address').value).toBe(PROJECT_ID);
    expect(field('API key').value).toBe(KEY);

    client.connectFramer.mockResolvedValue({ ok: false, code: 'invalid' });
    await submit();
    expect(toast.error).toHaveBeenLastCalledWith(TEXT.errors.invalidConnect);
  });

  it('reads the saved collection with its map, offers each part only fields of its type, and saves', async () => {
    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(container.textContent).toContain('Which field takes what');
    // Strings only, and not one another part takes (Summary is the meta description's).
    expect(texts(await open('Title'))).toEqual(['Title (required)', 'SEO Title']);
    await close();
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledWith('b1', {
      collectionId: 'c1',
      fieldMap: { title: 'f-title', body: 'f-content', metaDescription: 'f-summary' },
    });
    expect(toast.success).toHaveBeenCalledWith('Saved. Pages go to Blog.');
  });

  it('gives another collection its own suggested map, not the saved one', async () => {
    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    await pick('Collection', 'News');
    expect(texts(await open('Page content (formatted text)'))).toEqual(['Body']);
    await close();
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledWith('b1', {
      collectionId: 'c2',
      fieldMap: { title: 'n-headline', body: 'n-body', metaDescription: 'n-excerpt' },
    });
  });

  it('gives the saved collection its saved map back, not a suggested one', async () => {
    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    await pick('Collection', 'News');
    await pick('Collection', 'Blog');
    await click(button('Save'));
    // Blog's suggestion would add SEO Title as the meta title.
    expect(client.saveFramerTarget).toHaveBeenCalledWith('b1', {
      collectionId: 'c1',
      fieldMap: { title: 'f-title', body: 'f-content', metaDescription: 'f-summary' },
    });
  });

  it('marks a collection with no formatted text field, says why, and won’t save it', async () => {
    connectedWith(CONNECTED);
    client.readFramerCollections.mockResolvedValue({ ok: true, collections: [BLOG, NOTES] });
    await render();
    expect(texts(await open('Collection'))).toEqual(['Blog', 'Notes (lacks a field pages need)']);
    await close();
    await pick('Collection', 'Notes (lacks a field pages need)');
    expect(container.textContent).toContain(
      "Notes has no formatted text field for the page's content. Add one in Framer, or pick another collection.",
    );
    expect(button('Save')!.disabled).toBe(true);
  });

  it('takes a part out with Not sent', async () => {
    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    await pick('Meta description', 'Not sent');
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledWith('b1', {
      collectionId: 'c1',
      fieldMap: { title: 'f-title', body: 'f-content' },
    });
  });

  it('says how JSON-LD goes once a field takes it', async () => {
    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    expect(container.textContent).not.toContain(TEXT.jsonLdHint);
    await pick('JSON-LD (structured data)', 'SEO Title');
    expect(container.textContent).toContain(TEXT.jsonLdHint);
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledWith('b1', {
      collectionId: 'c1',
      fieldMap: {
        title: 'f-title',
        body: 'f-content',
        metaDescription: 'f-summary',
        jsonLd: 'f-seo',
      },
    });
  });

  it('says the saved collection is gone, or that the project has none', async () => {
    connectedWith({ ...CONNECTED, collectionId: 'c-gone', collectionName: 'Old posts' });
    await render();
    expect(container.textContent).toContain(
      'The saved collection, Old posts, is no longer in the project, or a plugin manages it now. Pick another.',
    );
    expect(container.textContent).not.toContain('Which field takes what');

    client.readFramerCollections.mockResolvedValue({ ok: true, collections: [] });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain(TEXT.noCollections);
  });

  it('reads the connection again when a save finds it changed, and another project’s collections with it', async () => {
    const other = {
      ...CONNECTED,
      projectId: 'zyxwvutsrq9876543210',
      projectName: 'Other Site',
      collectionId: null,
      collectionName: null,
      fieldMap: {},
    };
    client.readFramer
      .mockResolvedValueOnce({ ok: true, configured: true, connection: CONNECTED })
      .mockResolvedValue({ ok: true, configured: true, connection: other });
    client.saveFramerTarget.mockResolvedValue({ ok: false, code: 'changed' });
    await render();
    expect(client.readFramerCollections).toHaveBeenCalledTimes(1);
    await click(button('Save'));
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.changed);
    expect(client.readFramer).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Project: Other Site');
    expect(client.readFramerCollections).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(TEXT.setupStep);
  });

  it('asks to connect again when a save finds the connection gone', async () => {
    client.readFramer
      .mockResolvedValueOnce({ ok: true, configured: true, connection: CONNECTED })
      .mockResolvedValue({ ok: true, configured: true, connection: null });
    client.saveFramerTarget.mockResolvedValue({ ok: false, code: 'not_connected' });
    await render();
    await click(button('Save'));
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.not_connected);
    expect(client.readFramer).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('marks a collection whose required fields can’t be filled, and won’t save it', async () => {
    connectedWith(CONNECTED);
    await render();
    expect(texts(await open('Collection'))).toEqual([
      'Blog',
      'News',
      "Events (needs fields we can't fill)",
    ]);
    await close();
    await pick('Collection', "Events (needs fields we can't fill)");
    expect(container.textContent).toContain(
      "Events requires Date, which Send to CMS can't fill. Make it optional in Framer, or pick another collection.",
    );
    expect(button('Save')!.disabled).toBe(true);
  });

  it('asks for a part for a required field the map leaves out', async () => {
    connectedWith({ ...CONNECTED, fieldMap: { title: 'f-title', body: 'f-content' } });
    client.readFramerCollections.mockResolvedValue({
      ok: true,
      collections: [
        {
          ...BLOG,
          fields: BLOG.fields.map((f) => (f.id === 'f-summary' ? { ...f, required: true } : f)),
        },
      ],
    });
    await render();
    expect(container.textContent).toContain(
      'Blog requires Summary. Pick it above for the title, page content, meta title or meta description, or make it optional in Framer.',
    );
    expect(button('Save')!.disabled).toBe(true);
  });

  it('leaves out a saved part whose field was deleted in Framer since', async () => {
    connectedWith({ ...CONNECTED, fieldMap: { ...CONNECTED.fieldMap, metaTitle: 'f-gone' } });
    client.saveFramerTarget.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledWith('b1', {
      collectionId: 'c1',
      fieldMap: { title: 'f-title', body: 'f-content', metaDescription: 'f-summary' },
    });
  });

  it('lists what doesn’t fit when a map is refused, by the parts’ labels', async () => {
    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({
      ok: false,
      code: 'invalid_map',
      problems: ['metaTitle: the collection has no field "x"', 'The collection requires Category'],
    });
    await render();
    await click(button('Save'));
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.invalid_map);
    const list = container.querySelector('ul[role="alert"]')!;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Meta title: the collection has no field "x"',
      'The collection requires Category',
    ]);
  });

  it('says the collections couldn’t be read, not that there are none', async () => {
    connectedWith(CONNECTED);
    client.readFramerCollections.mockResolvedValue({ ok: false, code: 'unreachable' });
    await render();
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.unreachable);
    expect(container.textContent).toContain(TEXT.collectionsUnavailable);
    expect(container.textContent).not.toContain(TEXT.noCollections);
  });

  it('reads the connection again when Framer refuses its key, and asks for a new one', async () => {
    client.readFramer
      .mockResolvedValueOnce({ ok: true, configured: true, connection: CONNECTED })
      .mockResolvedValue({
        ok: true,
        configured: true,
        connection: { ...CONNECTED, status: 'auth_failed' },
      });
    client.readFramerCollections.mockResolvedValue({ ok: false, code: 'auth_failed' });
    await render();
    await act(async () => {});
    expect(client.readFramer).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(TEXT.refusedNote);
  });

  it('replaces the key for the same project, and goes back on Cancel, not while it’s checked', async () => {
    connectedWith(CONNECTED);
    await render();
    expect(container.querySelector('form')).toBeNull();
    await click(button('Replace key'));
    expect(field('Project address').value).toBe(PROJECT_ID);
    expect(field('API key').value).toBe('');
    expect(button('Replace key')).toBeUndefined();
    await click(button('Cancel'));
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Which field takes what');

    await click(button('Replace key'));
    client.connectFramer.mockReturnValueOnce(new Promise(() => {}));
    await type('API key', KEY);
    await submit();
    expect(container.textContent).toContain('Checking the project…');
    expect(button('Cancel')!.disabled).toBe(true);
  });

  it('disconnects after asking, and says to delete the key in Framer', async () => {
    connectedWith(CONNECTED);
    client.disconnectFramer.mockResolvedValue({ ok: true, success: true, revoked: false });
    await render();
    await click(button('Disconnect'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(TEXT.disconnectDescription);
    await click(button('Disconnect', dialog));
    expect(client.disconnectFramer).toHaveBeenCalledWith('b1');
    expect(toast.warning).toHaveBeenCalledWith(TEXT.disconnectedNotRevoked);
    expect(TEXT.disconnectedNotRevoked).toContain('Site Settings › General');
    expect(container.textContent).not.toContain('Connected');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('keeps the connection when a disconnect fails', async () => {
    connectedWith(CONNECTED);
    client.disconnectFramer.mockResolvedValue({ ok: false, code: 'forbidden' });
    await render();
    await click(button('Disconnect'));
    await click(button('Disconnect', document.querySelector('[role="dialog"]')!));
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.forbidden);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain('Which field takes what');
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('goes back to where pages go once a replaced key is taken', async () => {
    connectedWith(CONNECTED);
    client.connectFramer.mockResolvedValue({ ok: true, connection: CONNECTED });
    await render();
    await click(button('Replace key'));
    await type('API key', KEY);
    await submit();
    expect(client.connectFramer).toHaveBeenCalledWith('b1', { project: PROJECT_ID, apiKey: KEY });
    expect(toast.success).toHaveBeenCalledWith('Framer connected');
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Which field takes what');
    expect(button('Replace key')).not.toBeUndefined();
  });

  it('asks for a new key after Framer refused the saved one, with the project filled in', async () => {
    connectedWith({ ...CONNECTED, status: 'auth_failed' });
    await render();
    expect(container.textContent).toContain('Key refused');
    expect(container.textContent).toContain(TEXT.refusedNote);
    expect(field('Project address').value).toBe(PROJECT_ID);
    expect(field('API key').value).toBe('');
    expect(button('Replace key')).toBeUndefined();
    expect(client.readFramerCollections).not.toHaveBeenCalled();
  });

  it('shows members where pages go, with no form or buttons', async () => {
    role.canManage = false;
    connectedWith(CONNECTED);
    await render();
    expect(container.textContent).toContain('Pages go to Blog as draft items.');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(client.readFramerCollections).not.toHaveBeenCalled();

    for (const [connection, text] of [
      [null, 'Not connected. Admins and managers can connect Framer.'],
      [{ ...CONNECTED, status: 'auth_failed' }, TEXT.refusedMember],
      [NO_COLLECTION, TEXT.noCollection],
    ] as const) {
      connectedWith(connection);
      act(() => root.unmount());
      root = createRoot(container);
      await render();
      expect(container.textContent).toContain(text);
    }
    // Connected, no collection saved: pages can't go yet, and the step is the managers'.
    expect(badges()).toEqual(['Setup not finished']);
    expect(container.textContent).toContain(
      "No collection picked yet. Pages can't go to Framer until an admin or manager finishes the setup.",
    );
    expect(container.textContent).not.toContain(TEXT.setupStep);
  });

  it('says when the server can’t keep a key, or the connection can’t be read', async () => {
    client.readFramer.mockResolvedValue({ ok: true, configured: false, connection: null });
    await render();
    expect(container.textContent).toContain("Framer isn't set up on this server yet.");
    expect(container.querySelector('input')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    client.readFramer.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the Framer connection right now.");
  });

  it('shows another brand’s connection never, while its own is read', async () => {
    connectedWith(CONNECTED);
    await render();
    expect(container.textContent).toContain('Acme Site');
    client.readFramer.mockReturnValueOnce(new Promise(() => {}));
    store.activeBrandId = 'b2';
    await render();
    expect(container.textContent).not.toContain('Acme Site');
    expect(container.textContent).not.toContain('Pages go to Blog');
    expect(client.readFramer).toHaveBeenLastCalledWith('b2');
  });

  it('opens the upgrade dialog, not an error, when a read-only workspace’s connect, save or disconnect is refused', async () => {
    client.connectFramer.mockResolvedValue({ ok: false, code: 'subscription' });
    await render();
    await type('Project address', PROJECT_ID);
    await type('API key', KEY);
    await submit();
    expect(client.connectFramer).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    connectedWith(CONNECTED);
    client.saveFramerTarget.mockResolvedValue({ ok: false, code: 'subscription' });
    client.disconnectFramer.mockResolvedValue({ ok: false, code: 'subscription' });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Save'));
    expect(client.saveFramerTarget).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    await click(button('Disconnect'));
    await click(button('Disconnect', document.querySelector('[role="dialog"]')!));
    expect(client.disconnectFramer).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledTimes(3);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on a read-only workspace, connects, replaces and saves nothing, and still disconnects', async () => {
    gate.isLocked = true;
    await render();
    await type('Project address', PROJECT_ID);
    await type('API key', KEY);
    await submit();
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(client.connectFramer).not.toHaveBeenCalled();

    connectedWith(CONNECTED);
    client.disconnectFramer.mockResolvedValue({ ok: true, success: true, revoked: false });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    await click(button('Replace key'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Connecting your CMS needs a plan');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await click(button('Save'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Saving the CMS settings needs a plan');
    expect(client.saveFramerTarget).not.toHaveBeenCalled();
    // Disconnect ends an access: it stays open.
    await click(button('Disconnect'));
    await click(button('Disconnect', document.querySelector('[role="dialog"]')!));
    expect(client.disconnectFramer).toHaveBeenCalledWith('b1');
    expect(toast.warning).toHaveBeenCalledWith(TEXT.disconnectedNotRevoked);
  });
});
