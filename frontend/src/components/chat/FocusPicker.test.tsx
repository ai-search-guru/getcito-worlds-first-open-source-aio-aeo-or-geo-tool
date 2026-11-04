import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { FocusArea } from '@/lib/chat/focus';

/**
 * What Chat focuses on (CHAT-24 §3, §7 items 1–2; mockup #s-dept): the
 * picker opens once on the first Chat Home with the work areas' picks on,
 * Continue needs one, Skip for now keeps the default Home, and neither
 * brings it back by itself; Home's pill opens it again with the picks on.
 * Focus moves into the picker as it opens and back out as it closes.
 */

const prefs = vi.hoisted(() => ({
  ok: true,
  saveChatFocus: vi.fn(),
  skipChatFocus: vi.fn(),
  markFocusPrompted: vi.fn(),
}));
vi.mock('@/lib/actions/chatPrefs', () => ({
  saveChatFocus: prefs.saveChatFocus,
  skipChatFocus: prefs.skipChatFocus,
  markFocusPrompted: prefs.markFocusPrompted,
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ChatFocusGate, useChatFocus } = await import('./FocusPicker');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Stands in for Chat Home: its focus, the pill's Edit, and the composer. */
function Home({ readOnly = false }: { readOnly?: boolean }) {
  const focus = useChatFocus();
  return (
    <div data-slot="home">
      <span data-slot="home-focus">{focus?.focus.join(',')}</span>
      <button type="button" data-action="dept.change" onClick={focus?.edit}>
        Edit
      </button>
      <textarea data-action="composer.input" aria-label="Message" disabled={readOnly} />
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  prefs.ok = true;
  for (const action of [prefs.saveChatFocus, prefs.skipChatFocus, prefs.markFocusPrompted]) {
    action.mockReset().mockImplementation(async () => ({ ok: prefs.ok }));
  }
  toast.mockClear();
  toast.error.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(
  focus: FocusArea[] | null,
  ask: boolean,
  prefill: FocusArea[] = [],
  readOnly = false,
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatFocusGate focus={focus} ask={ask} prefill={prefill}>
          <Home readOnly={readOnly} />
        </ChatFocusGate>
      </NextIntlClientProvider>,
    );
  });
}

const $ = (selector: string) => host.querySelector(selector) as HTMLElement | null;
const click = (selector: string) => act(async () => $(selector)!.click());
const pressed = () =>
  [...host.querySelectorAll('[data-action="dept.pick"][aria-pressed="true"]')].map((b) =>
    b.getAttribute('data-dept'),
  );
const homeShown = () => $('[data-slot="focus-home"]')!.className === 'contents';
const pill = () => $('[data-slot="home"] [data-action="dept.change"]');
const composer = () => $('[data-action="composer.input"]');

describe('ChatFocusGate', () => {
  it('opens the picker once in place of Home, with the work areas’ picks on', async () => {
    await render(null, true, ['pd', 'bd']);
    expect($('h1')?.textContent).toBe('What should Chat focus on for you?');
    expect(host.querySelectorAll('[data-action="dept.pick"]')).toHaveLength(8);
    expect(pressed()).toEqual(['pd', 'bd']);
    expect($('[data-slot="focus-count"]')?.textContent).toBe(
      '2 selected · your access stays the same: what you can change still depends on your role.',
    );
    expect(homeShown()).toBe(false);
    expect(prefs.markFocusPrompted).toHaveBeenCalledOnce();
  });

  it('needs one pick to continue, and keeps the picks in the order picked', async () => {
    await render(null, true);
    expect(($('[data-action="dept.continue"]') as HTMLButtonElement).disabled).toBe(true);
    expect($('[data-slot="focus-count"]')?.textContent).toMatch(/^Pick at least one\./);
    await click('[data-dept="brand"]');
    await click('[data-dept="comp"]');
    expect(pressed()).toEqual(['comp', 'brand']);
    expect($('[data-dept="brand"]')?.textContent).toContain('Brand and reputation ✓');
    await click('[data-action="dept.continue"]');
    expect(prefs.saveChatFocus).toHaveBeenCalledWith(['brand', 'comp']);
    expect(homeShown()).toBe(true);
    expect($('[data-slot="home-focus"]')?.textContent).toBe('brand,comp');
    expect(toast).toHaveBeenCalledWith(
      'Home focused on Brand and Competitors · edit it in Settings › General',
    );
  });

  it('skips to the default Home', async () => {
    await render(null, true, ['lead']);
    await click('[data-action="dept.skip"]');
    expect(prefs.skipChatFocus).toHaveBeenCalledOnce();
    expect(homeShown()).toBe(true);
    expect($('[data-slot="home-focus"]')?.textContent).toBe('');
    expect(toast).toHaveBeenCalledWith('You can choose your focus later in Settings › General');
  });

  it('stays in the picker and says so when the pick isn’t kept', async () => {
    prefs.ok = false;
    await render(null, true, ['seo']);
    await click('[data-action="dept.continue"]');
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your focus. Try again.");
    expect(homeShown()).toBe(false);
    expect(pressed()).toEqual(['seo']);
    await click('[data-action="dept.skip"]');
    expect(homeShown()).toBe(false);
  });

  it('opens Home for someone already asked, and the pill reopens the picker with their picks', async () => {
    await render(['growth', 'content'], false, ['lead']);
    expect(homeShown()).toBe(true);
    expect($('[data-action="dept.pick"]')).toBeNull();
    expect(prefs.markFocusPrompted).not.toHaveBeenCalled();
    await click('[data-slot="home"] [data-action="dept.change"]');
    expect(pressed()).toEqual(['growth', 'content']);
    await click('[data-dept="growth"]');
    await click('[data-action="dept.continue"]');
    expect(prefs.saveChatFocus).toHaveBeenLastCalledWith(['content']);
  });

  it('leaves a focus as it was when the pill’s picker is cancelled', async () => {
    await render(['growth', 'content'], false);
    await click('[data-slot="home"] [data-action="dept.change"]');
    expect($('[data-action="dept.skip"]')?.textContent).toBe('Cancel');
    await click('[data-dept="growth"]');
    await click('[data-action="dept.skip"]');
    expect(prefs.skipChatFocus).not.toHaveBeenCalled();
    expect(prefs.saveChatFocus).not.toHaveBeenCalled();
    expect(homeShown()).toBe(true);
    expect($('[data-slot="home-focus"]')?.textContent).toBe('growth,content');
    await click('[data-slot="home"] [data-action="dept.change"]');
    expect(pressed()).toEqual(['growth', 'content']);
  });

  it('starts "Choose focus" with the work areas’ picks when there are none', async () => {
    await render([], false, ['pd']);
    await click('[data-slot="home"] [data-action="dept.change"]');
    expect(pressed()).toEqual(['pd']);
  });

  describe('keyboard focus', () => {
    it('starts at the question on the first opening, and goes to the composer after Skip for now', async () => {
      await render(null, true, ['pd']);
      expect(document.activeElement).toBe($('h1'));
      await click('[data-action="dept.skip"]');
      expect(homeShown()).toBe(true);
      expect(document.activeElement).toBe(composer());
    });

    it('goes to the composer after the first opening’s Continue', async () => {
      await render(null, true, ['pd']);
      await click('[data-action="dept.continue"]');
      expect(document.activeElement).toBe(composer());
    });

    it('moves into the picker from the pill and back to it on Cancel and on Continue', async () => {
      await render(['growth'], false);
      pill()!.focus();
      await click('[data-slot="home"] [data-action="dept.change"]');
      expect(document.activeElement).toBe($('h1'));
      expect($('h1')?.textContent).toBe('What should Chat focus on for you?');
      await click('[data-action="dept.skip"]');
      expect(document.activeElement).toBe(pill());
      await click('[data-slot="home"] [data-action="dept.change"]');
      expect(document.activeElement).toBe($('h1'));
      await click('[data-action="dept.continue"]');
      expect(prefs.saveChatFocus).toHaveBeenCalledWith(['growth']);
      expect(document.activeElement).toBe(pill());
    });

    it('lands on the pill when the composer can’t be typed in', async () => {
      await render(null, true, [], true);
      await click('[data-action="dept.skip"]');
      expect(document.activeElement).toBe(pill());
    });
  });
});
