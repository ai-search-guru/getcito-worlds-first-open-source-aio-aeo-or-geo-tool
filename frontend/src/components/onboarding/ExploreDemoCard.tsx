'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DemoSetupDialog } from '@/components/demo/DemoSetupDialog';
import { Button } from '@/components/ui/button';
import { useExploreDemo, usePreloadDemo } from '@/hooks/useExploreDemo';

/**
 * Under onboarding's plan cards, the other way in: the demo brand, with
 * sample data and no card. The person's own brand stays as set up, and its
 * tracking starts once a plan is picked. One slim row, so the plan step fits
 * a laptop screen. With `preload` (an admin with no demo brand yet), its
 * setup starts as the card shows; one still being prepared on the click
 * shows the setup screen until it is ready.
 */
export function ExploreDemoCard({
  brandName,
  preload = false,
}: {
  brandName: string | null;
  preload?: boolean;
}) {
  const t = useTranslations('demo.onboarding');
  const tDemo = useTranslations('demo');
  const { explore, opening, setupDialog } = useExploreDemo();
  usePreloadDemo(preload);
  return (
    <div className="mt-4" data-slot="explore-demo">
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t('title')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('body', { brand: brandName || t('yourBrand') })}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => void explore()}
          disabled={opening}
        >
          {opening ? <Loader2 className="animate-spin" aria-hidden /> : <PlayCircle aria-hidden />}
          {opening ? tDemo('settingUp') : t('cta')}
        </Button>
      </div>
      <DemoSetupDialog {...setupDialog} />
    </div>
  );
}
