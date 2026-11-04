'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A read made once per `key` while it's `wanted`, and kept for that key:
 * undefined while it reads (or until it's wanted), 'failed' when it threw.
 * `key` names what `read` reads (the brand and the filters): a new key reads
 * again, and an answer for an older one is dropped. Product Visibility's
 * Shelf and Products table read this way, each apart from the page's other
 * reads, so none waits for another.
 */
export function useKeyedRead<T>(
  wanted: boolean,
  key: string,
  read: () => Promise<T>,
  /** What it reads, for the console when it fails. */
  what: string,
): T | 'failed' | undefined {
  const [kept, setKept] = useState<{ key: string; value: T | 'failed' } | null>(null);
  // The latest read: a new function each render, called for the key it was made with.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  const keptKey = kept?.key;
  useEffect(() => {
    if (!wanted || keptKey === key) return;
    let cancelled = false;
    readRef.current().then(
      (value) => {
        if (!cancelled) setKept({ key, value });
      },
      (err) => {
        console.error(`Failed to read ${what}:`, err);
        if (!cancelled) setKept({ key, value: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, key, keptKey, what]);
  return kept?.key === key ? kept.value : undefined;
}
