import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatDeliverable, ChatTaskStrip } from '@/lib/chat/events';

/**
 * An output card (CHAT-06 items 1–6): what a run made, whether it is in
 * Files, its file's formats, and a page opened in the Content Editor.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const getMore = vi.hoisted(() => ({ open: null as ((tab?: string) => void) | null }));
vi.mock('@/components/ai-usage/getMoreContext', () => ({ useGetMore: () => getMore.open }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
// The person's clicks on a task (CHAT-09 items 13–16), the server's.
const cardActions = vi.hoisted(() => ({
  markTaskDoneFromCard: vi.fn(),
  attachOnlyFromCard: vi.fn(),
  undoTaskDoneFromCard: vi.fn(),
}));
vi.mock('@/lib/actions/chatTaskCard', () => cardActions);
const plan = vi.hoisted(() => ({ locked: false, openUpgrade: vi.fn() }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({
    isLocked: plan.locked,
    openUpgrade: plan.openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        plan.locked ? plan.openUpgrade(options.action) : fn(...args),
  }),
}));

const { DeliverableCard, filedNumbers } = await import('./DeliverableCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const RUN = '44444444-4444-4444-8444-444444444444';
const page: ChatDeliverable = {
  title: 'Pricing FAQ',
  type: 'document',
  formats: ['html', 'md', 'docx', 'pdf'],
  status: 'draft',
  href: '/dashboard/content/editor/d1',
  filed: 'in_files',
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(
  async () =>
    new Response('# Pricing FAQ', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="pricing-faq-2026-10-30.md"' },
    }),
);

async function render(
  deliverable: ChatDeliverable = page,
  props: { canChange?: boolean; onTasks?: (strip: ChatTaskStrip) => void } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DeliverableCard runId={RUN} n={2} deliverable={deliverable} {...props} />
      </NextIntlClientProvider>,
    );
  });
}
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const action = (name: string) => container.querySelector(`[data-action="${name}"]`);

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  toast.success.mockClear();
  plan.locked = false;
  plan.openUpgrade.mockClear();
  for (const fn of Object.values(cardActions)) fn.mockReset();
  download.saveBlob.mockClear();
  fetchMock.mockClear();
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

describe('DeliverableCard', () => {
  it('names what it made, says it is in Files, and opens the page in the Content Editor', async () => {
    await render();
    expect(container.textContent).toContain('Pricing FAQ');
    expect(container.textContent).toContain('Document · In Files · Used in Content draft');
    expect(action('deliverable.openEditor')!.getAttribute('href')).toBe(
      '/dashboard/content/editor/d1',
    );
  });

  it('downloads its file, the run’s n-th, in the formats it offers', async () => {
    await render();
    await click(action('deliverable.download')!);
    expect(
      [...document.querySelectorAll('[data-action="deliverable.downloadAs"]')].map((i) =>
        i.getAttribute('data-format'),
      ),
    ).toEqual(['html', 'md', 'docx', 'pdf']);
    await click(document.querySelector('[data-format="md"]')!);
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/runs/${RUN}/files/2?format=md`);
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.any(Number) }),
      'pricing-faq-2026-10-30.md',
    );
    expect(toast).toHaveBeenCalledWith('Downloaded pricing-faq-2026-10-30.md');
  });

  it('copies through a clipboard item written within the click, as Safari needs, and says when it can’t', async () => {
    const write = vi.fn(async (items: { types: Record<string, Promise<Blob>> }[]) => {
      await items[0].types['text/plain'];
    });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public types: Record<string, Promise<Blob>>) {}
      },
    );
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write, writeText: vi.fn() } });
    await render();
    await click(action('deliverable.copy')!);
    expect(write).toHaveBeenCalledTimes(1);
    const blob = await (write.mock.calls[0][0][0] as { types: Record<string, Promise<Blob>> })
      .types['text/plain'];
    // jsdom's Blob has no text(): read as the browser would.
    const copied = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(copied).toBe('# Pricing FAQ');
    expect(toast).toHaveBeenCalledWith('Copied');

    fetchMock.mockImplementationOnce(async () => new Response('Not found', { status: 404 }));
    await click(action('deliverable.copy')!);
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy that. Try again.");
  });

  it('numbers only the filed ones, as the server counts their files', () => {
    const made = (filed?: ChatDeliverable['filed']): ChatDeliverable => ({ ...page, filed });
    expect(
      filedNumbers([
        made('storage_full'),
        made('in_files'),
        made('failed'),
        made(),
        made('in_files'),
      ]),
    ).toEqual([null, 1, null, 2, 3]);
  });

  it('says it wasn’t saved when storage is full, with nothing to download', async () => {
    await render({ ...page, href: undefined, filed: 'storage_full' });
    expect(container.textContent).toContain('Document · Not saved to Files · Storage is full');
    expect(action('deliverable.download')).toBeNull();
    expect(action('deliverable.copy')).toBeNull();
    expect(action('deliverable.openEditor')).toBeNull();
    // No Get more window here (Chat off, self-hosted): only the line.
    expect(action('deliverable.getMoreStorage')).toBeNull();
  });

  it('offers Get more storage when storage is full, where the window is', async () => {
    getMore.open = vi.fn();
    await render({ ...page, href: undefined, filed: 'storage_full' });
    await click(action('deliverable.getMoreStorage')!);
    expect(getMore.open).toHaveBeenCalledWith('storage');
    getMore.open = null;
  });
});

describe('DeliverableCard and its task (CHAT-09 items 12–16)', () => {
  const forTask: ChatDeliverable = {
    ...page,
    task: { title: 'Add FAQ block + schema to /pricing', state: 'open' },
  };
  const strip: ChatTaskStrip = {
    tasks: [
      {
        at: 1,
        title: 'Add FAQ block + schema to /pricing',
        priority: 86,
        category: 'fix',
        status: 'done',
      },
    ],
    ready: 1,
    total: 1,
    due: 1,
  };
  const done = { ok: true, status: 'done', task: { ...forTask.task, state: 'done' }, strip };

  it('names its task, and marks it done by the person’s click, with Undo in the toast', async () => {
    const onTasks = vi.fn();
    cardActions.markTaskDoneFromCard.mockResolvedValue(done);
    cardActions.undoTaskDoneFromCard.mockResolvedValue({
      ok: true,
      status: 'draft',
      task: forTask.task,
      strip: { ...strip, ready: 0, tasks: [{ ...strip.tasks[0], status: 'queued' }] },
    });
    await render(forTask, { canChange: true, onTasks });
    expect(container.querySelector('[data-slot="deliverable-task"]')?.textContent).toBe(
      'Task: Add FAQ block + schema to /pricing',
    );
    await click(action('deliverable.attachAndMarkDone')!);
    // The card names its file by its run and place only.
    expect(cardActions.markTaskDoneFromCard).toHaveBeenCalledWith(RUN, 2);
    expect(onTasks).toHaveBeenCalledWith(strip);
    expect(container.querySelector('[data-slot="task-done"]')?.textContent).toBe(
      'Done · attached to task',
    );
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
    const [message, options] = toast.success.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('Task marked done in Action Center');
    expect(options.action.label).toBe('Undo');
    await act(async () => options.action.onClick());
    expect(cardActions.undoTaskDoneFromCard).toHaveBeenCalledWith(RUN, 2);
    expect(toast).toHaveBeenCalledWith('Task open again in Action Center');
    expect(action('deliverable.attachAndMarkDone')).not.toBeNull();
  });

  it('attaches only from its ⋯ menu, leaving the task open', async () => {
    cardActions.attachOnlyFromCard.mockResolvedValue({
      ok: true,
      status: 'attached',
      task: forTask.task,
      strip: null,
    });
    await render(forTask, { canChange: true });
    await click(action('deliverable.more')!);
    await click(document.querySelector('[data-action="deliverable.attachOnly"]')!);
    expect(cardActions.attachOnlyFromCard).toHaveBeenCalledWith(RUN, 2);
    expect(toast).toHaveBeenCalledWith('Attached to the task');
    // Attached now: Mark done stays, the ⋯ menu goes.
    expect(action('deliverable.attachAndMarkDone')).not.toBeNull();
    expect(action('deliverable.more')).toBeNull();
  });

  it('says why a click didn’t go through, and opens the plan dialog in a read-only workspace', async () => {
    cardActions.markTaskDoneFromCard.mockResolvedValueOnce({ ok: false, failure: 'changed' });
    await render(forTask, { canChange: true });
    await click(action('deliverable.attachAndMarkDone')!);
    expect(toast.error).toHaveBeenCalledWith(
      'It changed in Action Center since, so nothing was undone.',
    );
    cardActions.markTaskDoneFromCard.mockResolvedValueOnce({ ok: false, failure: 'read_only' });
    await click(action('deliverable.attachAndMarkDone')!);
    expect(plan.openUpgrade).toHaveBeenCalledWith('Marking a task done needs a plan');
    plan.locked = true;
    await render(forTask, { canChange: true });
    await click(action('deliverable.attachAndMarkDone')!);
    expect(cardActions.markTaskDoneFromCard).toHaveBeenCalledTimes(2);
    expect(plan.openUpgrade).toHaveBeenLastCalledWith('Marking a task done needs a plan');
  });

  it('shows the task to everyone, its buttons only to an Admin or a Manager', async () => {
    await render(forTask);
    expect(container.querySelector('[data-slot="deliverable-task"]')).not.toBeNull();
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
    expect(action('deliverable.more')).toBeNull();
  });

  it('says a task Action Center has done, with or without this file', async () => {
    await render(
      { ...forTask, status: 'done', task: { ...forTask.task!, state: 'done' } },
      {
        canChange: true,
      },
    );
    expect(container.querySelector('[data-slot="task-done"]')?.textContent).toBe(
      'Done · attached to task',
    );
    // A card of its own: what the first one kept doesn't carry over.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...forTask, task: { ...forTask.task!, state: 'done' } }, { canChange: true });
    expect(container.querySelector('[data-slot="task-done"]')?.textContent).toBe(
      'Done in Action Center',
    );
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
  });

  it('offers no task controls on a card without a task', async () => {
    await render(page, { canChange: true });
    expect(container.querySelector('[data-slot="deliverable-task"]')).toBeNull();
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
  });
});
