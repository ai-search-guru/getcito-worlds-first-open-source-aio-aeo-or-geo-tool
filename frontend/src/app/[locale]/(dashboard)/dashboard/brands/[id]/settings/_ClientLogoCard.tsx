'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { LogoField } from '@/components/settings/LogoField';
import { PLANS } from '@/config/plans';
import {
  getBrandClientLogo,
  prepareBrandClientLogoUpload,
  setBrandClientLogo,
  type ClientLogoView,
  type WhiteLabelFailure,
} from '@/lib/actions/whiteLabel';
import { whiteLabelOffered } from '@/lib/white-label/kit';
import { uploadLogo, type LogoUploadError } from '@/lib/white-label/logoUpload';
import type { Brand } from '@/types';

const FAILED = { ok: false, failure: 'failed' } as const;

/**
 * Brand settings › General › Client logo (00429): the client's logo for this
 * brand's report cover, beside "Prepared for {brand}". Admins and Managers
 * change it, on a plan with white label; elsewhere the plan that has it is
 * named. Not shown where white label isn't offered (a self-host without it).
 */
export function ClientLogoCard({ brand }: { brand: Brand }) {
  const { isCloud } = usePlanContext();
  if (!whiteLabelOffered({ isCloud })) return null;
  return <ClientLogo brand={brand} />;
}

function ClientLogo({ brand }: { brand: Brand }) {
  const t = useTranslations('brands.settings.clientLogo');
  const tKit = useTranslations('settings.whiteLabel');
  const tActions = useTranslations('readOnly.actions');
  const { openUpgrade } = useUpgradeGate();
  const [view, setView] = useState<ClientLogoView | null>(null);
  const [failed, setFailed] = useState(false);

  const show = useCallback((read: Awaited<ReturnType<typeof getBrandClientLogo>>) => {
    if (!read.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView(read.view);
  }, []);
  const load = useCallback(
    () =>
      getBrandClientLogo(brand.id)
        .catch(() => FAILED)
        .then(show),
    [brand.id, show],
  );

  useEffect(() => {
    let live = true;
    void getBrandClientLogo(brand.id)
      .catch(() => FAILED)
      .then((read) => {
        if (live) show(read);
      });
    return () => {
      live = false;
    };
  }, [brand.id, show]);

  const fail = (failure: WhiteLabelFailure | LogoUploadError) => {
    if (failure === 'read_only') openUpgrade(tActions('changeClientLogo'));
    else toast.error(tKit(`errors.${failure}`));
  };

  async function pick(file: File) {
    const uploaded = await uploadLogo(file, (type, size) =>
      prepareBrandClientLogoUpload(brand.id, type, size),
    );
    if (!uploaded.ok) return fail(uploaded.error);
    const set = await setBrandClientLogo(brand.id, uploaded.path).catch(() => FAILED);
    if (!set.ok) return fail(set.failure);
    toast.success(t('saved'));
    await load();
  }

  async function remove() {
    const set = await setBrandClientLogo(brand.id, null).catch(() => FAILED);
    if (!set.ok) return fail(set.failure);
    toast.success(t('removed'));
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { brand: brand.name })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {failed && !view ? (
          <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
        ) : !view ? (
          <Skeleton className="h-16 w-40" />
        ) : !view.available ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('locked', { plan: PLANS[view.requiredPlan].name })}
          </p>
        ) : (
          <>
            <LogoField
              label={t('title')}
              url={view.logoUrl}
              canEdit={view.canEdit}
              action={tActions('changeClientLogo')}
              onPick={pick}
              onRemove={remove}
            />
            {!view.canEdit && <p className="text-xs text-muted-foreground">{t('managersOnly')}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
