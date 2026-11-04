'use client';

import { useEffect, useState } from 'react';
import { getBrandFacts } from '@/lib/actions/brandFacts';
import type { BrandFactsRead } from '@/lib/content/brandFacts';

export type BrandFactsState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; read: BrandFactsRead }
  | { status: 'failed' };

/**
 * The brand's facts in the editor (Quality CE-047): read once with Quality's
 * second phase (the editor opens again after Review, from Brand settings),
 * and again when its browser tab comes back (Brand settings open in
 * another). An API with them off is 'off'; a failed read keeps the one
 * before it, or is 'failed'.
 */
export function useBrandFacts(brandId: string, enabled: boolean): BrandFactsState {
  const [state, setState] = useState<BrandFactsState>({ status: 'loading' });
  const [visits, setVisits] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setVisits((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const failed = () =>
      setState((prev) => (prev.status === 'ready' ? prev : { status: 'failed' }));
    getBrandFacts(brandId)
      .then((result) => {
        if (!live) return;
        if (!('error' in result)) setState({ status: 'ready', read: result });
        else if (result.error === 'off') setState({ status: 'off' });
        else failed();
      })
      .catch((err) => {
        console.error('Failed to read the brand facts:', err);
        if (live) failed();
      });
    return () => {
      live = false;
    };
  }, [brandId, enabled, visits]);
  return enabled ? state : { status: 'off' };
}
