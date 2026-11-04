'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useFailureToast } from '@/hooks/useFailureToast';
import { ArrowRight, Loader2, MessageCircle, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { numberFormat } from '@/lib/numberFormat';
import { trackSuggestions } from '@/lib/actions/promptSuggestions';
import { sendTopicOpportunityToActionCenter } from '@/lib/actions/topic';
import { generateOpportunitiesOnDemand, getGenerationJobStatus } from '@/lib/actions/content';
import { waitForContentJob } from '@/lib/contentJob';
import { openPendingTab } from '@/lib/pendingTab';
import type { ContentUsage } from '@/lib/contentUsage';
import {
  contentLeft,
  opportunities,
  secondaryBlock,
  topicStandings,
  type Opportunity,
  type OpportunitySuggestion,
} from '@/lib/insightsOpportunities';
import type { TopicCompetitors } from '@/lib/insightsTopics';
import { guessedVolumeEstimate } from '@/lib/volumeEstimate';
import { EstimateRange } from '@/components/prompts/VolumeEstimate';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';
import { useTopicFirstDialog } from '@/components/prompts/TopicFirst';
import { NO_TOPICS } from '@/lib/topicsRequired';

/** Items shown, as in the mockup; "See all" opens the rest. */
const VISIBLE_ITEMS = 4;

const SUGGESTIONS_HREF = '/dashboard/prompts/suggestions';
/** Where Track takes the user: the table, with what they added on top as New. */
const TRACKED_HREF = '/dashboard/prompts/tracked';

/**
 * Opportunities (VIS-011), as in the v2 mockup: what to track next, from the
 * stored prompt suggestions. A topic item tracks all its suggested prompts
 * (Track 23), a prompt item the one. Both stay within the plan's prompt
 * locations: the server checks every prompt and stops when they're full.
 * Beside Track, a topic item sends a Growth action to the Action Center, and
 * a prompt item has content written for its topic (the Content quota).
 */
export function Opportunities({
  brandId,
  suggestions,
  trackedTopicIds,
  topics,
  entities,
  slotsLeft,
  contentUsage,
  onTracked,
  className,
}: {
  brandId: string;
  suggestions: OpportunitySuggestion[];
  trackedTopicIds: string[] | null;
  /** The heat map's data, for who leads each topic; null where it isn't loaded. */
  topics: TopicCompetitors[] | null;
  /** The trend's brands, for the names of the competitors leading topics. */
  entities: { key: string; name: string; isOwnBrand: boolean }[] | null;
  /** Prompt locations left on the plan; null when unlimited. */
  slotsLeft: number | null;
  /** The month's content quota (CONTENT-001); null when it couldn't be read. */
  contentUsage: ContentUsage | null;
  onTracked: (count: number) => void;
  className?: string;
}) {
  const t = useTranslations('insights.opportunities');
  // A read-only workspace (plan not active): Track, Send action and Suggest
  // content open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Tracking adds prompts and suggesting content costs AI: admins and
  // managers do both; anyone else reads the list and sends a topic's action.
  const { canManage } = useUserRole();
  const tManagers = useTranslations('managersOnly');
  const failureToast = useFailureToast();
  const format = useFormatter();
  const f = numberFormat(useLocale());
  const router = useRouter();
  const [trackedIds, setTrackedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // Send action and Suggest content run on their own: writing content takes a while.
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const [contentSpent, setContentSpent] = useState(0);
  // A brand with no topic yet: Track asks for one first.
  const topicFirst = useTopicFirstDialog();

  const result = useMemo(() => {
    const names = Object.fromEntries(
      (entities ?? []).filter((e) => !e.isOwnBrand).map((e) => [e.key, e.name]),
    );
    return opportunities(
      suggestions.filter((s) => !trackedIds.has(s.id)),
      topicStandings(topics, names, trackedTopicIds && new Set(trackedTopicIds)),
    );
  }, [suggestions, trackedIds, topics, entities, trackedTopicIds]);
  const planFull = slotsLeft !== null && slotsLeft <= 0;
  const left = contentLeft(contentUsage?.opportunities, contentSpent);
  const contentFullHint = contentUsage?.periodEnd
    ? t('contentLimitResets', {
        date: format.dateTime(new Date(contentUsage.periodEnd), {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      })
    : t('contentLimit');

  const run = async (key: string, work: () => Promise<void>) => {
    setWorking((prev) => new Set(prev).add(key));
    try {
      await work();
    } finally {
      setWorking((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const sendAction = (item: Opportunity) =>
    run(item.key, async () => {
      if (!item.topicId) return;
      try {
        const result = await sendTopicOpportunityToActionCenter(item.topicId, item.suggestionIds);
        if ('error' in result) {
          // The suggestions can be older than the server's: refreshed or handled since.
          if (result.code === 'stale') toast.error(t('sendStale'));
          else toast.error(t('sendFailed'), { description: result.error });
          return;
        }
        toast.success(
          result.created
            ? t('sent', { no: result.actionNo })
            : t('alreadySent', { no: result.actionNo }),
          {
            action: {
              label: t('openAction'),
              onClick: () =>
                router.push(`/dashboard/action-center/actions?action=${result.actionId}`),
            },
          },
        );
      } catch {
        toast.error(t('sendFailed'));
      }
    });

  const suggestContent = (item: Opportunity) =>
    run(item.key, async () => {
      const description = item.title;
      const toastId = toast.loading(t('writing'), { description });
      const open = (label: string, id: string) => ({
        label,
        onClick: () => router.push(`/dashboard/content?opportunity=${id}`),
      });
      try {
        // "+ New" for the prompt's topic, steered by the prompt (CONTENT-003).
        const started = await generateOpportunitiesOnDemand({
          brandId,
          count: 1,
          topicId: item.topicId,
          idea: item.title,
          idempotencyKey: crypto.randomUUID(),
        });
        if (!started.ok) {
          if (started.quotaExhausted) toast.error(t('contentLimit'), { id: toastId, description });
          else failureToast(started.failure, { id: toastId, description });
          return;
        }
        const outcome = await waitForContentJob(started.jobId, {
          getStatus: getGenerationJobStatus,
        });
        if (outcome.kind === 'completed') {
          const createdId = outcome.result.opportunityIds?.[0];
          if (createdId) {
            setContentSpent((n) => n + 1);
            toast.success(t('written'), {
              id: toastId,
              description,
              duration: 10_000,
              action: open(t('openContent'), createdId),
            });
          } else if (outcome.result.limited) {
            toast.error(t('contentLimit'), { id: toastId, description });
          } else {
            toast.info(t('notWritten'), { id: toastId, description: t('notWrittenWhy') });
          }
        } else if (outcome.kind === 'failed') {
          toast.error(t('writeFailed'), { id: toastId, description });
        } else {
          toast.info(t('stillWriting'), { id: toastId, description: t('stillWritingWhy') });
        }
      } catch {
        // Nothing may be left spinning, whatever went wrong on the way.
        toast.error(t('writeFailed'), { id: toastId, description });
      }
    });

  /** Why an item's second button is off, as its hint, or null when it can be used. */
  const secondaryBlocked = (item: Opportunity): string | null => {
    const block = secondaryBlock(item, left);
    if (block === 'needsTopic') return t('sendNeedsTopic');
    if (block === 'trackFirst') return t('suggestTrackFirst');
    return block === 'contentLimit' ? contentFullHint : null;
  };
  // Only a plan with a monthly limit has a quota to mention.
  const suggestHint =
    left === null ? t('suggestHint') : `${t('suggestHint')} ${t('suggestHintQuota')}`;

  const track = async (item: Opportunity) => {
    // Tracked Prompts opens in a new tab, opened here in the click so it isn't
    // blocked as a pop-up; it moves to the table once the prompts are added.
    const tab = openPendingTab(t('addingPrompts'));
    setBusy(item.key);
    try {
      const {
        trackedIds: done,
        skippedIds,
        error,
        code,
      } = await trackSuggestions(item.suggestionIds);
      // Skipped ones were accepted or dismissed elsewhere: they leave the list too.
      if (done.length + skippedIds.length > 0) {
        setTrackedIds((prev) => new Set([...prev, ...done, ...skippedIds]));
      }
      if (done.length > 0) {
        onTracked(done.length);
        tab.go(TRACKED_HREF);
      } else {
        tab.close();
      }
      // With the tab blocked, the toast's Open is the way there.
      const open = tab.opened
        ? undefined
        : { label: t('openPrompts'), onClick: () => router.push(TRACKED_HREF) };
      if (!error && done.length === 0) {
        toast.info(t('alreadyHandled'));
      } else if (!error && item.kind === 'topic' && item.topicId) {
        // Tracking takes the topic off the card; Send action stays one click away.
        toast.success(t('tracked', { count: done.length }), {
          duration: 10_000,
          action: {
            label: t('sendAction'),
            onClick: () => sendAction({ ...item, suggestionIds: done }),
          },
        });
      } else if (!error) {
        toast.success(t('tracked', { count: done.length }), { action: open });
      } else if (code === 'plan_limit' && done.length > 0) {
        toast.warning(
          t('trackedPartly', { tracked: done.length, total: item.suggestionIds.length }),
          { action: open },
        );
      } else if (code === 'plan_limit') {
        toast.error(t('planFull'));
      } else if (code === NO_TOPICS) {
        topicFirst.show();
      } else {
        toast.error(t('trackFailed'), { description: error });
      }
    } catch {
      tab.close();
      toast.error(t('trackFailed'));
    } finally {
      setBusy(null);
    }
  };

  /** The parts of a row's line under its title, between dots. */
  const dotted = (parts: React.ReactNode[]) =>
    parts.filter(Boolean).flatMap((part, i) => (i === 0 ? [part] : ['\u00a0·\u00a0', part]));

  const meta = (item: Opportunity): React.ReactNode[] => {
    // The suggestions' volume is an AI's guess: a grey range with its note (PROMPT-013).
    const volume =
      item.volume === null ? null : (
        <EstimateRange
          key="volume"
          estimate={guessedVolumeEstimate(item.volume, null)}
          kind={item.kind === 'topic' ? 'total' : 'prompt'}
          perMonth
        />
      );
    if (item.kind === 'prompt') return dotted([volume, t('notTracked')]);
    const s = item.standing;
    const standing =
      s.kind === 'competitor'
        ? s.name
          ? t('competitorLeads', { name: s.name })
          : t('leaderScore', { score: f.number(s.score, 1) })
        : s.kind === 'you'
          ? t('youLead')
          : s.kind === 'notTracked'
            ? t('notTracked')
            : null;
    return dotted([t('prompts', { count: item.suggestionIds.length }), volume, standing]);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
          {result.status === 'ready' && (
            <Link
              href={SUGGESTIONS_HREF}
              className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('seeAll')}
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {result.status === 'ready' ? (
          <>
            <ul className="divide-y" aria-label={t('listLabel')}>
              {result.items.slice(0, VISIBLE_ITEMS).map((item) => {
                const isTopic = item.kind === 'topic';
                const Icon = isTopic ? Tag : MessageCircle;
                const count = item.suggestionIds.length;
                const blocked = secondaryBlocked(item);
                return (
                  <li
                    key={item.key}
                    className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">{isTopic ? t('topicKind') : t('promptKind')}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium" title={item.title}>
                        {item.title}
                      </span>
                      {/* Text truncates, the range doesn't: its focus ring and button stay whole. */}
                      <span className="flex min-w-0 items-baseline text-xs text-muted-foreground">
                        {meta(item).map((part, i) =>
                          typeof part === 'string' ? (
                            <span key={i} className="truncate">
                              {part}
                            </span>
                          ) : (
                            <span key={i} className="shrink-0">
                              {part}
                            </span>
                          ),
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {/* The hints sit on wrappers: a disabled button shows no tooltip. */}
                      {canManage && (
                        <span
                          title={
                            planFull
                              ? t('planFull')
                              : isTopic
                                ? t('trackCountHint', { count, topic: item.title })
                                : t('trackHint')
                          }
                        >
                          <Button
                            size="sm"
                            className="h-7 gap-1.5 px-2.5 text-xs"
                            disabled={planFull || busy !== null}
                            onClick={guard(() => track(item), { action: tActions('trackPrompts') })}
                          >
                            {/* Track N adds one prompt at a time, so a big topic takes a moment. */}
                            {busy === item.key && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            )}
                            {isTopic ? t('trackCount', { count }) : t('track')}
                          </Button>
                        </span>
                      )}
                      {(isTopic || canManage) && (
                        <span
                          title={
                            blocked ??
                            (isTopic ? t('sendActionHint', { topic: item.title }) : suggestHint)
                          }
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 px-2.5 text-xs"
                            disabled={blocked !== null || working.has(item.key)}
                            onClick={guard(
                              () => (isTopic ? sendAction(item) : suggestContent(item)),
                              {
                                action: tActions(isTopic ? 'sendAction' : 'suggestContent'),
                              },
                            )}
                          >
                            {working.has(item.key) && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            )}
                            {isTopic ? t('sendAction') : t('suggestContent')}
                          </Button>
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!canManage && (
              <p className="pt-2.5 text-xs text-muted-foreground">
                {result.items.slice(0, VISIBLE_ITEMS).some((item) => item.kind !== 'topic')
                  ? tManagers('trackOrSuggestContent')
                  : tManagers('addPrompts')}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="max-w-xs text-xs text-muted-foreground">
              {/* Tracking the last item empties the list: that's done, not "nothing fits". */}
              {result.status === 'noneRelevant' && trackedIds.size > 0
                ? t('allTracked')
                : t(result.status)}
            </p>
            <Link
              href={SUGGESTIONS_HREF}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('openSuggestions')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        )}
        {topicFirst.dialog}
      </CardContent>
    </Card>
  );
}
