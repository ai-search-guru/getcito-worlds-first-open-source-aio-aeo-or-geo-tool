'use client';

import { useEffect, useState } from 'react';
import {
  getResellerPriceAlerts,
  getShoppingMerchantSplit,
  type ShoppingFilters,
} from '@/lib/actions/shopping';
import type { ShoppingMerchantSplit } from '@/lib/shoppingMerchantSplit';
import type { ResellerPriceAlert } from '@/lib/shoppingResellerPriceAlert';

interface Loaded {
  key: string;
  split: ShoppingMerchantSplit | null;
  priceAlerts: ResellerPriceAlert[];
}

/**
 * The Overview tab's destination reads (#1277): where AI sends shoppers, and
 * the resellers cheaper than the brand's store, for the same window and
 * filters as the KPIs. Read here, in the page, rather than in the cards, so
 * switching tabs doesn't read them again. Both are supplemental: a failed
 * read leaves its card empty instead of breaking Shopping.
 */
export function useMerchantDestinations(
  brandId: string | null,
  filters: ShoppingFilters,
  enabled: boolean,
): { split: ShoppingMerchantSplit | null; priceAlerts: ResellerPriceAlert[]; loading: boolean } {
  const key = enabled && brandId ? `${brandId}|${JSON.stringify(filters)}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!key || !brandId) return;
    let cancelled = false;
    Promise.all([
      getShoppingMerchantSplit(brandId, filters).catch(() => null),
      getResellerPriceAlerts(brandId, filters).catch(() => [] as ResellerPriceAlert[]),
    ]).then(([split, priceAlerts]) => {
      if (!cancelled) setLoaded({ key, split, priceAlerts });
    });
    return () => {
      cancelled = true;
    };
  }, [key, brandId, filters]);

  const current = key !== null && loaded?.key === key ? loaded : null;
  return {
    split: current?.split ?? null,
    priceAlerts: current?.priceAlerts ?? [],
    loading: key !== null && current === null,
  };
}
