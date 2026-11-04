import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { DemoBrandContext } from '@/components/context/DemoBrandProvider';

/**
 * Chat on a read-only workspace (plan not active): New chat and sending open
 * the upgrade dialog, named, and send nothing. The conversations still list
 * and open, and deleting one stays open, as its route does.
 */

const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  stop: vi.fn(),
  clearError: vi.fn(),
}));
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({ messages: [], status: 'ready', error: undefined, ...chat }),
}));
vi.mock('ai', () => ({ DefaultChatTransport: class {} }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/hooks/useFeatureGate', () => ({
  useFeatureGate: () => ({ canUse: () => true, requiredPlanFor: () => 'Starter', isCloud: false }),
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (select: (state: unknown) => unknown) => select({ activeBrandId: 'b1' }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AgentPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const fetchMock = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/agent/conversations'
      ? json({
          conversations: [
            {
              id: 'c1',
              title: 'Pricing questions',
              brand_id: 'b1',
              created_at: '2026-10-27',
              updated_at: '2026-10-27',
            },
          ],
        })
      : json({ messages: [] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

async function render(isLocked: boolean, isDemo = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DemoBrandContext.Provider
          value={{ isDemo, demoBrand: null, offer: 'trial', neverSubscribed: true }}
        >
          <UpgradeDialogContext.Provider
            value={{
              isLocked,
              isDemo,
              reason: isDemo ? 'demo' : 'ended',
              adminName: null,
              openUpgrade,
            }}
          >
            <AgentPage />
          </UpgradeDialogContext.Provider>
        </DemoBrandContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const remove = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Delete conversation"]')!;
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method);

async function send(text: string) {
  const input = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('Chat on a read-only workspace', () => {
  it('starts and sends nothing: each opens the upgrade dialog', async () => {
    await render(true);
    expect(container.textContent).toContain('Pricing questions');

    await act(async () => button('New chat').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Starting a chat needs a plan');
    await send('How do we rank?');
    expect(openUpgrade).toHaveBeenLastCalledWith('Chatting with the agent needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it.each([true, false])(
    'asks before deleting a conversation, read-only or not (locked: %s)',
    async (isLocked) => {
      await render(isLocked);
      await act(async () => remove().click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Delete conversation',
      );
      expect(openUpgrade).not.toHaveBeenCalled();
    },
  );

  it('still deletes a conversation on a read-only workspace, after its confirm', async () => {
    await render(true);
    await act(async () => remove().click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Delete',
    )!;
    await act(async () => confirm.click());
    expect(writes()).toEqual([['/api/agent/conversations/c1', { method: 'DELETE' }]]);
    expect(container.textContent).not.toContain('Pricing questions');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

// The demo brand's Chat is the real one, locked as the rest of the demo
// (useUpgradeGate's isLocked): with the new Chat off, this page, as on a
// read-only workspace.
describe('Chat on the demo brand', () => {
  it('opens the Agent Chat, which starts and sends nothing: each opens the upgrade dialog', async () => {
    await render(true, true);
    expect(container.textContent).toContain('Pricing questions');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).not.toContain('Soon');

    await act(async () => button('New chat').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Starting a chat needs a plan');
    await send('How do we rank?');
    expect(openUpgrade).toHaveBeenLastCalledWith('Chatting with the agent needs a plan');
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
