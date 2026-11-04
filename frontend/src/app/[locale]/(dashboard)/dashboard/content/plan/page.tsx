'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingDots } from '@/components/ui/loading-dots';
import { NewContentDialog, type DialogPreset } from '@/components/content/NewContentDialog';
import {
  getContentPlan,
  getContentPlanInsights,
  hidePlanRow,
  setPlanRowPriority,
  showPlanRow,
} from '@/lib/actions/contentPlan';
import { listBrandMembers, type TeamMember } from '@/lib/actions/team';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useRouter } from '@/i18n/navigation';
import { contentEditorPath, type PageType } from '@/lib/content/drafts';
import { pageTypeMix } from '@/lib/content/planMix';
import { siteTypeOf } from '@/lib/content/pageTypes';
import {
  PLAN_CARDS,
  PLAN_PERIODS,
  buildPlan,
  earlierPeriod,
  rowsFor,
  type PlanAction,
  type PlanCard,
  type PlanPeriod,
  type PlanRow,
} from '@/lib/content/plan';
import { formatNumber } from '@/lib/format';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { AssignDialog } from './_AssignDialog';
import { AiResultsStrip, PageTypeMix } from './_PlanInsights';
import { PlanTable } from './_PlanTable';
import { ShoppingOpportunities } from './_ShoppingOpportunities';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

type PlanRead = {
  brandId: string;
  days: PlanPeriod;
  data: Awaited<ReturnType<typeof getContentPlan>>;
  failed: boolean;
};

/** The page-type mix and results strip, read on their own: either can fail alone. */
type InsightsRead = {
  brandId: string;
  days: PlanPeriod;
  data: Awaited<ReturnType<typeof getContentPlanInsights>>;
};

/**
 * Each card's color, as its action's tag: Create blue, Optimize amber,
 * Protect green; Priority, the rows marked, in ink as its outline badge.
 */
const CARD_DOT: Record<PlanCard, string> = {
  create: 'bg-blue-600 dark:bg-blue-400',
  optimize: 'bg-amber-600 dark:bg-amber-400',
  protect: 'bg-green-600 dark:bg-green-400',
  priority: 'bg-foreground',
};

/** What New content opens on for a row: its opportunity in Start, or its page to optimize. */
function presetFor(row: PlanRow): DialogPreset {
  return row.opportunityId
    ? {
        kind: 'opportunity',
        id: row.opportunityId,
        // An opportunity for an existing page starts on that page.
        page: row.page ? { url: row.page, title: row.title } : null,
      }
    : { kind: 'page', url: row.page! };
}

/**
 * The Content plan (Content Editor CE-014, spec v2 §4): what to create,
 * optimize or protect next, for the last 7, 30 or 90 days. The cards count
 * the work and the priorities and filter the list, as a row of the
 * page-type mix does; the list ranks it, priorities first, and each row
 * starts it in New content (Start for an opportunity, an existing page read
 * to optimize) or opens the draft already being written. A row's menu
 * assigns it to a teammate, and lets admins and managers mark it as a
 * priority or hide it; hidden rows can be shown again below the list. The
 * period lives in the URL (?days=7). Getting started's content steps open
 * the Plan on its top Create or Optimize row (?start=create, 00234). A shop
 * with a catalog sees its Shopping opportunities above the list.
 */
