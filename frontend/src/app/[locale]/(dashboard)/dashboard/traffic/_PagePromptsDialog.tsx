'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { pageUrl } from '@/lib/trafficPages';
import { getLocationQuota } from '@/lib/actions/prompt';
import { trackPagePrompts } from '@/lib/actions/promptSuggestions';
import {
  suggestPagePrompts,
  type PagePromptSuggestions,
  type TrafficDateWindow,
} from '@/lib/actions/traffic';
import { AddTopicLink, TopicFirstNotice } from '@/components/prompts/TopicFirst';
import { isNoTopics } from '@/lib/topicsRequired';

/**
 * Prompts slots left on the plan, from its tracked-location cap: null when
 * the plan has no cap, or it couldn't be read (the server still checks).
 */
function slotsLeftOf(quota: { maxPrompts: number; used: number } | null): number | null {
  if (!quota || quota.maxPrompts === -1) return null;
  return Math.max(0, quota.maxPrompts - quota.used);
}

/**
 * "Add prompts" for one page of the Pages section (AT-006 part B2): prompts
 * whose best answer is the page, to pick from and track within the plan's
 * prompt slots (PROMPT-012). As many as the slots allow start ticked; the
 * ones tracked point at the page, so their answers show whether AI cites it.
 */
export function PagePromptsDialog({
  brandId,
  dateWindow,
  domain,
  page,
  onClose,
  onTracked,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The brand's primary domain, for the prompts' target URL. */
  domain: string | undefined;
  /** The page to suggest prompts for; null keeps the dialog closed. */
  page: string | null;
  onClose: () => void;
  /** Prompts were added: the list's prompt counts changed. */
  onTracked: () => void;
}) {
  const t = useTranslations('traffic.pageList.prompts');
  const router = useRouter();
  // The loaded suggestions carry the page they are for, so another page's
  // never show while this one's load.
  const [loaded, setLoaded] = useState<{
    page: string;
    result: PagePromptSuggestions | { error: string; code?: string };
    slotsLeft: number | null;
    unlimited: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tracking, setTracking] = useState(false);
  // The page whose Track found the brand had no topic left.
  const [noTopicsPage, setNoTopicsPage] = useState<string | null>(null);

  useEffect(() => {
    if (!page) return;
    // Each open asks again: a topic may have been added since a Track found none.
    setNoTopicsPage(null);
    let cancelled = false;
    Promise.all([
      suggestPagePrompts(brandId, dateWindow, page).catch(() => ({ error: '' })),
      getLocationQuota(brandId).catch(() => null),
    ]).then(([result, quota]) => {
      if (cancelled) return;
      const slotsLeft = slotsLeftOf(quota);
      setLoaded({ page, result, slotsLeft, unlimited: quota?.maxPrompts === -1 });
      const count = 'suggestions' in result ? result.suggestions.length : 0;
      setSelected(
        new Set(Array.from({ length: Math.min(count, slotsLeft ?? count) }, (_, i) => i)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, page]);

  const current = page && loaded?.page === page ? loaded : null;
  // A brand with no topic yet: suggesting or tracking asks for one first.
  const askTopic = (!!page && noTopicsPage === page) || (!!current && isNoTopics(current.result));
  const suggestions = current && 'suggestions' in current.result ? current.result.suggestions : [];
  const slotsLeft = current?.slotsLeft ?? null;
  const over = slotsLeft !== null && selected.size > slotsLeft;

  const toggle = (index: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  const track = async () => {
    if (!page || selected.size === 0) return;
    const picked = suggestions.filter((_, i) => selected.has(i));
    setTracking(true);
    try {
      const result = await trackPagePrompts(
        brandId,
        domain ? pageUrl(domain, page) : null,
        picked.map((s) => ({ text: s.text, topic: s.topic })),
      );
      const open = { label: t('openPrompts'), onClick: () => router.push('/dashboard/prompts') };
      const done = result.promptIds.length;
      if (done > 0) onTracked();
      if (done === picked.length) {
        toast.success(t('tracked', { count: done }), {
          description: t('trackedDescription', { page }),
          duration: 10_000,
          action: open,
        });
        onClose();
      } else if (done > 0) {
        toast.warning(t('trackedPartly', { tracked: done, total: picked.length }), {
          action: open,
        });
        onClose();
      } else if (result.code === 'plan_limit') {
        toast.error(t('planFull'));
      } else if (isNoTopics(result)) {
        setNoTopicsPage(page);
      } else {
        toast.error(t('trackFailed'), { description: result.error });
      }
    } catch {
      toast.error(t('trackFailed'));
    } finally {
      setTracking(false);
    }
  };

  return (
    <Dialog open={page !== null} onOpenChange={(open) => !open && !tracking && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('explain', { page: page ?? '' })}
            {current && 'page' in current.result && current.result.page.title && (
              <span className="mt-1 block text-xs">
                {t('pageTitle', { title: current.result.page.title })}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {askTopic ? (
          <TopicFirstNotice />
        ) : !current ? (
          <div className="space-y-3" aria-busy>
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : 'error' in current.result ? (
          <div className="space-y-1 text-sm">
            <p>{t('failed')}</p>
            {current.result.error && (
              <p className="text-xs text-muted-foreground">{current.result.error}</p>
            )}
          </div>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {suggestions.map((s, i) => (
              <li key={s.text}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 hover:bg-muted/40">
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(i)}
                    onCheckedChange={(on) => toggle(i, on === true)}
                    aria-label={s.text}
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="block font-medium">{s.text}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {s.topic}
                      </Badge>
                      {s.reason}
                    </span>
                    {s.sourceQuery && (
                      <span className="block text-xs text-muted-foreground">
                        {t('fromQuery', {
                          query: s.sourceQuery,
                          impressions: formatNumber(s.impressions ?? 0),
                        })}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <p
            className={cn(
              'text-xs',
              over ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
            )}
          >
            {current && suggestions.length > 0
              ? over
                ? t('overSlots', { count: slotsLeft ?? 0 })
                : current.unlimited
                  ? t('unlimited')
                  : slotsLeft !== null
                    ? t('slotsLeft', { count: slotsLeft })
                    : null
              : null}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {askTopic ? (
              <AddTopicLink />
            ) : (
              <>
                <Link href="/dashboard/prompts" className={buttonVariants({ variant: 'outline' })}>
                  {t('addOwn')}
                </Link>
                <Button
                  disabled={!current || selected.size === 0 || over || tracking}
                  onClick={() => void track()}
                >
                  {tracking && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('track', { count: selected.size })}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
