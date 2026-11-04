'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AIProviderAvatar } from '@/components/AiProviderAvatar';
import { getBrandMarketCountries } from '@/lib/actions/shoppingMarket';
import {
  defaultMarket,
  isShoppingMarket,
  marketForCountry,
  SHOPPING_MARKETS,
  type ShoppingMarket,
} from '@/lib/shopping/markets';
import { cn } from '@/lib/utils';

const storageKey = (brandId: string) => `aeo:shopping-market:${brandId}`;

function readStoredMarket(brandId: string): ShoppingMarket | null {
  try {
    const stored = window.localStorage.getItem(storageKey(brandId));
    return isShoppingMarket(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeMarket(brandId: string, market: ShoppingMarket) {
  try {
    window.localStorage.setItem(storageKey(brandId), market);
  } catch {
    // Private mode: the choice holds until the page is opened again.
  }
}

const SOURCE_KEYS = {
  us: 'sourceUs',
  europe: 'sourceEurope',
} as const satisfies Record<ShoppingMarket, string>;

export interface ShoppingMarketState {
  /** False until the brand's countries are read: the page waits, so it loads once. */
  ready: boolean;
  /** The brand's market: the remembered choice, else its default. Null when it has none. */
  market: ShoppingMarket | null;
  /**
   * What the switch and the source line show: the market, or while the region
   * filter has one picked, that region's market (null outside both).
   */
  shown: ShoppingMarket | null;
  /**
   * The market ChatGPT Shopping cards are kept to. Unset while a region is
   * picked: the region already narrows every platform's cards.
   */
  filter: ShoppingMarket | undefined;
  select: (market: ShoppingMarket) => void;
}

/**
 * The Shopping page's market (#1278), from the brand's countries (its
 * domains' and its prompts' locations) and the choice remembered for the
 * brand in this browser.
 *
 * It composes with the filter bar's region rather than stacking on it: with
 * All regions the market keeps ChatGPT Shopping's cards to its regions; a
 * picked region narrows every platform on its own, and the switch shows that
 * region's market. Choosing a market clears the region (the page does that),
 * so the two never contradict each other.
 */
export function useShoppingMarket(brandId: string | null, region: string): ShoppingMarketState {
  // Keyed by brand, so another brand never shows this one's market.
  const [resolved, setResolved] = useState<{
    brandId: string;
    market: ShoppingMarket | null;
  } | null>(null);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getBrandMarketCountries(brandId)
      // A failed read makes no claim: no market, no switch.
      .then(defaultMarket, () => null)
      .then((fallback) => {
        if (cancelled) return;
        setResolved({ brandId, market: fallback && (readStoredMarket(brandId) ?? fallback) });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const select = useCallback(
    (next: ShoppingMarket) => {
      if (!brandId) return;
      storeMarket(brandId, next);
      setResolved({ brandId, market: next });
    },
    [brandId],
  );

  const ready = brandId !== null && resolved?.brandId === brandId;
  const market = ready ? (resolved?.market ?? null) : null;
  const regionPicked = region !== 'all';

  return {
    ready,
    market,
    shown: market && (regionPicked ? marketForCountry(region) : market),
    filter: market && !regionPicked ? market : undefined,
    select,
  };
}

/**
 * The US / Europe switch, with where ChatGPT's products come from in the
 * market shown. Nothing renders for a brand with no market: its countries
 * get no source claim. The Readiness checklist and the Content Editor's
 * Shopping tab are to share this switch and its state once they exist.
 */
export function ShoppingMarketSwitch({
  state,
  onSelect,
}: {
  state: ShoppingMarketState;
  onSelect: (market: ShoppingMarket) => void;
}) {
  const t = useTranslations('shopping.market');
  const labelId = useId();

  if (!state.market) return null;
  const { shown } = state;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <span aria-hidden="true">
          <AIProviderAvatar provider="openai" />
        </span>
        <span id={labelId} className="text-xs font-medium text-muted-foreground">
          {t('label')}
        </span>
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex overflow-hidden rounded-md border"
      >
        {SHOPPING_MARKETS.map((market) => (
          <button
            key={market}
            type="button"
            aria-pressed={shown === market}
            onClick={() => onSelect(market)}
            className={cn(
              'px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              shown === market
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-foreground hover:bg-muted',
            )}
          >
            {t(market)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {shown && (
          <>
            {t('sourceLabel')}{' '}
            <span className="font-medium text-foreground">{t(SOURCE_KEYS[shown])}</span>
          </>
        )}
      </p>
    </div>
  );
}
