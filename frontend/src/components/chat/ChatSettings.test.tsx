import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { FocusArea } from '@/lib/chat/focus';
import type { ChatGeneralAccess, ChatGeneralSettings } from '@/lib/chat/generalSettings';

/**
 * Chat Settings › General (mockup #s-settings): each pick shows at once and
 * is kept on the person; one that isn't kept goes back and says so. Full
 * auto says why it's locked and can't be picked; a reader picks no mode.
 * Answer language, notifications and "Thought for N s" stay hidden until
 * something reads them.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));
const toasts = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('sonner', () => {
  const toast = (text: string) => toasts.calls.push(text);
  toast.error = (text: string) => toasts.calls.push(`error: ${text}`);
  return { toast };
});
const saved = vi.hoisted(() => ({ ok: true, patches: [] as unknown[], focus: [] as unknown[] }));
vi.mock('@/lib/actions/chatPrefs', () => ({
  saveChatGeneralSettings: vi.fn(async (patch: unknown) => {
    saved.patches.push(patch);
    return { ok: saved.ok };
  }),
  saveChatFocus: vi.fn(async (areas: unknown) => {
    saved.focus.push(areas);
    return { ok: saved.ok };
  }),
}));

const { ChatSettings } = await import('./ChatSettings');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SETTINGS: ChatGeneralSettings = {
  defaultMode: 'auto',
  answerLanguage: null,
  notifyVia: 'inbox_email',
  showThought: true,
  panelOnPages: true,
};
const OPEN: ChatGeneralAccess = { modes: true, fullAutoLock: null, slack: false };

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  saved.ok = true;
  saved.patches = [];
  saved.focus = [];
  toasts.calls = [];
  router.refresh.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(settings = SETTINGS, access = OPEN, focus: FocusArea[] = []) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatSettings initial={settings} access={access} focus={focus} />
      </NextIntlClientProvider>,
    );
  });
}

const action = (name: string) => host.querySelectorAll<HTMLElement>(`[data-action="${name}"]`);
const modes = () => [...action('chatSettings.defaultMode')];

describe('ChatSettings', () => {
  it("shows the General settings as the mockup does, with the person's choices", async () => {
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Settings');
    expect(host.querySelector('h2')?.textContent).toBe('General');
    expect(modes().map((m) => m.textContent)).toEqual([
      'Ask me first',
      'Auto, ask before changes',
      'Full auto',
    ]);
    expect(modes()[1].getAttribute('aria-checked')).toBe('true');
    expect(action('chatSettings.toggleAskChatEverywhere')[0].getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(action('policy.open')[0].getAttribute('href')).toBe('/dashboard/settings/chat');
  });

  it("hides the settings nothing reads yet: notifications, 'Thought for N s'", async () => {
    await render();
    expect(action('chatSettings.notifyChannel')).toHaveLength(0);
    expect(action('chatSettings.toggleThinking')).toHaveLength(0);
    expect(host.textContent).not.toContain('Notify me when an agent needs me');
    expect(host.textContent).not.toContain('Thought for');
  });

  it('offers the answer languages Chat reads, "Same as my question" first, and keeps a pick at once', async () => {
    await render();
    const select = action('chatSettings.answerLanguage')[0] as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Same as my question',
      'English',
      'Türkçe',
      'Deutsch',
      'Français',
      'Español',
      'Italiano',
      'Português',
      'Nederlands',
    ]);
    expect(select.value).toBe('');
    await act(async () => {
      select.value = 'tr';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saved.patches).toEqual([{ answerLanguage: 'tr' }, { answerLanguage: null }]);
  });

  it('keeps each pick at once', async () => {
    await render();
    await act(async () => modes()[0].click());
    expect(modes()[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => action('chatSettings.toggleAskChatEverywhere')[0].click());
    expect(saved.patches).toEqual([{ defaultMode: 'ask_first' }, { panelOnPages: false }]);
    expect(action('chatSettings.toggleAskChatEverywhere')[0].getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(toasts.calls).toEqual([]);
    // Ask Chat on every page: the layout reads it again, so every page follows.
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("puts a pick back when it wasn't kept, and says so", async () => {
    saved.ok = false;
    await render();
    await act(async () => action('chatSettings.toggleAskChatEverywhere')[0].click());
    expect(action('chatSettings.toggleAskChatEverywhere')[0].getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(toasts.calls).toEqual(["error: Couldn't save that. Try again."]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('says why Full auto is locked and keeps it from being picked', async () => {
    await render(SETTINGS, { ...OPEN, fullAutoLock: 'plan' });
    const fullAuto = modes()[2];
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    expect(fullAuto.getAttribute('title')).toBe('Full auto needs the Growth plan');
    await act(async () => fullAuto.click());
    expect(saved.patches).toEqual([]);
  });

  it('gives a role that only reads no default mode', async () => {
    await render(SETTINGS, { ...OPEN, modes: false });
    expect(modes()).toHaveLength(0);
    expect(action('chatSettings.toggleAskChatEverywhere')).toHaveLength(1);
  });
  it('shows the focus picked, and keeps a change at once in the order picked (CHAT-24 §3 item 2)', async () => {
    await render(SETTINGS, OPEN, ['pd']);
    const boxes = () => [...action('chatSettings.focus')] as HTMLInputElement[];
    expect(boxes().map((box) => box.parentElement?.textContent)).toEqual([
      'Big picture',
      'Competitors',
      'AI traffic',
      'Prompts and citations',
      'Content',
      'Brand',
      'Product',
      'Markets and sources',
    ]);
    expect(
      boxes()
        .filter((box) => box.checked)
        .map((box) => box.value),
    ).toEqual(['pd']);
    await act(async () => boxes()[0].click());
    await act(async () => boxes()[6].click());
    await act(async () => boxes()[0].click());
    expect(saved.focus).toEqual([['pd', 'lead'], ['lead'], []]);
    expect(toasts.calls).toEqual([
      'Home focused on Product and Big picture',
      'Home focused on Big picture',
      'Focus cleared · default Home',
    ]);
  });

  it('gives a role that only reads its focus too, and puts a change back that was not kept', async () => {
    saved.ok = false;
    await render(SETTINGS, { ...OPEN, modes: false }, ['brand']);
    const brand = [...action('chatSettings.focus')].find(
      (box) => (box as HTMLInputElement).value === 'brand',
    ) as HTMLInputElement;
    await act(async () => brand.click());
    expect(brand.checked).toBe(true);
    expect(toasts.calls).toEqual(["error: Couldn't save that. Try again."]);
  });
});
