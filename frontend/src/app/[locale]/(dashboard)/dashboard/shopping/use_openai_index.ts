'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ShoppingDatePreset } from '@/lib/actions/shopping';
import { getOpenAiIndexRead, setOpenAiProductFeed } from '@/lib/actions/shoppingOpenaiIndex';
import type { OpenAiIndexRead } from '@/lib/shopping/openaiIndex';

interface Loaded {
  key: string;
  read: OpenAiIndexRead | null;
}

/**
 * "Catalog in OpenAI's product index" (#1281): the brand's direct-feed word
 * and its own products' US ChatGPT Shopping cards, over the Overview's window.
 * Read in the page, as the destinations are, so switching tabs doesn't read
 * it again. Supplemental: a failed read leaves the row empty.
 */
export function useOpenAiIndex(
  brandId: string | null,
  datePreset: ShoppingDatePreset,
  enabled: boolean,
): {
  read: OpenAiIndexRead | null;
  loading: boolean;
  /** Saves the brand's word; the box shows it at once and goes back if the save fails. */
  setDirectFeed: (on: boolean) => Promise<void>;
} {
  const key = enabled && brandId ? `${brandId}|${datePreset}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!key || !brandId) return;
    let cancelled = false;
    getOpenAiIndexRead(brandId, datePreset)
      .catch(() => null)
      .then((read) => {
        if (!cancelled) setLoaded({ key, read });
      });
    return () => {
      cancelled = true;
    };
  }, [key, brandId, datePreset]);

  const setDirectFeed = useCallback(
    async (on: boolean) => {
      if (!brandId || !key) return;
      const before = loaded?.key === key ? loaded.read : null;
      if (!before) return;
      setLoaded({ key, read: { ...before, directFeed: on } });
      try {
        await setOpenAiProductFeed(brandId, on);
      } catch (err) {
        setLoaded((current) => (current?.key === key ? { key, read: before } : current));
        throw err;
      }
    },
    [brandId, key, loaded],
  );

  const current = key !== null && loaded?.key === key ? loaded : null;
  return {
    read: current?.read ?? null,
    loading: key !== null && current === null,
    setDirectFeed,
  };
}
