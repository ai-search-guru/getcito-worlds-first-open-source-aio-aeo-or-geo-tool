'use client';

import { useEffect } from 'react';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';

interface BrandLoaderProps {
  brands: Brand[];
}

/**
 * Hydrates the brand store with server-fetched brands on mount.
 * Placed in the dashboard layout so brands are always available.
 */
export function BrandLoader({ brands }: BrandLoaderProps) {
  const setBrands = useBrandStore((s) => s.setBrands);

  useEffect(() => {
    setBrands(brands);
  }, [brands, setBrands]);

  // The dashboard left (signed out, say): the list is the last visit's again
  // until the next one loads it, perhaps for another account.
  useEffect(
    () => () => {
      useBrandStore.setState({ loaded: false });
    },
    [],
  );

  return null;
}
