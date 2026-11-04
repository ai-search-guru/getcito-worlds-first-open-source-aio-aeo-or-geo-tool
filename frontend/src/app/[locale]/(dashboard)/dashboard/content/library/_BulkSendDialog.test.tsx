import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { CmsSource } from '@/lib/content/cmsSend';
import type { ContentDraftListItem } from '@/lib/content/drafts';

const readCmsSources = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cmsSources', () => ({ readCmsSources }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));
const readKeptFields = vi.hoisted(() => vi.fn());
const readDeliveries = vi.hoisted(() => vi.fn());
const sendPagesToCms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cmsSendClient', () => ({
  readKeptFields,
  readDeliveries,
  sendPagesToCms,
}));
// The brand's Webflow connection (#1331, phase 2): none unless a test gives one.
const webflow = vi.hoisted(() => ({ ready: false, refused: false, failed: false }));
vi.mock('@/lib/webflowClient', () => ({
  readWebflow: async () => ({
    ok: !webflow.failed,
    code: 'failed',
    configured: true,
    connection:
      webflow.ready || webflow.refused
        ? {
            status: webflow.refused ? 'auth_failed' : 'connected',
            siteId: 's1',
            siteName: 'Acme',
            collectionId: 'c1',
            collectionName: 'Blog Posts',
            fieldMap: { body: 'post-body' },
            connectedAt: '2026-10-25T10:00:00Z',
            updatedAt: '2026-10-25T10:00:00Z',
          }
        : null,
  }),
}));
// And its WordPress site (00294): none unless a test gives one.
const wordpress = vi.hoisted(() => ({ ready: false, refused: false, failed: false }));
vi.mock('@/lib/wordpressClient', () => ({
  readWordPress: async () => ({
    ok: !wordpress.failed,
    code: 'failed',
    configured: true,
    connection:
      wordpress.ready || wordpress.refused
        ? {
            status: wordpress.refused ? 'auth_failed' : 'connected',
            siteUrl: 'https://blog.acme.example',
            siteName: 'Acme Blog',
            account: 'getcito',
            connectedAt: '2026-10-26T10:00:00Z',
            updatedAt: '2026-10-26T10:00:00Z',
          }
        : null,
  }),
}));
// And its Framer collection (00295): none unless a test gives one. Not
// ready: connected, but no field for the page's title picked yet.
const framer = vi.hoisted(() => ({ ready: false, notReady: false, failed: false }));
vi.mock('@/lib/framerClient', () => ({
  readFramer: async () => ({
    ok: !framer.failed,
    code: 'failed',
    configured: true,
    connection:
      framer.ready || framer.notReady
        ? {
            status: 'connected',
            projectId: 'p1',
            projectName: 'Acme Site',
            siteUrl: 'https://acme.framer.website',
            account: 'Ada Lovelace',
            collectionId: 'fc1',
            collectionName: 'Articles',
            fieldMap: framer.ready ? { title: 'f-title', body: 'f-body' } : { body: 'f-body' },
            connectedAt: '2026-10-27T10:00:00Z',
            updatedAt: '2026-10-27T10:00:00Z',
          }
        : null,
  }),
}));
// One request a page, so a test can refuse the second.
const oneByOne = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/content/cmsSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content/cmsSend')>();
  return {
    ...actual,
    cmsSendGroups: (pages: Parameters<typeof actual.cmsSendGroups>[0]) =>
      oneByOne.on ? pages.map((page) => [page]) : actual.cmsSendGroups(pages),
  };
});

const { BulkSendDialog } = await import('./_BulkSendDialog');

/**
 * Send to CMS for the Library's selected rows (#1331): the pages that can
 * go, why the others can't, and their sends as the server makes them.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const draft = (id: string, title: string) => ({ id, title }) as ContentDraftListItem;
const source = (id: string, title: string, body: string): CmsSource => ({
  draftId: id,
  title,
  html: `<h1>${title}</h1>\n${body}`,
  sourceUrl: null,
  author: null,
  reviewer: null,
  teamByline: '',
  byline: null,
  // A page with no Article schema to add: its own type isn't an article (00448).
  schema: {
    input: {
      title,
      author: null,
      authorUrl: null,
      brandName: 'Acme',
      brandUrl: null,
      isNew: true,
    },
    pageType: 'product_page',
    leftOut: false,
  },
});
const drafts = [
  draft('d1', 'Pour-over'),
  draft('d2', 'Cold brew'),
  draft('d3', 'Espresso'),
  draft('d4', 'Latte art'),
];

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BulkSendDialog
          brandId="brand-1"
          drafts={drafts}
          brandName="Acme"
          brandLanguage="en"
          onClose={onClose}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;
/** Time going on, a read at a time: each read's answer renders before the next. */
async function tick(ms: number) {
  for (let left = ms; left > 0; left -= 2_000) {
    await act(async () => void (await vi.advanceTimersByTimeAsync(Math.min(2_000, left))));
  }
}
const lines = () => [...dialog().querySelectorAll('li')].map((li) => li.textContent);

