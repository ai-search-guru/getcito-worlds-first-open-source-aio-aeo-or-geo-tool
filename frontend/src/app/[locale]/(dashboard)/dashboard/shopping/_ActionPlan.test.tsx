import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PlannedWork } from '@/lib/shopping/actionPlan';

/** "Actions to get on the shelf" (ECOM-013). */

const sendShoppingActions = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    loading: vi.fn(() => 't1'),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
);
vi.mock('@/lib/actions/shopping', () => ({ sendShoppingActions }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast }));

const { ActionPlan } = await import('./_ActionPlan');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sendShoppingActions.mockReset();
  push.mockReset();
  for (const fn of [toast.success, toast.info, toast.error]) fn.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const plan: PlannedWork[] = [
  {
    type: 'optimize_page',
    who: 'agent',
    where: 'productMode',
    agentCan: true,
    line: { key: 'optimizeWords', values: { words: 'women, lightweight' } },
  },
  { type: 'technical', who: 'me', where: 'feed', agentCan: false, line: { key: 'gtinSchema' } },
];

function render(onSent = vi.fn()) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ActionPlan
          brandId="b1"
          target={{ type: 'product', id: 'p1' }}
          plan={plan}
          promptIds={['q1']}
          onSent={onSent}
        />
      </NextIntlClientProvider>,
    );
  });
  return onSent;
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement;

describe('ActionPlan', () => {
  it('lists each work type with its line and where it happens, the agent off for a technical fix', () => {
    render();
    expect(container.textContent).toContain(
      'Optimize page · Rewrite the page for what AI asked for: women, lightweight',
    );
    expect(container.textContent).toContain('Content Editor · the product');
    const agents = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Agent',
    );
    expect(agents.map((b) => [b.getAttribute('aria-pressed'), b.disabled])).toEqual([
      ['true', false],
      ['false', true],
    ]);
  });

  it('sends what is picked, with who does it and its line, and opens the action from the toast', async () => {
    sendShoppingActions.mockResolvedValue({ actionId: 'a1', actionNo: 301, created: true });
    const onSent = render();
    // Me for the page, then leave the technical fix out.
    act(() =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Me')!.click(),
    );
    act(() =>
      (container.querySelectorAll('button[role="checkbox"]')[1] as HTMLButtonElement).click(),
    );
    await act(async () => button('Send 1 action to Action Center').click());
    expect(sendShoppingActions).toHaveBeenCalledWith(
      'b1',
      { type: 'product', id: 'p1' },
      [
        {
          type: 'optimize_page',
          who: 'me',
          why: 'Rewrite the page for what AI asked for: women, lightweight',
        },
      ],
      ['q1'],
    );
    expect(toast.success).toHaveBeenCalledWith(
      'Sent to Action Center as #301',
      expect.objectContaining({ id: 't1' }),
    );
    toast.success.mock.calls[0][1].action.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/action-center/actions?action=a1');
    expect(onSent).toHaveBeenCalled();
  });

  it('says when it was already sent, or failed', async () => {
    sendShoppingActions.mockResolvedValueOnce({ actionId: 'a0', actionNo: 299, created: false });
    render();
    await act(async () => button('Send 2 actions to Action Center').click());
    expect(toast.info).toHaveBeenCalledWith('Already in Action Center as #299', expect.anything());
    sendShoppingActions.mockResolvedValueOnce({ error: 'Product not found' });
    await act(async () => button('Send 2 actions to Action Center').click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't send to Action Center. Try again.", {
      id: 't1',
      description: 'Product not found',
    });
  });
});
