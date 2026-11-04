import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Settings › AI Providers: a row per provider with its saved key, the one
 * Chat uses, and — for admins — adding, replacing, switching and removing.
 * On a read-only workspace (plan not active) adding, replacing and switching
 * open the upgrade dialog; removing a key stays open. With Chat on, own keys
 * are Enterprise's: below it only Remove, and a kept key until its date.
 */

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

let canAdmin = true;
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ role: canAdmin ? 'admin' : 'member', canManage: canAdmin, canAdmin }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { AiProvidersSection } = await import('./AiProvidersSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
let saved: unknown[];
let access: unknown;
/** The key guard, sent to Admins where Chat runs on own keys; absent otherwise. */
let guard: unknown;
const openUpgrade = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  canAdmin = true;
  saved = [
    {
      provider: 'anthropic',
      last4: 'abcd',
      settings: {},
      active: true,
      setAt: '2026-10-19T08:00:00Z',
      setByEmail: 'ada@acme.test',
    },
    {
      provider: 'openai',
      last4: 'wxyz',
      settings: { model: 'gpt-5.4' },
      active: false,
      setAt: '2026-10-18T08:00:00Z',
      setByEmail: null,
    },
  ];
  access = undefined;
  guard = undefined;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    !init?.method
      ? json({ configured: true, providers: saved, access, guard })
      : json({ ok: true }),
  );
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

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <AiProvidersSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const row = (provider: string) =>
  container.querySelector(`[data-provider="${provider}"]`) as HTMLElement;
