'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { useUpgradeDialog } from '@/components/context/upgradeGate';
import type { ApiFailure } from '@/lib/apiFailure';

/**
 * A failed call as a toast (BUG-001): the reason in plain words and the one
 * thing to do about it — sign in again, switch brand, reload, or upgrade.
 * A workspace whose plan isn't active gets the upgrade dialog instead, as its
 * guarded buttons do: for the server's subscription_inactive, and for any
 * other plan refusal while the dashboard already knows it is read-only.
 * Other plan limits (a feature the plan lacks, a used-up allowance) keep the
 * toast.
 */
export function useFailureToast() {
  const t = useTranslations('apiFailure');
  const router = useRouter();
  const upgrade = useUpgradeDialog();
  return useCallback(
    (failure: ApiFailure, options: { id?: string | number; description?: string } = {}) => {
      if (upgrade && (failure === 'subscription' || (failure === 'plan' && upgrade.isLocked))) {
        if (options.id !== undefined) toast.dismiss(options.id);
        upgrade.openUpgrade();
        return;
      }
      const action = (() => {
        switch (failure) {
          case 'session':
            return { label: t('signIn'), onClick: () => router.push('/sign-in') };
          case 'workspace':
            return { label: t('yourBrands'), onClick: () => router.push('/dashboard/brands') };
          case 'not_found':
            return { label: t('reload'), onClick: () => window.location.reload() };
          case 'subscription':
            return {
              label: t('choosePlan'),
              onClick: () => router.push('/dashboard/settings/billing'),
            };
          case 'plan':
          case 'limit':
            return {
              label: t('upgrade'),
              onClick: () => router.push('/dashboard/settings/billing'),
            };
          case 'busy':
          case 'failed':
            return undefined;
        }
      })();
      toast.error(t(failure), { ...options, ...(action ? { action } : {}) });
    },
    [t, router, upgrade],
  );
}
