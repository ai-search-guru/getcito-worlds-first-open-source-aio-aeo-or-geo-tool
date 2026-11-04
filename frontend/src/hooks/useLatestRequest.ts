'use client';

import { useCallback, useRef } from 'react';

/**
 * Requests that run side by side can answer out of order: a range picked,
 * then another before the first answered. Each call starts a request and
 * returns whether it is still the latest, so only the latest one sets state.
 */
export function useLatestRequest(): () => () => boolean {
  const latest = useRef(0);
  return useCallback(() => {
    const request = ++latest.current;
    return () => request === latest.current;
  }, []);
}
