'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useBrandStore } from '@/state/useBrandStore';
import { demoOffer, isDemoSelected, type DemoOffer } from '@/lib/demo/demoBrand';

/** The organization's demo brand, shown in the brand list or hidden from it. */
export interface DemoBrandInfo {
  id: string;
  hidden: boolean;
}

export interface DemoBrandState {
  /**
   * The selected brand is the demo brand (GetCito Cloud only): the
   * dashboard is locked as a read-only one is, and the plan dialog makes the
   * demo's offer.
   */
  isDemo: boolean;
  /** The organization's demo brand, hidden or not; null when it has none. */
  demoBrand: DemoBrandInfo | null;
  /** What the plan dialog offers from the demo. */
  offer: DemoOffer;
  /**
   * The organization never had a subscription: its own brands are set up
   * but not tracked yet.
   */
  neverSubscribed: boolean;
}

const NO_DEMO: DemoBrandState = {
  isDemo: false,
  demoBrand: null,
  offer: 'first_month',
  neverSubscribed: false,
};

/** Given by DemoBrandProvider (the dashboard's layout); no demo outside it. */
export const DemoBrandContext = createContext<DemoBrandState>(NO_DEMO);

/**
 * The demo brand's state for the dashboard (its layout gives the org's demo
 * brand and whether the org ever subscribed). Whether the demo is the brand
 * on screen follows the brand switcher, so it changes without a reload.
 */
export function DemoBrandProvider({
  demoBrand = null,
  everSubscribed = true,
  children,
}: {
  demoBrand?: DemoBrandInfo | null;
  everSubscribed?: boolean;
  children: ReactNode;
}) {
  const { isCloud } = usePlanContext();
  const demoSelected = useBrandStore(isDemoSelected);
  const isDemo = isCloud && demoSelected;
  const value = useMemo<DemoBrandState>(
    () => ({
      isDemo,
      demoBrand,
      offer: demoOffer(everSubscribed),
      neverSubscribed: isCloud && !everSubscribed,
    }),
    [isDemo, demoBrand, everSubscribed, isCloud],
  );
  return <DemoBrandContext.Provider value={value}>{children}</DemoBrandContext.Provider>;
}

/** The demo brand's state; no demo outside the dashboard's provider. */
export function useDemoBrand(): DemoBrandState {
  return useContext(DemoBrandContext);
}
