'use client';

import { useEffect, useState } from 'react';
import { getTrackingCountries } from '@/lib/actions/trackingCountries';
import type { TrackingCountry } from '@/lib/trackingCountries';

/** The engines' countries, read once per page (PROMPT-015e); empty when none were read. */
let countriesRead: Promise<TrackingCountry[]> | null = null;

/** Forgets the read, so the next page reads again (tests). */
export function clearTrackingCountries() {
  countriesRead = null;
}

export function useTrackingCountries(): TrackingCountry[] | null {
  const [countries, setCountries] = useState<TrackingCountry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    countriesRead ??= getTrackingCountries().catch((err) => {
      console.error('Failed to read the tracking countries:', err);
      countriesRead = null;
      return [];
    });
    countriesRead.then((list) => {
      if (!cancelled) setCountries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return countries;
}
