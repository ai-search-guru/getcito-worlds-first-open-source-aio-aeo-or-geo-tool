'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import { markGettingStartedPageOpened } from '@/lib/actions/gettingStarted';
import { pageOpenedStep } from '@/lib/getting-started/steps';
import { useUpgradeGate } from '@/components/context/upgradeGate';

/**
 * Getting started's explore steps ("See where you stand in Brand Visibility" and
 * the like) are done when their page is opened. Mounted once in the
 * dashboard layout, so it counts the page however it was reached: the step's
 * button, the sidebar or a link. Each brand and step is sent until the
 * server records it, then remembered in this browser. Not sent while the
 * workspace is read-only (plan not active): it writes. Nor for the demo
 * brand, whose sample data keeps no steps.
 */
export function GettingStartedPageOpened() {
  const pathname = usePathname();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const isDemo = useBrandStore(
    (s) => s.brands.find((b) => b.id === s.activeBrandId)?.isDemo ?? false,
  );
  const { isLocked } = useUpgradeGate();

  useEffect(() => {
    const step = pageOpenedStep(pathname);
    if (!step || !brandId || isLocked || isDemo) return;
    const key = `aeo:getting-started:${brandId}:${step}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // Storage blocked: ask the server, which keeps it once.
    }
    markGettingStartedPageOpened(brandId, step)
      .then((result) => {
        if (!result.ok || !result.recorded) return;
        try {
          localStorage.setItem(key, '1');
        } catch {
          // Nothing to remember it in; the next visit asks again.
        }
      })
      .catch(() => {
        // A database without 00196, or offline: the step stays open.
      });
  }, [pathname, brandId, isLocked, isDemo]);

  return null;
}
