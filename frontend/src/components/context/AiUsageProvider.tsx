'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isCloud } from '@/config/plans';
import {
  AI_USAGE_TOAST_KEY,
  aiUsageToastDue,
  aiUsageToastMark,
  percentLabel,
  type AiUsage,
} from '@/lib/billing/aiUsage';
import { readAiUsage } from '@/lib/billing/aiUsageClient';

/** A read this old is read again when the member opens another page or comes back to the tab. */
export const AI_USAGE_STALE_MS = 60_000;

interface AiUsageState {
  /**
   * Undefined while the first read runs; null when there is nothing to meter
   * (self-hosted, a workspace without an active plan) or it couldn't be read.
   */
  usage: AiUsage | null | undefined;
  /** Reads it again now: after a run, or when the popover opens. */
  refresh: () => void;
}

const AiUsageContext = createContext<AiUsageState>({ usage: null, refresh: () => {} });

/**
 * The workspace's AI usage this period, read once for every page's header
 * meter (AI usage spec §3.1), so moving between pages doesn't blink it. It
 * is read again on a page change or a return to the tab once the last read
 * is a minute old. Only GetCito Cloud meters AI: self-hosted reads nothing.
 * Reaching 80% of the allowance toasts once a period in a browser (spec §4);
 * the banners under the header rows stay.
 */
export function AiUsageProvider({ children }: { children: ReactNode }) {
  const metered = isCloud();
  const pathname = usePathname();
  const [usage, setUsage] = useState<AiUsage | null | undefined>(metered ? undefined : null);
  const readAt = useRef(0);
  const reading = useRef(false);
  const t = useTranslations('aiUsage.banner');
  // What this tab toasted, for a browser whose storage can't be used.
  const toasted = useRef<string | null>(null);

  const read = useCallback(async () => {
    if (!metered || reading.current) return;
    reading.current = true;
    try {
      const next = await readAiUsage();
      readAt.current = Date.now();
      setUsage(next);
    } catch (err) {
      console.error('Failed to read AI usage:', err);
      // The last read stays; before any, there is nothing to show.
      setUsage((prev) => prev ?? null);
    } finally {
      reading.current = false;
    }
  }, [metered]);

  useEffect(() => {
    if (Date.now() - readAt.current >= AI_USAGE_STALE_MS) void read();
  }, [pathname, read]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - readAt.current >= AI_USAGE_STALE_MS) void read();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [read]);

  useEffect(() => {
    if (!usage) return;
    let shown = toasted.current;
    try {
      shown = localStorage.getItem(AI_USAGE_TOAST_KEY) ?? shown;
    } catch {
      // Storage blocked: this tab's memory decides.
    }
    if (!aiUsageToastDue(usage, shown)) return;
    toasted.current = aiUsageToastMark(usage);
    try {
      localStorage.setItem(AI_USAGE_TOAST_KEY, toasted.current);
    } catch {
      // As above.
    }
    toast.warning(
      t(usage.trial ? 'warningTrial' : 'warning', {
        percent: percentLabel(usage.percentUsed ?? 0),
      }),
    );
  }, [usage, t]);

  const refresh = useCallback(() => void read(), [read]);
  const value = useMemo(() => ({ usage, refresh }), [usage, refresh]);
  return <AiUsageContext.Provider value={value}>{children}</AiUsageContext.Provider>;
}

/** The workspace's AI usage; outside the dashboard there is nothing to meter. */
export function useAiUsage(): AiUsageState {
  return useContext(AiUsageContext);
}
