import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import type { ApiFailure } from '@/lib/apiFailure';
import { useFailureToast } from './useFailureToast';

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
// The dashboard's read-only state: none outside its provider.
const openUpgrade = vi.fn();
let upgrade: { isLocked: boolean; openUpgrade: () => void } | null = null;
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeDialog: () => upgrade,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Shows the failure's toast once, and returns what toast.error got. */
function show(failure: ApiFailure, options?: { id?: string; description?: string }) {
  toast.error.mockReset();
  toast.dismiss.mockReset();
  push.mockReset();
  openUpgrade.mockReset();
  function Probe() {
    const failureToast = useFailureToast();
    failureToast(failure, options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe />
      </NextIntlClientProvider>,
    ),
  );
  act(() => root.unmount());
  return toast.error.mock.calls[0] as [string, { action?: { label: string; onClick: () => void } }];
}

describe('useFailureToast (BUG-001)', () => {
  it('says another workspace’s brand plainly, and offers the member’s brands', () => {
    const [message, options] = show('workspace');
    expect(message).toBe("This brand isn't in your workspace. Switch to one of your brands.");
    expect(options.action?.label).toBe('Your brands');
    options.action?.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/brands');
  });

  it('asks to sign in again for an expired session, and to upgrade for a limit', () => {
    expect(show('session')[1].action?.label).toBe('Sign in');
    const [message, options] = show('limit', { id: 't1' });
    expect(message).toBe("You've used this month's allowance. Upgrade, or wait until it resets.");
    expect(options).toMatchObject({ id: 't1', action: { label: 'Upgrade' } });
  });

  it('asks to wait a minute for a rate limit, with nothing to click', () => {
    const [message, options] = show('busy');
    expect(message).toBe('Too many requests. Wait a minute and try again.');
    expect(options.action).toBeUndefined();
  });

  it('offers nothing to click for a plain failure', () => {
    const [message, options] = show('failed');
    expect(message).toBe('Something went wrong. Try again.');
    expect(options.action).toBeUndefined();
  });

  it('keeps the toast for a feature the plan lacks or a used-up allowance', () => {
    upgrade = { isLocked: false, openUpgrade };
    const [message, options] = show('plan');
    expect(message).toBe("Your plan doesn't include this. Upgrade to use it.");
    expect(options.action?.label).toBe('Upgrade');
    expect(show('limit')[1].action?.label).toBe('Upgrade');
    expect(openUpgrade).not.toHaveBeenCalled();
    upgrade = null;
  });

  describe('a workspace whose plan is not active', () => {
    it('opens the upgrade dialog instead of a toast, and clears the loading toast', () => {
      upgrade = { isLocked: true, openUpgrade };
      expect(show('subscription', { id: 't1' })).toBeUndefined();
      expect(openUpgrade).toHaveBeenCalledTimes(1);
      expect(toast.dismiss).toHaveBeenCalledWith('t1');
      upgrade = null;
    });

    it('opens it for the server’s subscription_inactive even before the page knows', () => {
      upgrade = { isLocked: false, openUpgrade };
      expect(show('subscription')).toBeUndefined();
      expect(openUpgrade).toHaveBeenCalledTimes(1);
      expect(toast.dismiss).not.toHaveBeenCalled();
      upgrade = null;
    });

    it('opens it for any plan refusal while the dashboard is read-only, not for a limit', () => {
      upgrade = { isLocked: true, openUpgrade };
      expect(show('plan')).toBeUndefined();
      expect(openUpgrade).toHaveBeenCalledTimes(1);
      expect(show('limit')[0]).toBe(
        "You've used this month's allowance. Upgrade, or wait until it resets.",
      );
      upgrade = null;
    });

    it('falls back to a toast with Choose a plan outside the dashboard', () => {
      upgrade = null;
      const [message, options] = show('subscription');
      expect(message).toBe(
        "Your workspace's plan isn't active, so changes are paused. Choose a plan to use GetCito again.",
      );
      expect(options.action?.label).toBe('Choose a plan');
      options.action?.onClick();
      expect(push).toHaveBeenCalledWith('/dashboard/settings/billing');
    });
  });
});