const button = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement;

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('AiProvidersSection', () => {
  it('shows each provider, the one Chat uses, and the model each calls', async () => {
    await render();
    expect(row('anthropic').textContent).toContain('Used by Chat');
    expect(row('anthropic').textContent).toContain('Model claude-sonnet-5');
    expect(row('anthropic').textContent).toContain('by ada@acme.test');
    expect(row('openai').textContent).toContain('Key saved');
    expect(row('openai').textContent).toContain('Model gpt-5.4');
    expect(row('azure').textContent).toContain('OpenAI models deployed in your own Azure');
    expect(button(row('azure'), 'Add key')).toBeTruthy();
    expect(button(row('anthropic'), 'Use for Chat')).toBeUndefined();
    expect(container.textContent).not.toContain('No key yet');
  });

  it('switches Chat to another saved provider', async () => {
    await render();
    await act(async () => button(row('openai'), 'Use for Chat').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(toast.success).toHaveBeenCalledWith('Chat now uses OpenAI');
  });

  it("checks Azure's endpoint before saving, then saves the key with its settings", async () => {
    await render();
    act(() => button(row('azure'), 'Add key').click());
    const form = row('azure').querySelector('form') as HTMLFormElement;
    type(
      form.querySelector('#ai-provider-azure-key') as HTMLInputElement,
      'azure-key-0123456789abc',
    );
    type(
      form.querySelector('#ai-provider-azure-endpoint') as HTMLInputElement,
      'https://x.example',
    );
    type(form.querySelector('#ai-provider-azure-deployment') as HTMLInputElement, 'gpt-5-chat');
    await act(async () => button(form, 'Save').click());
    expect(form.textContent).toContain("Enter your resource's endpoint");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    type(
      form.querySelector('#ai-provider-azure-endpoint') as HTMLInputElement,
      'https://acme.openai.azure.com/',
    );
    await act(async () => button(form, 'Save').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'azure',
        apiKey: 'azure-key-0123456789abc',
        settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'gpt-5-chat' },
      }),
    });
    expect(toast.success).toHaveBeenCalledWith('Microsoft Azure OpenAI key saved');
    expect(row('azure').querySelector('form')).toBeNull();
  });

  it('removes a key after asking', async () => {
    await render();
    act(() =>
      (
        row('openai').querySelector('button[aria-label="Remove key: OpenAI"]') as HTMLElement
      ).click(),
    );
    expect(document.body.textContent).toContain('Remove the OpenAI API key?');
    await act(async () => button(document.body, 'Remove').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers?provider=openai', {
      method: 'DELETE',
    });
  });

  it('on a read-only workspace, saves and switches nothing, and still removes a key', async () => {
    await render(true);
    act(() => button(row('azure'), 'Add key').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Saving an AI key needs a plan');
    expect(row('azure').querySelector('form')).toBeNull();
    await act(async () => button(row('openai'), 'Use for Chat').click());
    expect(openUpgrade).toHaveBeenLastCalledWith("Switching Chat's AI provider needs a plan");
    // Only the read went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() =>
      (
        row('openai').querySelector('button[aria-label="Remove key: OpenAI"]') as HTMLElement
      ).click(),
    );
    await act(async () => button(document.body, 'Remove').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers?provider=openai', {
      method: 'DELETE',
    });
    expect(openUpgrade).toHaveBeenCalledTimes(2);
  });

  it('shows members the keys without the buttons that change them', async () => {
    canAdmin = false;
    saved = [];
    await render();
    expect(container.textContent).toContain('No key yet');
    expect(container.textContent).toContain('Admin-only setting');
    expect(button(row('anthropic'), 'Add key')).toBeUndefined();
  });

  it('says own keys are Enterprise’s below it, and leaves only Remove', async () => {
    access = { state: 'locked' };
    await render();
    expect(container.textContent).toContain('Own AI keys come with the Enterprise plan.');
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')?.textContent).toBe(
      'Compare plans',
    );
    expect(container.textContent).not.toContain('No key yet');
    expect(row('anthropic').textContent).toContain('Not used on your plan');
    for (const provider of ['anthropic', 'openai', 'azure']) {
      for (const label of ['Add key', 'Replace', 'Use for Chat']) {
        expect(button(row(provider), label)).toBeUndefined();
      }
    }
    expect(row('openai').querySelector('button[aria-label="Remove key: OpenAI"]')).toBeTruthy();
  });

  it('shows the key guard under the keys only when the route sends it', async () => {
    access = { state: 'plan' };
    await render();
    expect(container.querySelector('[data-slot="own-key-guard"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    guard = { capUsd: 250, usedUsd: 12, renewsAt: null };
    await render();
    const card = container.querySelector('[data-slot="own-key-guard"]') as HTMLElement;
    expect(card.textContent).toContain('Agents on your key');
    expect(card.textContent).toContain('This month: about $12 of $250');
  });

  it('keeps a saved key until its date: replaced or switched to, no other provider added', async () => {
    access = { state: 'kept', until: '2026-12-01T12:00:00Z' };
    await render();
    expect(container.textContent).toContain('Your saved key keeps running Chat until Dec 1, 2026.');
    expect(button(row('anthropic'), 'Replace')).toBeTruthy();
    expect(button(row('openai'), 'Use for Chat')).toBeTruthy();
    expect(button(row('azure'), 'Add key')).toBeUndefined();
  });

  describe('the key’s health and Test (AGENT-OWN-KEY §5.2 item 7)', () => {
    const health = (over: Record<string, unknown>) => ({
      checkedAt: null,
      failingSince: null,
      failureClass: null,
      ...over,
    });
    const line = (provider: string) =>
      row(provider).querySelector('[data-slot="key-health"]')?.textContent ?? null;

    beforeEach(() => {
      access = { state: 'plan' };
      (saved[0] as Record<string, unknown>).health = health({
        failingSince: '2026-11-01T09:00:00Z',
        failureClass: 'no_credit',
      });
      (saved[1] as Record<string, unknown>).health = health({
        checkedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      });
    });

    it('says whether each key works, while Chat runs on the own key', async () => {
      await render();
      expect(line('anthropic')).toContain('Not working since');
      expect(line('anthropic')).toContain('Your Anthropic account is out of credit.');
      expect(row('anthropic').querySelector('[data-tone="fail"]')).not.toBeNull();
      expect(line('openai')).toMatch(/^Working · checked /);
      // A provider without a key has none.
      expect(line('google')).toBeNull();

      (saved[1] as Record<string, unknown>).health = health({});
      access = undefined;
      act(() => root.unmount());
      root = createRoot(container);
      await render();
      // Today's Agent Chat (Chat off): no health, no Test.
      expect(line('anthropic')).toBeNull();
      expect(button(row('anthropic'), 'Test')).toBeUndefined();
    });

    it('tests a key: Testing… while it runs, then what it found', async () => {
      let answer: (res: Response) => void = () => {};
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/api/settings/ai-providers/test') {
          return new Promise<Response>((resolve) => (answer = resolve));
        }
        return !init?.method ? json({ configured: true, providers: saved, access }) : json({});
      });
      await render();
      act(() => button(row('anthropic'), 'Test').click());
      const testing = button(row('anthropic'), 'Testing…');
      expect(testing).toBeDefined();
      expect((testing as HTMLButtonElement).disabled).toBe(true);
      await act(async () => answer(json({ ok: true, outcome: 'working', resumed: 2 })));
      expect(toast.success).toHaveBeenCalledWith(
        'Your Anthropic key works. 2 paused agents started again.',
      );

      act(() => button(row('openai'), 'Test').click());
      await act(async () => answer(json({ ok: true, outcome: 'failing', class: 'no_credit' })));
      expect(toast.error).toHaveBeenCalledWith('Your OpenAI account is out of credit.');

      act(() => button(row('openai'), 'Test').click());
      await act(async () => answer(json({ ok: true, outcome: 'unknown', resumed: 0 })));
      expect(toast).toHaveBeenCalledWith('Couldn’t check the key just now. Try again in a moment.');
    });

    it('shows under the key why its test turned it down, and keeps the form open', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        !init?.method
          ? json({ configured: true, providers: saved, access })
          : json({ code: 'key_model', field: 'apiKey', error: 'x' }, 400),
      );
      await render();
      act(() => button(row('openai'), 'Replace').click());
      const form = row('openai').querySelector('form') as HTMLFormElement;
      const key = form.querySelector('#ai-provider-openai-key') as HTMLInputElement;
      type(key, 'sk-openai-0123456789abcdef');
      await act(async () => button(form, 'Save').click());
      expect(form.querySelector('[data-slot="key-error"]')!.textContent).toBe(
        'OpenAI can’t find the model gpt-5.4 for this key.',
      );
      expect(key.getAttribute('aria-invalid')).toBe('true');
      expect(toast.success).not.toHaveBeenCalled();
      // Typing again clears it.
      type(key, 'sk-openai-0123456789abcdeg');
      expect(form.querySelector('[data-slot="key-error"]')).toBeNull();
    });

    it('saves a key out of credit with a warning, and one it couldn’t check with a note', async () => {
      let answer = { ok: true, check: 'no_credit' } as Record<string, unknown>;
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        !init?.method ? json({ configured: true, providers: saved, access }) : json(answer),
      );
      await render();
      act(() => button(row('openai'), 'Replace').click());
      let form = row('openai').querySelector('form') as HTMLFormElement;
      type(
        form.querySelector('#ai-provider-openai-key') as HTMLInputElement,
        'sk-0123456789abcdef',
      );
      await act(async () => button(form, 'Save').click());
      expect(toast.warning).toHaveBeenCalledWith(
        'Saved. Your OpenAI account is out of credit, so Chat and agents stop on it until it has credit.',
      );

      answer = { ok: true, check: 'unchecked' };
      act(() => button(row('openai'), 'Replace').click());
      form = row('openai').querySelector('form') as HTMLFormElement;
      type(
        form.querySelector('#ai-provider-openai-key') as HTMLInputElement,
        'sk-0123456789abcdef',
      );
      await act(async () => button(form, 'Save').click());
      expect(toast).toHaveBeenCalledWith('Saved. Couldn’t check the key just now.');
    });

    it('refuses switching to a key that fails, and says where Chat goes when Chat’s key is removed', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        !init?.method
          ? json({ configured: true, providers: saved, access })
          : json({ code: 'key_invalid', field: 'apiKey', error: 'x' }, 400),
      );
      await render();
      await act(async () => button(row('openai'), 'Use for Chat').click());
      expect(toast.error).toHaveBeenCalledWith('OpenAI turned down this key.');
      expect(toast.success).not.toHaveBeenCalled();

      act(() =>
        (
          row('anthropic').querySelector(
            'button[aria-label="Remove key: Anthropic"]',
          ) as HTMLElement
        ).click(),
      );
      expect(document.body.textContent).toContain(
        'or to your plan’s monthly AI limit when there is none. Agents paused because this key failed start again.',
      );
    });
  });
});
