'use client';

import { useEffect } from 'react';
import { PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useUpgradeDialog } from '@/components/context/upgradeGate';
import { ensureDemoBrand } from '@/lib/demo/demoClient';
import { ownBrandOf } from '@/lib/demo/demoBrand';
import { offerChoice } from '@/lib/billing/planPurchase';
import { TRIAL_DAYS } from '@/lib/billing/trial';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * A thin band across the top of the dashboard while the demo brand is the
 * one on screen, where ReadOnlyBanner sits (one band at a time): that it is
 * a demo brand with sample data, and the way to the same thing for the
 * workspace's own brand, by name once it has one — the plan dialog with the
 * demo's offer, or, with a plan active, the own brand itself. Nothing on
 * another brand.
 */
export function DemoBanner() {
  const { isDemo } = useDemoBrand();
  if (!isDemo) return null;
  return <Band />;
}

// Asked once per page load: the band stays as pages change under it.
let freshnessAsked = false;

/** Lets tests ask again. */
export function resetDemoFreshness() {
  freshnessAsked = false;
}

function Band() {
  const t = useTranslations('demo.band');
  const tReadOnly = useTranslations('readOnly');
  const router = useRouter();
  const { offer } = useDemoBrand();
  const { subscriptionActive } = usePlanContext();
  const upgrade = useUpgradeDialog();
  const brandName = useBrandStore(
    (s) => s.brands.find((b) => b.id === s.activeBrandId)?.name ?? '',
  );
  const ownBrandId = useBrandStore((s) => ownBrandOf(s)?.id ?? null);
  const ownBrandName = useBrandStore((s) => ownBrandOf(s)?.name ?? null);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);

  // The demo follows the product: its sample data is written again when the
  // product moved on since (the server decides). The pages read afresh then.
  useEffect(() => {
    if (freshnessAsked) return;
    freshnessAsked = true;
    void ensureDemoBrand().then((result) => {
      if (result.ok && result.rebuilt) router.refresh();
    });
  }, [router]);

  return (
    <div
      role="status"
      data-slot="demo-band"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/50 px-4 py-2 text-sm"
    >
      <PlayCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">
        {t.rich(subscriptionActive ? 'textPlanActive' : ownBrandName ? 'textFor' : 'text', {
          brand: brandName,
          ownBrand: ownBrandName ?? '',
          days: TRIAL_DAYS,
          offer: offerChoice(offer === 'trial'),
          b: (chunks) => <strong className="font-semibold">{chunks}</strong>,
        })}
      </p>
      {subscriptionActive ? (
        ownBrandId && (
          <Button variant="outline" size="sm" onClick={() => setActiveBrand(ownBrandId)}>
            {ownBrandName ? t('switchToBrand', { brand: ownBrandName }) : t('switchToOwnBrand')}
          </Button>
        )
      ) : (
        <Button size="sm" onClick={() => upgrade?.openUpgrade()}>
          {tReadOnly('banner.seePlans')}
        </Button>
      )}
    </div>
  );
}
