import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import type { OwnKeyGuard } from '@/lib/chat/ownKeyGuard';

/**
 * Settings › AI Providers › Agents on your key (AGENT-OWN-KEY §4.3, PR 9):
 * the most all agents may spend on the workspace's own key a month, $10 to
 * $10,000, and this month's estimate, amber from 80% and red at the limit.
 */

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { OwnKeyGuardCard } = await import('./OwnKeyGuardCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const GUARD: OwnKeyGuard = { capUsd: 250, usedUsd: 182.4, renewsAt: '2026-11-20T09:00:00.000Z' };

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onSaved = vi.fn();
const openUpgrade = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(json({ ok: true, guard: { ...GUARD, capUsd: 400 } }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(guard: OwnKeyGuard | null, isLocked = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <OwnKeyGuardCard guard={guard} onSaved={onSaved} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const input = () => container.querySelector('#own-key-guard') as HTMLInputElement;
const save = () =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Save',
  ) as HTMLButtonElement;
const bar = () => container.querySelector('[role="progressbar"]') as HTMLElement;

function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('OwnKeyGuardCard', () => {
  it('shows the limit and this month’s estimate, with when it renews', () => {
    render(GUARD);
    expect(container.textContent).toContain('Agents on your key');
    expect(container.textContent).toContain('from $10 to $10,000 a month');
    expect(input().value).toBe('250');
    expect(container.textContent).toContain('This month: about $182 of $250 · renews Nov 20');
    expect(container.textContent).toContain('Estimated');
    expect(container.textContent).toContain("An estimate at the providers' list prices.");
    expect(bar().getAttribute('aria-valuenow')).toBe('73');
    expect(bar().firstElementChild!.className).not.toMatch(/amber|destructive/);
    expect(save().disabled).toBe(true);
  });

  it('turns the bar amber from 80% and red at the limit', () => {
    render({ ...GUARD, usedUsd: 205 });
    expect(bar().firstElementChild!.className).toContain('bg-amber-500');
    render({ ...GUARD, usedUsd: 260, renewsAt: null });
    expect(bar().firstElementChild!.className).toContain('bg-destructive');
    expect(bar().getAttribute('aria-valuenow')).toBe('100');
    expect(container.textContent).toContain('This month: about $260 of $250');
    expect(container.textContent).not.toContain('· renews');
  });

  it('saves a new limit and hands back the guard read again', async () => {
    render(GUARD);
    type('400');
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers/guard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capUsd: 400 }),
    });
    expect(onSaved).toHaveBeenCalledWith({ ...GUARD, capUsd: 400 });
    expect(toast.success).toHaveBeenCalledWith('Limit saved');
  });

  it('keeps this month’s last read with the new limit when the guard can’t be read again', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, guard: null }));
    render(GUARD);
    type('400');
    await act(async () => save().click());
    expect(onSaved).toHaveBeenCalledWith({ ...GUARD, capUsd: 400 });
  });

  it('keeps Save off out of range, and says the range', () => {
    render(GUARD);
    for (const value of ['5', '10001', '']) {
      type(value);
      expect(save().disabled).toBe(true);
      expect(container.textContent).toContain('Set a limit from $10 to $10,000.');
    }
    type('10');
    expect(save().disabled).toBe(false);
  });

  it('says so when the limit can’t be kept yet, or wasn’t saved', async () => {
    render(GUARD);
    type('300');
    fetchMock.mockResolvedValueOnce(json({ error: 'Not available yet', code: 'unavailable' }, 503));
    await act(async () => save().click());
    expect(toast.error).toHaveBeenCalledWith(
      "This limit can't be changed yet. Try again after the next update.",
    );
    fetchMock.mockResolvedValueOnce(json({ error: 'boom' }, 500));
    await act(async () => save().click());
    expect(toast.error).toHaveBeenLastCalledWith("The limit couldn't be saved. Try again.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('opens the upgrade dialog on a read-only workspace instead of saving', async () => {
    render(GUARD, true);
    type('300');
    await act(async () => save().click());
    expect(openUpgrade).toHaveBeenCalledWith("Saving the agents' limit on your key needs a plan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the month couldn’t be read when the server didn’t answer', () => {
    render(null);
    expect(container.textContent).toContain("This month's use couldn't be read just now.");
    expect(input()).toBeNull();
  });
});
