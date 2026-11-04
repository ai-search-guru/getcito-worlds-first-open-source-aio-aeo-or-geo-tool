'use client';

import { createContext, useContext } from 'react';
import type { AddOnKind } from '@/lib/billing/addOns';

/**
 * Opening the Get more window (CHAT-18 §B item 6) from any limit, without
 * loading the window itself: GetMoreProvider (GetMore.tsx) holds it.
 */

export type GetMoreTab = AddOnKind;

export const GetMoreContext = createContext<((tab?: GetMoreTab) => void) | null>(null);

/** Opens the Get more window on a tab (AI credits by default); null where there is none. */
export function useGetMore(): ((tab?: GetMoreTab) => void) | null {
  return useContext(GetMoreContext);
}
