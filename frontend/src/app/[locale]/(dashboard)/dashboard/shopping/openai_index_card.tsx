'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  openAiIndexStatus,
  type OpenAiIndexRead,
  type OpenAiIndexStatus,
} from '@/lib/shopping/openaiIndex';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';

const STATUS_TONE: Record<OpenAiIndexStatus, string> = {
  direct_feed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  found: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  not_found: 'bg-muted text-muted-foreground',
};

/**
 * ChatGPT in the US (#1281): whether the brand's catalog is in OpenAI's
 * product index, and whether it's a verified seller, as far as anyone can
 * know without a public API. Shown on the Overview while the market is the US.
 */
export function OpenAiIndexCard({
  read,
  loading,
  canManage,
  onDirectFeedChange,
}: {
  read: OpenAiIndexRead | null;
  loading: boolean;
  /** Admins and managers change the brand's direct-feed word. */
  canManage: boolean;
  onDirectFeedChange: (on: boolean) => Promise<void>;
}) {
  const t = useTranslations('shopping.openaiIndex');
  const feedId = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = read ? openAiIndexStatus(read) : null;
  // A read-only workspace (plan not active): the box opens the upgrade dialog
  // instead, and stays as it was.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const changeFeed = guard(
    (on: boolean) => {
      setSaving(true);
      setFailed(false);
      onDirectFeedChange(on)
        .catch(() => setFailed(true))
        .finally(() => setSaving(false));
    },
    { action: tActions('setProductFeed') },
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[148px] w-full" />
        ) : !read || !status ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('unavailable')}</p>
        ) : (
          <dl className="divide-y text-sm">
            <div className="space-y-2 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="font-medium text-foreground">{t('catalogLabel')}</dt>
                <dd
                  className={cn('rounded-md px-2 py-0.5 text-xs font-medium', STATUS_TONE[status])}
                >
                  {t(`status.${status}`)}
                </dd>
              </div>
              <dd className="text-xs text-muted-foreground">
                {t(`detail.${status}`, { count: read.ownCards })}
              </dd>
              {status !== 'direct_feed' && (
                <dd className="text-xs text-foreground">{t('catalogAdvice')}</dd>
              )}
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                <Checkbox
                  id={feedId}
                  checked={read.directFeed}
                  disabled={!canManage || saving}
                  onCheckedChange={(checked) => changeFeed(checked === true)}
                />
                <label htmlFor={feedId} className="text-xs text-foreground">
                  {t('directFeedLabel')}
                </label>
                {!canManage && (
                  <span className="text-xs text-muted-foreground">{t('directFeedManagers')}</span>
                )}
                {failed && (
                  <span role="alert" className="text-xs text-destructive">
                    {t('saveFailed')}
                  </span>
                )}
              </dd>
            </div>
            <div className="space-y-2 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="font-medium text-foreground">{t('verifiedLabel')}</dt>
                <dd
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-medium',
                    STATUS_TONE.not_found,
                  )}
                >
                  {t('verifiedStatus')}
                </dd>
              </div>
              <dd className="text-xs text-muted-foreground">{t('verifiedDetail')}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
