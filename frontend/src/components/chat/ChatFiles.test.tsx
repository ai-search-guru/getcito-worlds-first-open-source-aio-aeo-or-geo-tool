import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { GB, type ChatFileItem, type ChatStorage } from '@/lib/chat/files';

/**
 * Files (mockup #s-files; CHAT-06 items 16–19, 26–29): rows with who made
 * them, their chat and their time line; chips and "Filter by name…" ask
 * the server again; Copy, Open and Download on a row; picked rows as one
 * .zip with one toast; the storage meter, amber from 80%, and a line once
 * storage is full, with no Get more.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const getMore = vi.hoisted(() => ({ open: null as ((tab?: string) => void) | null }));
vi.mock('@/components/ai-usage/getMoreContext', () => ({ useGetMore: () => getMore.open }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
// The output card's task clicks (W2-12), which the icons' module brings: the server's.
vi.mock('@/lib/actions/chatTaskCard', () => ({
  markTaskDoneFromCard: vi.fn(),
  attachOnlyFromCard: vi.fn(),
  undoTaskDoneFromCard: vi.fn(),
}));

const { ChatFiles } = await import('./ChatFiles');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = 'cccccccc-0000-4000-8000-000000000001';
const file = (id: string, extra: Partial<ChatFileItem> = {}): ChatFileItem => ({
  id,
  title: `File ${id}`,
  type: 'document',
  formats: ['md', 'docx', 'pdf'],
  madeBy: { kind: 'you' },
  chat: null,
  draftHref: null,
  sizeBytes: 1000,
  generatedAt: '2026-10-26T11:30:00.000Z',
  dataAsOf: null,
  timezone: 'Europe/Istanbul',
  ...extra,
});
const STORAGE: ChatStorage = { usedBytes: 2.1 * GB, limitBytes: 25 * GB, fileCount: 24 };

let container: HTMLDivElement;
let root: Root;
let page: { files: ChatFileItem[]; hasMore: boolean; storage: ChatStorage };
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatFiles />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const rows = () => all('[data-slot="files-row"]');
const listCalls = () =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/chat/files?'));
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.click();
  });
  await settle();
}

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  download.saveBlob.mockClear();
  fetchMock.mockClear();
  page = {
    files: [
      file('a', {
        title: 'FAQ block for /pricing',
        formats: ['html', 'md', 'docx', 'pdf'],
        madeBy: { kind: 'agent' },
        chat: { href: `/dashboard/chat/${CHAT}`, title: 'Action Center tasks' },
        draftHref: '/dashboard/content/editor/d1',
        dataAsOf: '2026-10-26T05:00:00.000Z',
      }),
      file('b', { title: 'Weekly report', type: 'report', madeBy: { kind: 'member', name: null } }),
    ],
    hasMore: false,
    storage: STORAGE,
  };
  answer = (url) =>
    url.startsWith('/api/chat/files?')
      ? Response.json({ ok: true, ...page })
      : new Response('# FAQ', { status: 200 });
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
  vi.useRealTimers();
});

describe('ChatFiles', () => {
  it('shows each file with who made it, its chat, its time line and its actions', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('Files');
    expect(rows()).toHaveLength(2);
    const [a, b] = rows();
    expect(a.textContent).toContain('FAQ block for /pricing');
    expect(a.textContent).toContain('HTML · Markdown · Word · PDF');
    expect(a.textContent).toContain('Used in Content draft');
    // On its own line, so 1024px never cuts it off after the formats.
    expect([...a.querySelectorAll('em')].map((em) => em.textContent)).toContain(
      'Used in Content draft',
    );
    expect(a.textContent).toContain('Agent');
    expect(a.querySelector('[data-action="files.openSourceChat"]')?.getAttribute('href')).toBe(
      `/dashboard/chat/${CHAT}`,
    );
    // In the file's own time zone, with the newest data it read.
    expect(a.textContent).toContain('Oct 26, 2026 · 14:30');
    expect(a.textContent).toContain('Data as of Oct 26, 08:00');
    expect(a.querySelector('[data-action="files.open"]')?.getAttribute('href')).toBe(
      '/dashboard/content/editor/d1',
    );
    expect(b.textContent).toContain('Former member');
    expect(b.textContent).toContain('—');
    expect(b.querySelector('[data-action="files.open"]')).toBeNull();
    // All carries the workspace's count.
    expect(action('files.filter')[0].textContent).toBe('All24');
  });

  it('asks again under a chip and the words typed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await render();
    await click(action('files.filter').find((b) => b.textContent === 'Reports')!);
    expect(listCalls().at(-1)).toBe('/api/chat/files?filter=reports&q=&offset=0');
    const input = action('files.search')[0] as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'pricing faq');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(300));
    await settle();
    expect(listCalls().at(-1)).toBe('/api/chat/files?filter=reports&q=pricing+faq&offset=0');
  });

  it('says when nothing matches, and Clear filters goes back to all', async () => {
    page.files = [];
    await render();
    expect(container.textContent).toContain('No files here yet.');
    await click(action('files.filter').find((b) => b.textContent === 'Code')!);
    expect(container.textContent).toContain('No files match.');
    await click(action('emptyState.clearFilters')[0]);
    expect(listCalls().at(-1)).toBe('/api/chat/files?filter=all&q=&offset=0');
  });

  it('copies a file’s Markdown and downloads it in a format it offers', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await render();
    await click(rows()[0].querySelector<HTMLElement>('[data-action="files.copy"]')!);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/files/a?format=md');
    expect(writeText).toHaveBeenCalledWith('# FAQ');
    expect(toast).toHaveBeenCalledWith('Copied');

    // A failed read says so, never a silent copy (Safari's refusal included).
    answer = () => new Response('Not found', { status: 404 });
    await click(rows()[0].querySelector<HTMLElement>('[data-action="files.copy"]')!);
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy that. Try again.");
    answer = (url) =>
      url.startsWith('/api/chat/files?')
        ? Response.json({ ok: true, ...page })
        : new Response('# FAQ', { status: 200 });

    answer = () =>
      new Response('%PDF', {
        headers: { 'Content-Disposition': 'attachment; filename="faq-2026-10-26.pdf"' },
      });
    await click(rows()[0].querySelector<HTMLElement>('[data-action="files.download"]')!);
    expect(
      [...document.querySelectorAll('[data-action="files.downloadAs"]')].map((i) =>
        i.getAttribute('data-format'),
      ),
    ).toEqual(['html', 'md', 'docx', 'pdf']);
    await click(document.querySelector<HTMLElement>('[data-format="pdf"]')!);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/files/a?format=pdf');
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.any(Number) }),
      'faq-2026-10-26.pdf',
    );
  });

  it('downloads the picked files as one .zip and says how many', async () => {
    await render();
    const button = action('files.downloadSelected')[0] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    for (const box of action('files.select')) await click(box);
    expect(button.disabled).toBe(false);
    answer = () =>
      new Response(new Uint8Array([80, 75]), {
        headers: {
          'Content-Disposition': 'attachment; filename="files-2026-10-30.zip"',
          'X-File-Count': '2',
        },
      });
    await click(button);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/chat/files/zip');
    expect(JSON.parse(String(init!.body))).toEqual({ ids: ['a', 'b'] });
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.any(Number) }),
      'files-2026-10-30.zip',
    );
    expect(toast).toHaveBeenCalledWith('Downloaded 2 files (.zip)');
    expect(button.disabled).toBe(true);

    for (const box of action('files.select')) await click(box);
    answer = () => Response.json({ ok: false, code: 'too_big' }, { status: 413 });
    await click(button);
    expect(toast.error).toHaveBeenCalledWith('Pick up to 50 files and 100 MB at a time.');
  });

  it('meters storage: plain under 80%, amber from 80%, and a line once it’s full', async () => {
    await render();
    const meter = () => container.querySelector('[data-slot="storage-meter"]')!;
    expect(meter().textContent).toBe('Storage 2.1 of 25 GB');
    expect(meter().getAttribute('data-tone')).toBe('ok');
    expect(container.querySelector('[data-slot="storage-full"]')).toBeNull();

    act(() => root.unmount());
    page.storage = { usedBytes: 21 * GB, limitBytes: 25 * GB, fileCount: 24 };
    root = createRoot(container);
    await render();
    expect(meter().getAttribute('data-tone')).toBe('warning');

    act(() => root.unmount());
    page.storage = { usedBytes: 25 * GB, limitBytes: 25 * GB, fileCount: 24 };
    root = createRoot(container);
    await render();
    expect(meter().getAttribute('data-tone')).toBe('full');
    const full = container.querySelector('[data-slot="storage-full"]')!;
    expect(full.textContent).toBe(
      "Storage is full. New work still shows in its chat, but isn't saved to Files.",
    );
    expect(container.textContent).not.toContain('Get more');
  });

  it('opens Get more storage from the meter and the full line, where the window is', async () => {
    getMore.open = vi.fn();
    page.storage = { usedBytes: 25 * GB, limitBytes: 25 * GB, fileCount: 24 };
    await render();
    expect(container.querySelector('[data-slot="storage-full"]')!.textContent).toBe(
      'Storage is full. Get more storage to keep filing new work.Get more storage',
    );
    const [meter, line] = action('files.getMoreStorage');
    await click(meter);
    await click(line);
    expect(getMore.open).toHaveBeenCalledTimes(2);
    expect(getMore.open).toHaveBeenCalledWith('storage');
    getMore.open = null;
  });

  it('pages 50 at a time with Show more', async () => {
    page.hasMore = true;
    await render();
    page = { ...page, files: [file('c')], hasMore: false };
    await click(action('files.showMore')[0]);
    expect(listCalls().at(-1)).toBe('/api/chat/files?filter=all&q=&offset=2');
    expect(rows()).toHaveLength(3);
    expect(action('files.showMore')).toHaveLength(0);
  });
});
