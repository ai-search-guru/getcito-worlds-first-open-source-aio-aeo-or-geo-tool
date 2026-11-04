import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { OpportunityActions } from './OpportunityActions';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const handlers = {
  send: vi.fn(),
  brief: vi.fn(),
  start: vi.fn(),
  retry: vi.fn(),
  openDraft: vi.fn(),
  plan: vi.fn(),
  openPlan: vi.fn(),
  alternative: vi.fn(),
  workflow: vi.fn(),
  copy: vi.fn(),
  export: vi.fn(),
  reviewed: vi.fn(),
  dismiss: vi.fn(),
};

type Props = ComponentProps<typeof OpportunityActions>;
const props = (over: Partial<Props> = {}): Props => ({
  actionId: null,
  sendToActions: { sending: false, disabled: false, onSend: handlers.send },
  brief: { generated: false, generating: false, blockedReason: null, onGenerate: handlers.brief },
  content: {
    draftId: null,
    canStart: true,
    onStart: handlers.start,
    onOpenDraft: handlers.openDraft,
  },
  plan: { prioritized: false, onSend: handlers.plan, onOpen: handlers.openPlan },
  alternative: { running: false, onOpen: handlers.alternative },
  workflow: { sending: false, sentBefore: false, onSend: handlers.workflow },
  onCopy: handlers.copy,
  onExport: handlers.export,
  onReviewed: handlers.reviewed,
  onDismiss: handlers.dismiss,
  ...over,
});

async function render(p: Props) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OpportunityActions {...p} />
      </NextIntlClientProvider>,
    ),
  );
}
// The buttons in front, before the "…" menu (an icon, with no text).
const front = () =>
  [...container.firstElementChild!.children].map((el) => el.textContent?.trim()).filter(Boolean);
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
async function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(handlers).forEach((h) => h.mockReset());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('OpportunityActions', () => {
  it('puts Send to Actions, Generate Brief and Send to Editor in front, in that order', async () => {
    await render(props());
    expect(front()).toEqual(['Send to Actions', 'Generate Brief', 'Send to Editor', 'Export']);
    await act(async () => button('Send to Editor').click());
    expect(handlers.start).toHaveBeenCalled();
  });

  it('makes Write this the main one, beside Send to Editor (customer priorities item 9)', async () => {
    const writeThis = vi.fn();
    await render(props({ content: { ...props().content, onWriteThis: writeThis } }));
    expect(front()).toEqual([
      'Send to Actions',
      'Generate Brief',
      'Send to Editor',
      'Write this',
      'Export',
    ]);
    expect(button('Write this').title).toBe('Brief and draft in one go');
    await act(async () => button('Write this').click());
    expect(writeThis).toHaveBeenCalled();
    expect(handlers.start).not.toHaveBeenCalled();
    // Open draft takes both places once a draft is being written.
    await render(props({ content: { ...props().content, onWriteThis: writeThis, draftId: 'd7' } }));
    expect(front()).toEqual(['Send to Actions', 'Generate Brief', 'Open draft', 'Export']);
  });

  it('shows each one done in its place', async () => {
    await render(
      props({
        actionId: 'a7',
        brief: { generated: true, generating: false, blockedReason: null, onGenerate: vi.fn() },
        content: { ...props().content, draftId: 'd7' },
      }),
    );
    expect(front()).toEqual(['Open in Actions', 'Brief Generated', 'Open draft', 'Export']);
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/action-center/actions?action=a7',
    );
    await act(async () => button('Open draft').click());
    expect(handlers.openDraft).toHaveBeenCalledWith('d7');
  });

  it('waits for the draft lookup, and offers no Send to Editor where the editor has nothing to write', async () => {
    await render(props({ content: { ...props().content, draftId: undefined } }));
    expect(button('Send to Editor').disabled).toBe(true);
    await render(props({ content: { ...props().content, canStart: false } }));
    expect(front()).toEqual(['Send to Actions', 'Generate Brief', 'Export']);
  });

  it('offers Export CSV, Excel and Word, one under the other', async () => {
    await render(props());
    const trigger = button('Export');
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Export CSV',
      'Export Excel',
      'Export Word',
    ]);
    await act(async () => items[2].click());
    expect(handlers.export).toHaveBeenCalledWith('docx');
  });

  it('offers to check again when the draft lookup failed, never Start', async () => {
    await render(
      props({ content: { ...props().content, lookupFailed: true, onRetry: handlers.retry } }),
    );
    expect(front()).toEqual([
      'Send to Actions',
      'Generate Brief',
      "Couldn't check for a draft · Retry",
      'Export',
    ]);
    await act(async () => button("Couldn't check for a draft · Retry").click());
    expect(handlers.retry).toHaveBeenCalled();
    expect(handlers.start).not.toHaveBeenCalled();
  });

  it('keeps the rest in the "…" menu', async () => {
    await render(props());
    const items = await openMenu();
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Send to Plan',
      'Another angle',
      'Send to Workflow',
      'Copy All Data',
      'Mark as reviewed',
      'Dismiss',
    ]);
    // Another angle says what it does on hover.
    expect(items[1].getAttribute('title')).toBe(
      'Suggest one more opportunity for the same need, with a different angle',
    );
    await act(async () => items[5].click());
    expect(handlers.dismiss).toHaveBeenCalled();
  });

  it('opens the Plan once the opportunity is a priority there', async () => {
    await render(
      props({ plan: { prioritized: true, onSend: handlers.plan, onOpen: handlers.openPlan } }),
    );
    const item = (await openMenu()).find((i) => i.textContent?.trim() === 'Open in Plan')!;
    await act(async () => item.click());
    expect(handlers.openPlan).toHaveBeenCalled();
    expect(handlers.plan).not.toHaveBeenCalled();
  });
});
