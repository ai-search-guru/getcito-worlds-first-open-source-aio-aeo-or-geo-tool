'use client';

import { useCallback, useEffect, useState } from 'react';
import { getShoppingCheck } from '@/lib/actions/shoppingPath';
import type { SiteType } from '@/lib/content/pageTypes';
import type { ShoppingCheck } from '@/lib/content/shoppingCheck';
import { shoppingPathFits } from '@/lib/content/shoppingPath';

export interface ShoppingCheckRead {
  /**
   * The draft's shopping path against the catalog: 'reading' until it's
   * first read, 'failed' when it couldn't be, null without a path or on a
   * page that takes none.
   */
  check: ShoppingCheck | 'reading' | 'failed' | null;
  /** Read again (`reload`) and not back yet: `check` is the last read until then. */
  refreshing: boolean;
  /** Reads it again: Before you publish asks for it fresh, Brief › Shopping path after a change. */
  reload: () => void;
}

/**
 * The draft's shopping path read against the catalog now (shopping path,
 * part 6), for the Shopping rules and Before you publish. A read again
 * keeps the last one meanwhile, so the rules don't come and go with it.
 */
export function useShoppingCheck({
  draftId,
  siteType,
  pageType,
}: {
  draftId: string;
  siteType: SiteType;
  pageType: string | null;
}): ShoppingCheckRead {
  const fits = shoppingPathFits(siteType, pageType);
  // The draft read, and each read of it: a new draft starts from 'reading'.
  const draftKey = `${draftId}|${fits}`;
  const [reads, setReads] = useState(0);
  const key = `${draftKey}|${reads}`;
  const [state, setState] = useState<{
    draftKey: string;
    key: string;
    check: ShoppingCheck | 'failed' | null;
  } | null>(null);

  useEffect(() => {
    if (!fits) return;
    let cancelled = false;
    getShoppingCheck(draftId).then(
      (check) => {
        if (!cancelled) setState({ draftKey, key, check });
      },
      (err) => {
        console.error('Failed to read the shopping links:', err);
        if (!cancelled) setState({ draftKey, key, check: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draftId, fits, draftKey, key]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  if (!fits) return { check: null, refreshing: false, reload };
  const last = state?.draftKey === draftKey ? state : null;
  if (!last) return { check: 'reading', refreshing: false, reload };
  return { check: last.check, refreshing: last.key !== key, reload };
}
