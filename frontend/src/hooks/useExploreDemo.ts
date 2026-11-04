'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { DemoSetupState } from '@/components/demo/DemoSetupDialog';
import { useRouter } from '@/i18n/navigation';
import { getBrandById } from '@/lib/actions/brand';
import { demoPreparation, prepareDemoBrand, setDemoHidden } from '@/lib/demo/demoClient';
import { finishDelay } from '@/lib/demo/setupSteps';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';

/** Where the demo opens: the page the product starts on. */
export const DEMO_START_HREF = '/dashboard/action-center';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * "Explore the demo" (onboarding's plan step) and "See the demo" (the
 * read-only band): the organization's demo brand, made or brought up to
 * date (POST /api/demo), shown again if it was hidden, selected, and opened
 * on the Action Center. When the API can't be asked (a member's call
 * refused), a demo brand already in the list still opens. The setup started
 * ahead (usePreloadDemo) is the one waited for.
 *
 * Ready already, it opens at once. Still being prepared, the setup screen
 * (DemoSetupDialog, rendered by the caller with `setupDialog`) shows it from
 * where it stands, then the demo opens; closing the screen leaves it to
 * finish in the background, so the next click opens it at once.
 */
export function useExploreDemo() {
  const t = useTranslations('demo.explore');
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [setup, setSetup] = useState<DemoSetupState | null>(null);
  // The click under way; a later click or a closed setup screen ends it.
  const attempt = useRef(0);

  const explore = useCallback(async () => {
    const id = ++attempt.current;
    const current = () => attempt.current === id;
    setOpening(true);
    const request = prepareDemoBrand();
    const asked = demoPreparation();
    // Still being prepared: the setup screen shows it, from where it stands.
    const pending = asked !== null && !asked.answered ? asked : null;
    setSetup(pending && { startedAt: pending.startedAt, answeredAt: null, failed: false });
    const fail = () => {
      if (!current()) return;
      setOpening(false);
      if (pending) setSetup((s) => s && { ...s, failed: true });
      else toast.error(t('failed'));
    };

    const ensured = await request;
    if (!current()) return;
    const { brands } = useBrandStore.getState();
    const brandId = ensured.ok ? ensured.brandId : (brands.find((b) => b.isDemo)?.id ?? null);
    if (!brandId) return fail();
    const lookup = async (): Promise<Brand | null> =>
      brands.find((b) => b.id === brandId) ?? (await getBrandById(brandId).catch(() => null));
    let found: Brand | null;
    if (pending) {
      // The steps left run through while the brand is read.
      const answeredAt = Date.now();
      setSetup((s) => s && { ...s, answeredAt });
      [found] = await Promise.all([lookup(), sleep(finishDelay(answeredAt - pending.startedAt))]);
      if (!current()) return;
    } else {
      found = await lookup();
    }
    const brand = found;
    if (!brand) return fail();
    if (brand.demoHiddenAt) {
      const shown = await setDemoHidden(false);
      if (!shown.ok) return fail();
    }
    if (!current()) return;
    const { brands: listed, addBrand, setActiveBrand } = useBrandStore.getState();
    if (!listed.some((b) => b.id === brand.id)) addBrand({ ...brand, demoHiddenAt: null });
    setActiveBrand(brand.id);
    router.push(DEMO_START_HREF);
    // The layout reads the organization's brands again, the demo brand among them.
    router.refresh();
    setSetup(null);
  }, [router, t]);

  /** The setup screen closed: the demo keeps being prepared, but doesn't open. */
  const close = useCallback(() => {
    attempt.current += 1;
    setSetup(null);
    setOpening(false);
  }, []);

  return { explore, opening, setupDialog: { setup, onRetry: explore, onClose: close } };
}

/**
 * Starts the demo brand's setup in the background, once, while `enabled`: a
 * screen that offers the demo to someone who has none yet, so the click
 * that opens it waits less. Nothing is said when it fails; the click asks
 * again.
 */
export function usePreloadDemo(enabled: boolean) {
  useEffect(() => {
    if (enabled) void prepareDemoBrand();
  }, [enabled]);
}