export default function ContentPlanPage() {
  const t = useTranslations('contentEditor.plan');
  const format = useFormatter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const siteType = siteTypeOf(activeBrand ?? {});
  // Null until the URL is read, so ?days=7 reads 7 days once, not 30 first.
  const [days, setDays] = useState<PlanPeriod | null>(null);
  const [card, setCard] = useState<PlanCard | null>(null);
  const [mixType, setMixType] = useState<PageType | null>(null);
  const [insights, setInsights] = useState<InsightsRead | null>(null);
  const [read, setRead] = useState<PlanRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [preset, setPreset] = useState<DialogPreset | null>(null);
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): New content, Start, Assign and
  // the row menu open the upgrade dialog instead; the cards, the mix and the
  // period still filter.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The people who can see the brand, read for it: another brand's aren't offered.
  const [team, setTeam] = useState<{ brandId: string; members: TeamMember[] } | null>(null);
  const members = team && team.brandId === activeBrandId ? team.members : [];
  const [assigning, setAssigning] = useState<PlanRow | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // Another brand starts unfiltered: its cards and types are its own.
  const [filtersFor, setFiltersFor] = useState(activeBrandId);
  if (filtersFor !== activeBrandId) {
    setFiltersFor(activeBrandId);
    setCard(null);
    setMixType(null);
  }

  // Getting started's create or optimize step: start the top row of that action once the plan is in.
  const [startFrom, setStartFrom] = useState<Extract<PlanAction, 'create' | 'optimize'> | null>(
    null,
  );
  const router = useRouter();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setDays(Number(readUrlChoice('days', ['7', '30', '90'], '30')) as PlanPeriod);
    const start = readUrlParam('start');
    if (start === 'create' || start === 'optimize') {
      setStartFrom(start);
      // Once: a reload or a shared link opens the plan as it is.
      writeUrlParams({ start: null });
    }
  }, []);

  useEffect(() => {
    if (!activeBrandId || days === null) return;
    let cancelled = false;
    getContentPlan(activeBrandId, days)
      .then((data) => {
        // Null: the brand isn't the member's to read.
        if (!cancelled) setRead({ brandId: activeBrandId, days, data, failed: data === null });
      })
      .catch((err) => {
        console.error('Failed to load the content plan:', err);
        if (!cancelled) setRead({ brandId: activeBrandId, days, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, days, attempt]);

  // Read again with the brand or the period only: a draft sent changes nothing in them.
  useEffect(() => {
    if (!activeBrandId || days === null) return;
    let cancelled = false;
    getContentPlanInsights(activeBrandId, days)
      .then((data) => {
        if (!cancelled) setInsights({ brandId: activeBrandId, days, data });
      })
      .catch((err) => {
        // The list still works without them; the sections stay hidden.
        console.error('Failed to load what AI cites for the content plan:', err);
        if (!cancelled) setInsights({ brandId: activeBrandId, days, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, days]);

  // A read for another brand or period (just switched) counts as still loading.
  const current = read?.brandId === activeBrandId && read.days === days ? read : null;
  const plan = useMemo(
    () => (current?.data ? buildPlan({ ...current.data, siteType }) : null),
    [current, siteType],
  );
  const insightsRead = insights?.brandId === activeBrandId && insights.days === days;
  const shown = insightsRead ? insights.data : null;
  // One spinner until both reads are in, so the page opens in its final
  // layout rather than the list first and the sections above it after. A
  // list that failed says so at once.
  const loading = !current?.failed && !(current && insightsRead);
  const mix = useMemo(
    () => (shown ? pageTypeMix(shown.citations, siteType, shown.totalCitations) : null),
    [shown, siteType],
  );
  // A type picked in another period's mix filters only while this one lists it.
  const typeFilter = mix?.rows.some((r) => r.pageType === mixType) ? mixType : null;
  const earlier = current?.data ? earlierPeriod(current.data.answers, current.data.tracking) : null;

  const changeDays = (next: PlanPeriod) => {
    setDays(next);
    writeUrlParams({ days: String(next) }, { days: '30' });
  };

  const startRow = (row: PlanRow) => {
    setPreset(presetFor(row));
    setStarting(true);
  };

  // The team, for assigning: read once per brand, when first needed.
  const loadMembers = () => {
    if (!activeBrandId || members.length > 0) return;
    const brandId = activeBrandId;
    listBrandMembers(brandId)
      .then((list) => setTeam({ brandId, members: list }))
      .catch((err) => console.error('Failed to load the team:', err));
  };

  // A row with a draft assigns its task; one without starts in Start, as Team.
  const assignRow = (row: PlanRow) => {
    loadMembers();
    if (row.draft) {
      setAssigning(row);
      return;
    }
    setPreset({ ...presetFor(row), who: 'team' });
    setStarting(true);
  };

  // The step's row: the top one of its action not being written yet, or the
  // draft already being written for the top one. With none, the card shows
  // that there is none.
  useEffect(() => {
    if (!startFrom || !plan) return;
    const ofAction = plan.rows.filter((r) => r.action === startFrom);
    const row = ofAction.find((r) => !r.draft) ?? ofAction[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one start per visit from Getting started
    setStartFrom(null);
    setCard(startFrom);
    // Read-only: the plan opens on the step's card, and nothing starts by itself.
    if (!row || isLocked) return;
    if (row.draft) {
      router.push(contentEditorPath(row.draft.id));
      return;
    }
    setPreset(presetFor(row));
    setStarting(true);
  }, [startFrom, plan, router, isLocked]);

  const reload = () => setAttempt((n) => n + 1);

  const markRow = async (row: PlanRow, priority: boolean) => {
    if (!activeBrandId) return;
    try {
      await setPlanRowPriority(activeBrandId, row.key, priority);
      reload();
    } catch (err) {
      console.error('Failed to mark the Plan row:', err);
      toast.error(t('rowMenu.failed'));
    }
  };

  const showRow = async (row: PlanRow) => {
    if (!activeBrandId) return;
    try {
      await showPlanRow(activeBrandId, row.key);
      reload();
    } catch (err) {
      console.error('Failed to show the Plan row:', err);
      toast.error(t('rowMenu.failed'));
    }
  };

  const hideRow = async (row: PlanRow) => {
    if (!activeBrandId) return;
    try {
      await hidePlanRow(activeBrandId, row.key);
      reload();
      toast(t('rowMenu.hidden', { title: row.title }), {
        action: { label: t('rowMenu.undo'), onClick: () => void showRow(row) },
      });
    } catch (err) {
      console.error('Failed to hide the Plan row:', err);
      toast.error(t('rowMenu.failed'));
    }
  };

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  const rows = plan ? rowsFor(plan.rows, card, typeFilter) : [];
  const filtered = card !== null || typeFilter !== null;

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t('period')}
              className="inline-flex h-8 rounded-lg border bg-muted/40 p-0.5"
            >
              {PLAN_PERIODS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={days === value}
                  onClick={() => changeDays(value)}
                  className={cn(
                    'rounded-md px-3 text-sm transition-colors',
                    days === value
                      ? 'bg-background font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('periods', { days: value })}
                </button>
              ))}
            </div>
            <Button
              className="gap-2"
              onClick={guard(
                () => {
                  setPreset(null);
                  setStarting(true);
                },
                { action: tActions('createContent') },
              )}
            >
              <Plus className="h-4 w-4" />
              {t('newContent')}
            </Button>
          </div>
        </div>
      </HeaderWithAiUsage>
      <NewContentDialog
        open={starting}
        onOpenChange={(open) => {
          setStarting(open);
          if (!open) setPreset(null);
        }}
        brandId={activeBrandId}
        siteType={siteType}
        preset={preset}
        onSent={() => setAttempt((n) => n + 1)}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_CARDS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={card === value}
            disabled={!plan}
            onClick={() => setCard((c) => (c === value ? null : value))}
            className={cn(
              'rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-card',
              card === value && 'border-foreground ring-1 ring-inset ring-foreground',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className={cn('h-2 w-2 rounded-full', CARD_DOT[value])} />
              {t(`cards.${value}.title`)}
            </span>
            <span className="mt-2 block text-2xl font-semibold tabular-nums">
              {plan ? formatNumber(plan.counts[value]) : '—'}
            </span>
            <span className="block text-xs text-muted-foreground">{t(`cards.${value}.hint`)}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" aria-busy="true">
          <LoadingDots size="md" className="text-muted-foreground" />
        </div>
      ) : (
        <>
          {shown && current && (
            <AiResultsStrip
              results={shown.results}
              conversions={shown.conversions}
              days={current.days}
            />
          )}
          {mix && (
            <PageTypeMix
              rows={mix.rows}
              covered={mix.covered}
              selected={typeFilter}
              onSelect={setMixType}
            />
          )}
        </>
      )}
      {/* Its own read, of the catalog: kept through another period's read,
          hidden while that loads, so the page still opens in its final layout. */}
      {siteType === 'ecommerce' && (
        <ShoppingOpportunities brandId={activeBrandId} hidden={loading} />
      )}
      {!loading && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">{t('listTitle')}</h2>
              <p className="text-xs text-muted-foreground">
                {filtered ? t('filtered') : t('ranked')}
              </p>
            </div>
            {current?.data && earlier !== 'full' && earlier !== null && (
              <p className="text-xs text-muted-foreground">
                {t(earlier === 'none' ? 'earlier.none' : 'earlier.partial', {
                  days: current.days,
                  since: current.data.tracking.trackedSince
                    ? format.dateTime(new Date(`${current.data.tracking.trackedSince}T00:00:00Z`), {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })
                    : '—',
                })}
              </p>
            )}
            <Card className="py-0">
              <CardContent className="px-0">
                {current?.failed ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <p className="text-sm text-muted-foreground">{t('loadError')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRead(null);
                        setAttempt((n) => n + 1);
                      }}
                    >
                      {t('retry')}
                    </Button>
                  </div>
                ) : !plan ? (
                  <div className="flex items-center justify-center py-12" aria-busy="true">
                    <LoadingDots size="md" className="text-muted-foreground" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                    {filtered ? t('emptyFiltered') : t('empty')}
                  </p>
                ) : (
                  <PlanTable
                    rows={rows}
                    days={current?.days ?? 30}
                    canManage={canManage}
                    onStart={(row) =>
                      guard(startRow, {
                        action: tActions(
                          row.action === 'create' ? 'createContent' : 'optimizeContent',
                        ),
                      })(row)
                    }
                    onAssign={guard(assignRow, { action: tActions('assignContent') })}
                    onPriority={guard(
                      (row: PlanRow, priority: boolean) => void markRow(row, priority),
                      { action: tActions('prioritizeContent') },
                    )}
                    onHide={guard((row: PlanRow) => void hideRow(row), {
                      action: tActions('hidePlanRows'),
                    })}
                  />
                )}
              </CardContent>
            </Card>
            {plan && plan.hidden.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  aria-expanded={showHidden}
                  onClick={() => setShowHidden((v) => !v)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t('hidden.toggle', { count: plan.hidden.length, open: String(showHidden) })}
                </button>
                {showHidden && (
                  <ul className="divide-y rounded-xl border">
                    {plan.hidden.map((row) => (
                      <li
                        key={row.key}
                        className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate text-muted-foreground" title={row.title}>
                          {row.title}
                        </span>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={guard(() => void showRow(row), {
                              action: tActions('showPlanRows'),
                            })}
                          >
                            {t('hidden.show')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}
      <AssignDialog
        brandId={activeBrandId}
        row={assigning}
        members={members}
        onClose={() => setAssigning(null)}
        onAssigned={() => {
          setAssigning(null);
          reload();
        }}
      />
    </div>
  );
}