beforeEach(() => {
  oneByOne.on = false;
  Object.assign(webflow, { ready: false, refused: false, failed: false });
  Object.assign(wordpress, { ready: false, refused: false, failed: false });
  Object.assign(framer, { ready: false, notReady: false, failed: false });
  // The send target remembered per brand, in this browser.
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
    clear: () => kept.clear(),
  });
  onClose.mockReset();
  readCmsSources.mockReset().mockResolvedValue(
    new Map([
      ['d1', source('d1', 'Pour-over', '<p>Brew it slowly.</p>')],
      ['d2', source('d2', 'Cold brew', '<p>Steep it [hours] hours.</p>')],
      ['d3', source('d3', 'Espresso', '<p>Pull a shot.</p>')],
      // d4 was deleted meanwhile: left out.
    ]),
  );
  readKeptFields.mockReset().mockResolvedValue(new Map([['d3', { slug: 'espresso-guide' }]]));
  readDeliveries.mockReset();
  toast.mockReset();
  sendPagesToCms.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BulkSendDialog', () => {
  it('sends the pages that can go, and reads their sends until they have gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
      skipped: 0,
    });
    readDeliveries
      .mockResolvedValueOnce([
        { id: 'x1', draftId: 'd1', status: 'sent', http_status: 200, error: null },
        { id: 'x3', draftId: 'd3', status: 'queued', http_status: null, error: null },
      ])
      .mockResolvedValueOnce([
        { id: 'x1', draftId: 'd1', status: 'sent', http_status: 200, error: null },
        // Deleted while it went: its send reads back with no draft.
        { id: 'x3', draftId: '', status: 'failed', http_status: 500, error: 'No' },
      ]);
    await render();
    expect(readCmsSources).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'brand-1', draftIds: ['d1', 'd2', 'd3', 'd4'] }),
    );
    // The pages read: d4 was deleted meanwhile.
    expect(dialog().textContent).toContain('Send 3 pages to your CMS');
    expect(lines()).toEqual(['Pour-overReady', 'Cold brewYour input needed', 'EspressoReady']);
    expect(dialog().textContent).toContain("A page that can't go is left out");

    await act(async () => button('Send 2 pages').click());
    const [, pages, target] = sendPagesToCms.mock.calls[0] as [
      string,
      { draftId: string; slug: string }[],
      string,
    ];
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(target).toBe('webhook');
    expect(pages.map((page) => [page.draftId, page.slug])).toEqual([
      ['d1', 'pour-over'],
      // What it kept from its last send.
      ['d3', 'espresso-guide'],
    ]);
    expect(dialog().textContent).toContain('Sending: 0 of 2 done.');

    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(readDeliveries).toHaveBeenCalledWith(['x1', 'x3']);
    expect(dialog().textContent).toContain('Sending: 1 of 2 done.');
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('1 page sent, 1 failed.');
    expect(lines()).toEqual([
      'Pour-overSent',
      'Cold brewYour input needed',
      'EspressoWebhook answered 500',
    ]);
    // Done: no more reads.
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(readDeliveries).toHaveBeenCalledTimes(2);

    await act(async () => button('Close').click());
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the pages to the brand’s Webflow collection when Settings has it ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    webflow.ready = true;
    sendPagesToCms.mockResolvedValue({
      ok: true,
      skipped: 0,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
    });
    readDeliveries.mockResolvedValue([
      { id: 'x1', draftId: 'd1', status: 'sent', http_status: null, error: null },
      { id: 'x3', draftId: 'd3', status: 'sent', http_status: null, error: null },
    ]);
    await render();
    expect(dialog().textContent).toContain(
      'Each page goes to Blog Posts in Webflow as a draft item',
    );
    const webflowChoice = [...dialog().querySelectorAll('[role="radio"]')].find((r) =>
      r.textContent?.startsWith('Webflow'),
    );
    expect(webflowChoice?.getAttribute('aria-checked')).toBe('true');
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webflow');
    expect(localStorage.getItem('aeo:cms-target:brand-1')).toBe('webflow');
    // Once sent, the choice is gone.
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(dialog().querySelector('[role="radio"]')).toBeNull();
  });

  it('sends to the webhook when Webflow can’t be read, saying so to a person who sent to Webflow', async () => {
    webflow.failed = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'webflow');
    sendPagesToCms.mockResolvedValue({
      ok: true,
      skipped: 0,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'sent' },
        { id: 'x3', draftId: 'd3', status: 'sent' },
      ],
    });
    await render();
    expect(dialog().querySelector('[role="radio"]')).toBeNull();
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      "Couldn't check Webflow just now, so this send goes to your workflow.",
    );
    expect(button('Send 2 pages').disabled).toBe(false);
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webhook');
  });

  it('says Webflow isn’t ready when the brand has no webhook either', async () => {
    webflow.refused = true;
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'no_webhook', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "This brand's Webflow isn't ready, and it has no webhook. Connect Webflow again or pick its collection in Settings › Integrations.",
    );
  });

  it('sends the pages to the brand’s WordPress site as draft posts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    wordpress.ready = true;
    sendPagesToCms.mockResolvedValue({
      ok: true,
      skipped: 0,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
    });
    readDeliveries.mockResolvedValue([
      { id: 'x1', draftId: 'd1', status: 'sent', http_status: null, error: null },
      { id: 'x3', draftId: 'd3', status: 'sent', http_status: null, error: null },
    ]);
    await render();
    expect(dialog().textContent).toContain(
      'Each page goes to Acme Blog in WordPress as a draft post, as it is ready to publish',
    );
    expect(dialog().textContent).toContain(
      "A page whose post is already published or scheduled goes as a new draft post. The meta title and JSON-LD aren't sent: set them in your SEO plugin.",
    );
    const radios = [...dialog().querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual([
      'WordPressA draft post on Acme Blog',
      "Your workflowThe brand's webhook (Zapier, Make, n8n)",
    ]);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('wordpress');
    expect(localStorage.getItem('aeo:cms-target:brand-1')).toBe('wordpress');
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('2 pages sent.');
  });

  it('offers all three with Webflow and WordPress, starting from the remembered WordPress', async () => {
    webflow.ready = true;
    wordpress.ready = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'wordpress');
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'in_progress', field: null });
    await render();
    const radios = [...dialog().querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.querySelector('span')?.textContent)).toEqual([
      'Webflow',
      'WordPress',
      'Your workflow',
    ]);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('wordpress');
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'A page is already on its way to WordPress. Wait for it, then send again.',
    );
  });

  it('says WordPress refused the sign-in when the brand has no webhook either', async () => {
    wordpress.refused = true;
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'no_webhook', field: null });
    await render();
    const choice = [...dialog().querySelectorAll<HTMLButtonElement>('[role="radio"]')][0];
    expect(choice.disabled).toBe(true);
    expect(choice.textContent).toContain('Sign-in refused');
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webhook');
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "This brand's WordPress refused the sign-in, and it has no webhook. Connect WordPress again in Settings › Integrations.",
    );
  });

  it('says only that the webhook is missing when a CMS is ready to pick instead', async () => {
    webflow.refused = true;
    wordpress.ready = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'webhook');
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'no_webhook', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webhook');
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'This brand has no webhook yet. Set one up in Webhook Settings on Content Opportunities.',
    );
  });

  it('sends to the webhook when WordPress can’t be read, saying so to a person who sent there', async () => {
    wordpress.failed = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'wordpress');
    sendPagesToCms.mockResolvedValue({
      ok: true,
      skipped: 0,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'sent' },
        { id: 'x3', draftId: 'd3', status: 'sent' },
      ],
    });
    await render();
    expect(dialog().querySelector('[role="radio"]')).toBeNull();
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      "Couldn't check WordPress just now, so this send goes to your workflow.",
    );
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webhook');
  });

  it('sends the pages to the brand’s Framer collection as draft items', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    framer.ready = true;
    sendPagesToCms.mockResolvedValue({
      ok: true,
      skipped: 0,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
    });
    readDeliveries.mockResolvedValue([
      { id: 'x1', draftId: 'd1', status: 'sent', http_status: null, error: null },
      { id: 'x3', draftId: 'd3', status: 'sent', http_status: null, error: null },
    ]);
    await render();
    expect(dialog().textContent).toContain(
      "Each page goes to Articles in Framer as a draft item, as it is ready to publish, with the slug and meta of its last send, else the page's. Open a page in the editor to change them.",
    );
    expect(dialog().textContent).toContain(
      "A page whose item isn't a draft is updated there: the change goes live with your next publish of the site. Images aren't sent yet.",
    );
    const radios = [...dialog().querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual([
      'FramerA draft item in Articles',
      "Your workflowThe brand's webhook (Zapier, Make, n8n)",
    ]);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('framer');
    expect(localStorage.getItem('aeo:cms-target:brand-1')).toBe('framer');
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('2 pages sent.');
  });

  it('offers all four, two by two, starting from the remembered Framer', async () => {
    webflow.ready = true;
    wordpress.ready = true;
    framer.ready = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'framer');
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'in_progress', field: null });
    await render();
    const radios = [...dialog().querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.querySelector('span')?.textContent)).toEqual([
      'Webflow',
      'WordPress',
      'Framer',
      'Your workflow',
    ]);
    expect(dialog().querySelector('[role="radiogroup"]')!.className).toContain(
      'grid-cols-1 sm:grid-cols-2',
    );
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('framer');
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'A page is already on its way to Framer. Wait for it, then send again.',
    );
  });

  it('says Framer isn’t ready when the brand has no webhook either', async () => {
    framer.notReady = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'framer');
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'no_webhook', field: null });
    await render();
    const choice = [...dialog().querySelectorAll<HTMLButtonElement>('[role="radio"]')][0];
    expect(choice.disabled).toBe(true);
    expect(choice.textContent).toContain('Not ready: connect it again or pick its collection');
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webhook');
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "This brand's Framer isn't ready, and it has no webhook. Connect Framer again or pick its collection and fields in Settings › Integrations.",
    );
  });

  it('sends to the webhook when Framer can’t be read, saying so to a person who sent there', async () => {
    framer.failed = true;
    localStorage.setItem('aeo:cms-target:brand-1', 'framer');
    sendPagesToCms.mockResolvedValue({
      ok: true,
      skipped: 0,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'sent' },
        { id: 'x3', draftId: 'd3', status: 'sent' },
      ],
    });
    await render();
    expect(dialog().querySelector('[role="radio"]')).toBeNull();
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      "Couldn't check Framer just now, so this send goes to your workflow.",
    );
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webhook');
  });

  it('says why nothing went, and keeps the pages to send again', async () => {
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'webhook_not_subscribed', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'The brand\'s webhook doesn\'t receive "Content page sent". Turn it on in Webhook Settings on Content Opportunities.',
    );
    expect(button('Send 2 pages').disabled).toBe(false);
  });

  it('says a page is already on its way to Webflow, and clears it when the webhook is picked', async () => {
    webflow.ready = true;
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'in_progress', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms.mock.calls[0]?.[2]).toBe('webflow');
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'A page is already on its way to Webflow. Wait for it, then send again.',
    );
    const workflow = [...dialog().querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
      r.textContent?.startsWith('Your workflow'),
    );
    await act(async () => workflow!.click());
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps what went when a later request is refused for the day', async () => {
    oneByOne.on = true;
    sendPagesToCms
      .mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
        skipped: 0,
      })
      .mockResolvedValueOnce({ ok: false, code: 'daily_limit', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('1 page sent.');
    expect(lines()).toEqual(['Pour-overSent', 'Cold brewYour input needed', 'EspressoNot sent']);
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'This workspace has sent 200 pages in the last 24 hours. Try again later.',
    );
  });

  it('posts the next request once the last one’s pages have gone, one page at a time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    oneByOne.on = true;
    sendPagesToCms
      .mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
        skipped: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x3', draftId: 'd3', status: 'sent' }],
        skipped: 0,
      });
    readDeliveries
      .mockResolvedValueOnce([{ id: 'x1', draftId: 'd1', status: 'queued' }])
      // A read that fails is read again.
      .mockResolvedValueOnce(null)
      .mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'sent' }]);
    await render();
    await act(async () => void button('Send 2 pages').click());
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    // What went shows while the next waits, and the dialog can be closed.
    expect(lines()).toEqual(['Pour-overSending…', 'Cold brewYour input needed', 'EspressoWaiting']);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('Sending: 0 of 2 done.');
    expect(button('Close')).toBeDefined();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(readDeliveries).toHaveBeenCalledWith(['x1']);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('2 pages sent.');
  });

  it('posts no more once the pages before are still going after 30 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 0,
    });
    readDeliveries.mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'queued' }]);
    await render();
    await act(async () => void button('Send 2 pages').click());
    await act(async () => void (await vi.advanceTimersByTimeAsync(30 * 60_000 + 2_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(lines()).toEqual([
      'Pour-overSending…',
      'Cold brewYour input needed',
      'EspressoNot sent',
    ]);
    expect(dialog().textContent).toContain(
      "The pages before it were still going after 30 minutes, so 1 page wasn't sent.",
    );
  });

  it('posts no more once closed while a request waits, and says how many didn’t go', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 0,
    });
    readDeliveries.mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'queued' }]);
    await render();
    await act(async () => void button('Send 2 pages').click());
    act(() => root.unmount());
    readDeliveries.mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'sent' }]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "1 page wasn't sent: the dialog closed while the pages before it were still going. Send it again from the Library.",
    );
    root = createRoot(container);
  });

  it('posts no more once closed while a one-page request is out', async () => {
    oneByOne.on = true;
    let answer: (value: unknown) => void = () => {};
    sendPagesToCms.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render();
    await act(async () => void button('Send 2 pages').click());
    act(() => root.unmount());
    // A single page goes at once: it comes back sent, not queued.
    await act(async () =>
      answer({ ok: true, deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }], skipped: 0 }),
    );
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "1 page wasn't sent: the dialog closed while the pages before it were still going. Send it again from the Library.",
    );
    root = createRoot(container);
  });

  it('says Failed, not the 200 the webhook answered, when the workflow then failed', async () => {
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'failed', http_status: 200, error: 'Slug taken' },
      ],
      skipped: 0,
    });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(lines()[0]).toBe('Pour-overFailed');
  });

  it('posts no more requests once the day’s sends are used up', async () => {
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 1,
    });
    await render();
    await act(async () => void button('Send 2 pages').click());
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(readDeliveries).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("2 pages weren't sent");
  });

  it('says how many pages the day’s sends left out', async () => {
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
      skipped: 1,
    });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().textContent).toContain(
      "1 page wasn't sent: the workspace has sent 200 pages in the last 24 hours.",
    );
  });

  it('says when the pages couldn’t be read, and reads them again', async () => {
    readCmsSources.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "Couldn't read the pages. Try again.",
    );
    expect(button('Send 0 pages')).toBeUndefined();
    await act(async () => button('Try again').click());
    expect(readCmsSources).toHaveBeenCalledTimes(2);
    expect(button('Send 2 pages').disabled).toBe(false);
  });

  it('names the page a refusal names, and says when one went meanwhile', async () => {
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({ ok: false, code: 'invalid', field: 'pages.0.html' });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "\u201cPour-over\u201d can't go as it is: check its page in the editor.",
    );
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'not_found', field: null });
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      'A page was archived or deleted since you picked it.',
    );
  });

  it('leaves the rest to the Library after three minutes, reading on through a failed read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
      skipped: 0,
    });
    readDeliveries.mockResolvedValue(null);
    await render();
    await act(async () => button('Send 2 pages').click());
    await tick(60_000);
    expect(dialog().textContent).toContain('Sending: 0 of 2 done.');
    await tick(2 * 60_000 + 4_000);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe(
      "0 pages sent. The rest are still going: the Library shows each page's send as it lands.",
    );
    const reads = readDeliveries.mock.calls.length;
    await tick(10_000);
    expect(readDeliveries).toHaveBeenCalledTimes(reads);
  });

  it('stops reading once closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 0,
    });
    await render();
    await act(async () => button('Send 2 pages').click());
    act(() => root.unmount());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(readDeliveries).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
