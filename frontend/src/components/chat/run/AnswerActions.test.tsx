import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * The bar under a finished answer (CHAT-06 items 30–37, 30a): Copy,
 * Download ▾ with the formats the answer offers, Save to Files once, as
 * named icon buttons.
 */

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const getMore = vi.hoisted(() => ({ open: null as ((tab?: string) => void) | null }));
vi.mock('@/components/ai-usage/getMoreContext', () => ({ useGetMore: () => getMore.open }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: '22222222-2222-4222-8222-222222222222' }),
}));

const { AnswerActions } = await import('./AnswerActions');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const RUN = '44444444-4444-4444-8444-444444444444';
const TABLE = 'Two pages.\n\n| Page | Lost |\n|---|---|\n| /a | 14 |';

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const onFiled = vi.fn();
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

async function render(
  markdown = 'Two pages lost most of it.',
  filed = false,
  onSendToActionCenter?: () => void,
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade }}
        >
          <AnswerActions
            runId={RUN}
            markdown={markdown}
            filed={filed}
            onFiled={onFiled}
            onSendToActionCenter={onSendToActionCenter}
          />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
const button = (action: string) =>
  container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const formats = () =>
  [...document.querySelectorAll('[data-action="answer.downloadAs"]')].map((item) =>
    item.getAttribute('data-format'),
  );

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  download.saveBlob.mockClear();
  openUpgrade.mockClear();
  onFiled.mockClear();
  router.push.mockClear();
  fetchMock.mockClear();
  answer = () => new Response('{}', { status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('AnswerActions', () => {
  it('names each icon button: Copy, Download, Save to Files', async () => {
    await render();
    expect(
      [...container.querySelectorAll('[role="toolbar"] [aria-label]')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    ).toEqual(['Copy', 'Download', 'Save to Files', 'Open in Content Editor']);
  });

  /** CHAT-09 item 18: on the latest answer, for Admins and Managers (the thread decides). */
  it('offers Send to Action Center where the thread gives it, and asks Chat on a click', async () => {
    const send = vi.fn();
    await render(undefined, false, send);
    expect(button('answer.sendToActionCenter').getAttribute('aria-label')).toBe(
      'Send to Action Center',
    );
    await click(button('answer.sendToActionCenter'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers Markdown, Word and PDF, and CSV and Excel only with a table', async () => {
    await render();
    await click(button('answer.download'));
    expect(formats()).toEqual(['md', 'docx', 'pdf']);
    act(() => root.unmount());
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await render(TABLE);
    await click(button('answer.download'));
    expect(formats()).toEqual(['md', 'docx', 'pdf', 'csv', 'xlsx']);
  });

  it('copies the answer and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await render();
    await click(button('answer.copy'));
    expect(writeText).toHaveBeenCalledWith('Two pages lost most of it.');
    expect(toast).toHaveBeenCalledWith('Copied');
  });

  it('downloads the file the server names, and says which', async () => {
    answer = () =>
      new Response('%PDF', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="why-2026-10-30.pdf"' },
      });
    await render();
    await click(button('answer.download'));
    await click(document.querySelector<HTMLElement>('[data-format="pdf"]')!);
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/runs/${RUN}/export?format=pdf`);
    // The body's Blob is Node's (fetch), not the test page's: match it by its size.
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: 4 }),
      'why-2026-10-30.pdf',
    );
    expect(toast).toHaveBeenCalledWith('Downloaded why-2026-10-30.pdf');
  });

  it('saves to Files once, then reads In Files', async () => {
    answer = () => Response.json({ ok: true, file: { id: 'f1' } }, { status: 201 });
    await render();
    await click(button('answer.saveToFiles'));
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/runs/${RUN}/file`, { method: 'POST' });
    expect(onFiled).toHaveBeenCalledWith('f1');
    expect(toast).toHaveBeenCalledWith('Saved to Files');

    fetchMock.mockClear();
    await render('Two pages lost most of it.', true);
    expect(button('answer.saveToFiles').getAttribute('aria-label')).toBe('In Files');
    await click(button('answer.saveToFiles'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says a full workspace saved nothing, and sends a read-only one to the plans', async () => {
    answer = () => Response.json({ ok: false, code: 'storage_full' }, { status: 409 });
    await render();
    await click(button('answer.saveToFiles'));
    expect(toast).toHaveBeenCalledWith('Not saved to Files · Storage is full');
    expect(onFiled).not.toHaveBeenCalled();

    answer = () => Response.json({ ok: false, code: 'subscription_inactive' }, { status: 402 });
    await click(button('answer.saveToFiles'));
    expect(openUpgrade).toHaveBeenCalled();
  });

  it('offers Get more storage on a full workspace, where the window is', async () => {
    getMore.open = vi.fn();
    answer = () => Response.json({ ok: false, code: 'storage_full' }, { status: 409 });
    await render();
    await click(button('answer.saveToFiles'));
    const [text, options] = toast.mock.calls.at(-1)! as unknown as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(text).toBe('Not saved to Files · Storage is full');
    expect(options.action.label).toBe('Get more storage');
    options.action.onClick();
    expect(getMore.open).toHaveBeenCalledWith('storage');
    getMore.open = null;
  });

  it('opens the answer in the Content Editor as a new draft, in the brand open', async () => {
    answer = () =>
      Response.json({ ok: true, href: '/dashboard/content/editor/d1' }, { status: 201 });
    await render();
    await click(button('answer.openInEditor'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/chat/runs/${RUN}/content-draft`);
    expect(JSON.parse(String(init!.body))).toEqual({
      brandId: '22222222-2222-4222-8222-222222222222',
    });
    expect(router.push).toHaveBeenCalledWith('/dashboard/content/editor/d1');

    answer = () => Response.json({ ok: false, code: 'no_brand' }, { status: 400 });
    await click(button('answer.openInEditor'));
    expect(toast.error).toHaveBeenCalledWith(
      'Pick a brand first: the draft goes to its Content Library.',
    );
    answer = () => Response.json({ ok: false, code: 'demo_brand' }, { status: 402 });
    await click(button('answer.openInEditor'));
    expect(openUpgrade).toHaveBeenCalled();
  });
});
