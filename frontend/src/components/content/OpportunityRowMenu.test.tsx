import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { OpportunityRowMenu } from './OpportunityRowMenu';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const handlers = {
  start: vi.fn(),
  retry: vi.fn(),
  openDraft: vi.fn(),
  plan: vi.fn(),
  openPlan: vi.fn(),
  workflow: vi.fn(),
  dismiss: vi.fn(),
};

type Props = ComponentProps<typeof OpportunityRowMenu>;
const props = (over: Partial<Props> = {}): Props => ({
  title: 'Office coffee page',
  editor: {
    draftId: null,
    canStart: true,
    onStart: handlers.start,
    onOpenDraft: handlers.openDraft,
  },
  plan: { prioritized: false, onSend: handlers.plan, onOpen: handlers.openPlan },
  workflow: { sending: false, onSend: handlers.workflow },
  pageHref: '/dashboard/content/o1',
  onDismiss: handlers.dismiss,
  ...over,
});

async function open(p: Props) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OpportunityRowMenu {...p} />
      </NextIntlClientProvider>,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Actions for Office coffee page"]',
  )!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
const labels = (items: HTMLElement[]) => items.map((i) => i.textContent?.trim());

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

describe('OpportunityRowMenu', () => {
  it("keeps a row's actions in one menu, with Send to Editor and Send to Plan", async () => {
    const items = await open(props());
    expect(labels(items)).toEqual([
      'Send to Editor',
      'Send to Plan',
      'Send to Workflow',
      'Open in new tab',
      'Dismiss',
    ]);
    expect(items[3].getAttribute('href')).toBe('/dashboard/content/o1');
    expect(items[3].getAttribute('target')).toBe('_blank');
    await act(async () => items[0].click());
    expect(handlers.start).toHaveBeenCalled();
  });

  it('offers Write this first, saying what it does, where Start is offered (customer priorities item 9)', async () => {
    const writeThis = vi.fn();
    let items = await open(props({ editor: { ...props().editor, onWriteThis: writeThis } }));
    expect(labels(items).slice(0, 2)).toEqual([
      'Write thisBrief and draft in one go',
      'Send to Editor',
    ]);
    await act(async () => items[0].click());
    expect(writeThis).toHaveBeenCalled();
    expect(handlers.start).not.toHaveBeenCalled();

    // A draft being written opens instead of either.
    act(() => root.unmount());
    root = createRoot(container);
    document.querySelectorAll('[role="menu"]').forEach((m) => m.remove());
    items = await open(
      props({ editor: { ...props().editor, onWriteThis: writeThis, draftId: 'd7' } }),
    );
    expect(labels(items)[0]).toBe('Open draft');
    expect(labels(items)).not.toContain('Send to Editor');
  });

  it('opens what is already there: the draft, and the Plan', async () => {
    const items = await open(
      props({
        editor: { ...props().editor, draftId: 'd7' },
        plan: { prioritized: true, onSend: handlers.plan, onOpen: handlers.openPlan },
      }),
    );
    expect(labels(items).slice(0, 2)).toEqual(['Open draft', 'Open in Plan']);
    await act(async () => items[0].click());
    expect(handlers.openDraft).toHaveBeenCalledWith('d7');
  });

  it('offers to check again when the draft lookup failed, never Start', async () => {
    const items = await open(
      props({ editor: { ...props().editor, lookupFailed: true, onRetry: handlers.retry } }),
    );
    expect(labels(items)[0]).toBe("Couldn't check for a draft · Retry");
    expect(labels(items)).not.toContain('Send to Editor');
    await act(async () => items[0].click());
    expect(handlers.retry).toHaveBeenCalled();
    expect(handlers.start).not.toHaveBeenCalled();
  });

  it('waits for its lookups, and leaves out what the row has no use for', async () => {
    let items = await open(
      props({
        editor: { ...props().editor, draftId: undefined },
        plan: { prioritized: undefined, onSend: handlers.plan, onOpen: handlers.openPlan },
      }),
    );
    expect(items.slice(0, 2).every((i) => i.hasAttribute('data-disabled'))).toBe(true);

    // Earned work, a member, a status past New.
    act(() => root.unmount());
    root = createRoot(container);
    document.querySelectorAll('[role="menu"]').forEach((m) => m.remove());
    items = await open(
      props({
        editor: { ...props().editor, canStart: false },
        plan: null,
        workflow: null,
        onDismiss: undefined,
      }),
    );
    expect(labels(items)).toEqual(['Open in new tab']);
  });
});
