'use client';

import { createContext, useCallback, useContext } from 'react';
import type { UpgradeReason } from '@/lib/billing/subscriptionAccess';

/** Where an admin chooses a plan: Settings › Billing, open while the workspace is read-only. */
export const CHOOSE_PLAN_HREF = '/dashboard/settings/billing';

export interface UpgradeDialogState {
  /**
   * The plan isn't active, or the brand on screen is the demo brand: an
   * action opens the dialog instead of running.
   */
  isLocked: boolean;
  /** The brand on screen is the demo brand (sample data, nothing runs); absent, it isn't. */
  isDemo?: boolean;
  reason: UpgradeReason;
  /** The admin a member is asked to turn to, when their name could be read. */
  adminName: string | null;
  /**
   * Opens the upgrade dialog; `action` is a short label for what was clicked
   * ("Adding prompts needs a plan"), shown above its title. None, no label.
   */
  openUpgrade: (action?: string) => void;
}

/** Given by UpgradeDialogProvider (the dashboard's layout); null outside it. */
export const UpgradeDialogContext = createContext<UpgradeDialogState | null>(null);

/** The read-only state, or null outside the dashboard's provider. */
export function useUpgradeDialog(): UpgradeDialogState | null {
  return useContext(UpgradeDialogContext);
}

const noop = () => {};

/**
 * Gate an action on an active plan. `guard(fn)` gives a function that runs
 * `fn` with its arguments while the plan is active, and opens the upgrade
 * dialog instead (without running it) while the workspace is read-only;
 * `action` labels the dialog with what was clicked:
 *
 *   const { guard } = useUpgradeGate();
 *   <Button onClick={guard(handleRunAll, { action: t('runAllNeedsPlan') })}>Run all</Button>
 *
 * `isLocked` and `openUpgrade` are there for a flow that decides on its own,
 * such as a form that checks before it submits.
 */
export function useUpgradeGate() {
  const state = useContext(UpgradeDialogContext);
  const isLocked = state?.isLocked ?? false;
  const openUpgrade = state?.openUpgrade ?? noop;
  const guard = useCallback(
    <Args extends unknown[], Result>(
      fn: (...args: Args) => Result,
      options: { action?: string } = {},
    ) =>
      (...args: Args): Result | undefined => {
        if (isLocked) {
          openUpgrade(options.action);
          return undefined;
        }
        return fn(...args);
      },
    [isLocked, openUpgrade],
  );
  return { isLocked, openUpgrade, guard };
}
