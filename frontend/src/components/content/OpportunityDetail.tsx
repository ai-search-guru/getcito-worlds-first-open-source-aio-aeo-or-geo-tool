'use client';

import { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useFailureToast } from '@/hooks/useFailureToast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  TrendingUp,
  Eye,
  Users,
  Search,
  Tag,
  Clock,
  Sparkles,
  FileText,
  Target,
  ListOrdered,
  Crown,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
import { AiUsageBanner } from '@/components/ai-usage/AiUsageBanner';
import { Link, useRouter } from '@/i18n/navigation';
import {
  getOpportunity,
  updateOpportunityStatus,
  sendToWebhook,
  generateBrief,
  getBriefQuota,
  sendOpportunityToActionCenter,
  suggestAlternative,
  getGenerationJobStatus,
  type BriefQuota,
} from '@/lib/actions/content';
import { EstimateBadge, EstimateRange } from '@/components/prompts/VolumeEstimate';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  AlternativeDialog,
  DismissReasonDialog,
  type DismissReason,
} from '@/components/content/OpportunityAngleDialogs';
import type { ContentBrief, ContentOpportunity } from '@/types';
import { getPromptFanout, type FanoutSubQuery } from '@/lib/actions/fanout';
import {
  AssetsCard,
  OpportunityResultsCard,
  OpportunityBasketCard,
  ScoreBreakdown,
  TargetPagesCard,
} from '@/components/content/OpportunityBasket';
import { opportunityDocument, opportunityToMarkdown } from '@/lib/content/opportunityMarkdown';
import { useOpportunityVolume } from '@/hooks/useOpportunityVolume';
import type { QuestionVolume } from '@/lib/content/questionVolume';
import {
  opportunityCsv,
  opportunityDocx,
  opportunityExportFileName,
  opportunityWorkbook,
  type OpportunityExportFormat,
} from '@/lib/content/opportunityExport';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import { saveBlob } from '@/lib/download';
import { exportAuthor, exportFileWord } from '@/lib/white-label/exportName';
import { canWriteOpportunity, opportunityStart } from '@/lib/content/opportunityStart';
import { contentEditorPath } from '@/lib/content/drafts';
import { siteTypeOf } from '@/lib/content/pageTypes';
import { getOpportunityDrafts } from '@/lib/actions/contentDrafts';
import { getPlanPriorities, setPlanRowPriority } from '@/lib/actions/contentPlan';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { isNoPlan } from '@/lib/billing/noPlan';
import { useBrandStore } from '@/state/useBrandStore';
import { OpportunityActions } from '@/components/content/OpportunityActions';
import { NewContentDialog, type DialogPreset } from '@/components/content/NewContentDialog';
import { WriteThisDialog } from '@/components/content/WriteThisDialog';
import { useAssetTypeLabel } from '@/hooks/useAssetTypeLabel';
import { toast } from 'sonner';
import { suggestedDate } from '@/lib/suggestedDate';
import { formatNumber } from '@/lib/format';

export const IMPACT_COLORS: Record<string, string> = {
  high: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  reviewed: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  in_progress: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  done: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  archived: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-500 dark:text-zinc-400',
};

const INTENT_LABELS: Record<string, string> = {
  comparison: 'Comparison',
  'how-to': 'How-to',
  'what-is': 'What is',
  'best-top': 'Best / Top',
  'vs-review': 'vs. / Review',
  recommendation: 'Recommendation',
  'problem-solving': 'Problem Solving',
  other: 'Other',
};

/**
 * What the volume is of: the question the opportunity is shown with, one of
 * its prompts, and for a long question, that it is read from head terms, with
 * the measured phrase closest to its words.
 */
function QuestionVolumeNote({
  question,
  prompts,
}: {
  question: QuestionVolume | null;
  prompts: number;
}) {
  const t = useTranslations('content.detail');
  return (
    <span className="block max-w-72 space-y-0.5 text-xs font-normal text-muted-foreground">
      <span className="block">
        {question
          ? t('volumeOfQuestion', { question: question.question, count: prompts })
          : t('volumeOfPrompts', { count: prompts })}
      </span>
      {question?.fromHeadTerms && (
        <span className="block">
          {question.closest
            ? t.rich('volumeHeadTerms', {
                phrase: question.closest.phrase,
                range: () => <EstimateRange estimate={question.closest!.estimate} perMonth />,
              })
            : t('volumeHeadTermsOnly')}
        </span>
      )}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-3', className)}>
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

/**
 * A content opportunity in full: its decision, assets, basket, brief and
 * actions. Rendered as its own page (/dashboard/content/[id]) and inside the
 * list's drawer, so reviewing one never loses the list's filters.
 */
/** How long the panel follows an "Another angle" job before giving up. */
const ALTERNATIVE_TIMEOUT_MS = 3 * 60 * 1000;

export function OpportunityDetail({
  id,
  inDrawer = false,
  onChanged,
  onPrioritized,
}: {
  id: string;
  /** In the list's drawer: no back link, and the layout follows the drawer's width. */
  inDrawer?: boolean;
  /** Called after any change to the opportunity, so the list can refresh. */
  onChanged?: () => void;
  /**
   * Called once Send to Plan marked it as a priority: the list keeps its
   * rows' marks (they aren't read again on a refresh), so its menu agrees.
   */
  onPrioritized?: (id: string) => void;
}) {
  const t = useTranslations('content');
  const failureToast = useFailureToast();
  const assetTypeLabel = useAssetTypeLabel();
  const locale = useLocale();
  // A read-only workspace (plan not active): every action here opens the
  // upgrade dialog instead; Copy, Export and Open draft stay open.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const tReadOnly = useTranslations('readOnly');
  const tManagers = useTranslations('managersOnly');

  const [opportunity, setOpportunity] = useState<ContentOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [quota, setQuota] = useState<BriefQuota | null>(null);
  const [fanoutQueries, setFanoutQueries] = useState<FanoutSubQuery[]>([]);
  const { basket, basketFailed, volume, question, prompts } = useOpportunityVolume(opportunity);
  const router = useRouter();
  // Start's page types are the opportunity's brand's, which may not be the
  // active one (/dashboard/content/[id] opens any of the org's brands).
  const opportunityBrand = useBrandStore((s) =>
    s.brands.find((b) => b.id === (opportunity?.brandId ?? s.activeBrandId)),
  );
  // Send to Editor: Start for this opportunity, over the panel.
  const [contentPreset, setContentPreset] = useState<DialogPreset | null>(null);
  // Write this: the brief and the page in one go, over the panel.
  const [writeThisOpen, setWriteThisOpen] = useState(false);
  // The draft being written for it, opened instead of starting another. A
  // failed read is not "no draft": it offers to check again.
  const [draft, setDraft] = useState<{
    opportunityId: string;
    id: string | null;
    failed: boolean;
  } | null>(null);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const brandId = opportunity?.brandId;
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getOpportunityDrafts(brandId, [id]).then(
      (drafts) =>
        !cancelled && setDraft({ opportunityId: id, id: drafts[id] ?? null, failed: false }),
      () => !cancelled && setDraft({ opportunityId: id, id: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [brandId, id, draftAttempt]);
  const retryDraft = () => {
    setDraft(null);
    setDraftAttempt((n) => n + 1);
  };
  // Send to Plan: whether its Plan row is a priority already (admins and
  // managers mark Plan rows).
  const { canManage } = useUserRole();
  const [priority, setPriority] = useState<{ opportunityId: string; on: boolean } | null>(null);
  useEffect(() => {
    if (!brandId || !canManage) return;
    let cancelled = false;
    getPlanPriorities(brandId, [id]).then(
      (ids) => !cancelled && setPriority({ opportunityId: id, on: ids.includes(id) }),
      () => !cancelled && setPriority({ opportunityId: id, on: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [brandId, id, canManage]);
  const handleSendToPlan = async () => {
    if (!brandId) return;
    try {
      await setPlanRowPriority(brandId, `opportunity:${id}`, true);
      setPriority({ opportunityId: id, on: true });
      onPrioritized?.(id);
      toast.success(t('sentToPlan'), {
        action: { label: t('openPlan'), onClick: () => router.push('/dashboard/content/plan') },
      });
    } catch {
      toast.error(t('sendToPlanError'));
    }
  };

  useEffect(() => {
    setLoading(true);
    getOpportunity(id)
      .then((opp) => {
        setOpportunity(opp);
        if (opp.brief) setBrief(opp.brief);
        // A cluster opportunity shows its whole basket instead (#857).
        if (opp.brandId && opp.promptId && !opp.clusterId) {
          getPromptFanout(opp.brandId, opp.promptId)
            .then((d) => setFanoutQueries(d.subQueries))
            .catch(() => setFanoutQueries([]));
        }
      })
      .catch((err) => {
        console.error('Failed to load opportunity:', err);
        toast.error(t('loadOpportunityError'));
      })
      .finally(() => setLoading(false));

    // Quota is informational — don't block the page if it fails.
    getBriefQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, [id, t]);

  const handleSend = async () => {
    setSending(true);
    try {
      const result = await sendToWebhook(id);
      if (result.success === false) {
        toast.error(result.error);
      } else {
        toast.success(t('sentToWorkflow'));
        const updated = await getOpportunity(id);
        setOpportunity(updated);
        onChanged?.();
      }
    } catch (err) {
      console.error('Send failed:', err);
      toast.error(t('sendError'));
    } finally {
      setSending(false);
    }
  };

  const handleReviewed = async () => {
    try {
      await updateOpportunityStatus(id, 'reviewed');
      setOpportunity(await getOpportunity(id));
      onChanged?.();
    } catch {
      toast.error(t('reviewedError'));
    }
  };

  // "Another angle" (CONTENT-006): generation runs as a content job; the
  // panel follows it and says when the alternative is in the list.
  const [alternativeOpen, setAlternativeOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [alternativeRunning, setAlternativeRunning] = useState(false);

  const followAlternative = async (jobId: string) => {
    setAlternativeRunning(true);
    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < ALTERNATIVE_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 3000));
        const job = await getGenerationJobStatus(jobId);
        if (job.status === 'completed') {
          if (job.result?.limited) toast.error(t('newLimitReached'));
          else if ((job.result?.generated ?? 0) > 0) toast.success(t('alternative.done'));
          else toast(t('alternative.none'));
          onChanged?.();
          return;
        }
        if (job.status === 'failed') {
          toast.error(job.failedReason || t('alternative.failed'), {
            description: t('newRefunded'),
          });
          return;
        }
      }
      // The job may still finish (and use its slot), so don't promise a refund.
      toast(t('alternative.stillRunning'));
    } finally {
      setAlternativeRunning(false);
    }
  };

  const handleAlternative = async (direction: string | null): Promise<boolean> => {
    const result = await suggestAlternative(id, {
      direction,
      idempotencyKey: crypto.randomUUID(),
    }).catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : t('alternative.failed'),
      failure: 'failed' as const,
      quotaExhausted: false,
      noCluster: false,
    }));
    if (!result.ok) {
      // No cluster says what to do itself; anything else in plain words (BUG-001).
      if (result.quotaExhausted) toast.error(t('newLimitReached'));
      else if (result.noCluster) toast.error(result.error);
      else failureToast(result.failure);
      return false;
    }
    toast(t('alternative.started'));
    void followAlternative(result.jobId);
    return true;
  };

  const handleDismiss = async (reason?: DismissReason) => {
    try {
      await updateOpportunityStatus(id, 'dismissed', reason);
      const updated = await getOpportunity(id);
      setOpportunity(updated);
      onChanged?.();
      // The topic is right, the angle wrong: offer the other angle straight away.
      if (reason === 'wrong_angle') setAlternativeOpen(true);
      toast.success(t('dismissedToast'), {
        action: {
          label: t('undo'),
          onClick: async () => {
            try {
              await updateOpportunityStatus(id, 'new');
              const restored = await getOpportunity(id);
              setOpportunity(restored);
              onChanged?.();
            } catch {
              toast.error(t('undoFailed'));
            }
          },
        },
      });
    } catch {
      toast.error(t('dismissError'));
    }
  };

  // Action Center (#857): the whole opportunity, or one asset by its key.
  const [sendingAction, setSendingAction] = useState<string | null>(null);
  const handleSendToActionCenter = async (assetKey?: string) => {
    setSendingAction(assetKey ?? 'all');
    try {
      const result = await sendOpportunityToActionCenter(id, assetKey);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success(result.created ? t('sentToActionCenter') : t('alreadyInActionCenter'));
      setOpportunity(await getOpportunity(id));
      onChanged?.();
    } catch {
      toast.error(t('sendToActionCenterError'));
    } finally {
      setSendingAction(null);
    }
  };

  const handleRestore = async () => {
    try {
      await updateOpportunityStatus(id, 'new');
      setOpportunity(await getOpportunity(id));
      onChanged?.();
      toast.success(t('restoredToast'));
    } catch {
      toast.error(t('restoreError'));
    }
  };

  const handleGenerateBrief = async () => {
    setGeneratingBrief(true);
    try {
      const result = await generateBrief(id);
      setBrief(result.brief);
      if (result.quota) setQuota(result.quota);
      onChanged?.();
      toast.success(t('briefGeneratedToast'));
    } catch (err) {
      console.error('Brief generation failed:', err);
      toast.error(err instanceof Error ? err.message : t('briefGenerateError'));
      // Refresh the counter — the failure may have been a quota rejection.
      getBriefQuota()
        .then(setQuota)
        .catch(() => {});
    } finally {
      setGeneratingBrief(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingDots size="md" label={t('loadingOpportunity')} className="text-muted-foreground" />
      </div>
    );
  }

  if (!opportunity) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Opportunity not found.</p>
      </div>
    );
  }

  const sd = opportunity.sourceData;
  // What the opportunity makes: its primary asset's type.
  const primaryType = assetTypeLabel(sd.assets?.[0]?.type);
  const canSendToActionCenter = !['dismissed', 'archived', 'done'].includes(opportunity.status);
  const quotaLimited = quota !== null && quota.limit !== -1;
  // Without an active plan the quota reads 0 of 0: not used up. Generate
  // stays clickable, and opens the plan dialog.
  const noPlan = isNoPlan(quota, isLocked);
  const quotaExhausted = quotaLimited && !noPlan && quota.remaining <= 0;
  const actionId = sd.actions?.all ?? Object.values(sd.actions ?? {})[0];
  const canSendToWorkflow = !['dismissed', 'archived'].includes(opportunity.status);

  // Export (the user's spec): what Copy All Data copies, as a file.
  const handleExport = async (format: OpportunityExportFormat) => {
    const doc = opportunityDocument(opportunity, brief, fanoutQueries, assetTypeLabel, volume);
    try {
      const fileName = opportunityExportFileName(doc, format, await exportFileWord());
      if (format === 'csv') {
        saveBlob(
          new Blob([BYTE_ORDER_MARK, opportunityCsv(doc)], { type: 'text/csv;charset=utf-8;' }),
          fileName,
        );
      } else if (format === 'xlsx') {
        const { default: writeXlsxFile } = await import('write-excel-file/browser');
        await writeXlsxFile(opportunityWorkbook(doc)).toFile(fileName);
      } else {
        saveBlob(await opportunityDocx(doc, await exportAuthor()), fileName);
      }
    } catch (err) {
      console.error('Export failed:', err);
      toast.error(t('exportOne.failed'));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        opportunityToMarkdown(opportunity, brief, fanoutQueries, assetTypeLabel, volume),
      );
      toast.success(t('copiedToast'));
    } catch {
      toast.error(t('copyError'));
    }
  };

  return (
    // A container, so the layout follows the space it is given — the page's
    // full width or the drawer's — rather than the viewport.
    <div className="@container space-y-6">
      <div className="space-y-3">
        {/* The month's AI usage at the row's right, as on every page, also in
            the drawer, which covers the Content page's header; there it
            leaves room for the drawer's close button (top-3 right-3, 28 px).
            The banner follows the whole header block. */}
        <HeaderWithAiUsage
          banner={false}
          askChat={!inDrawer}
          className={inDrawer ? 'pr-8' : undefined}
        >
          <div className="flex items-start gap-3">
            {!inDrawer && (
              <Link href="/dashboard/content">
                <Button variant="ghost" size="icon" aria-label="Go back to content list">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight">{opportunity.title}</h1>
              {sd.alternativeOf && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-1.5 text-[10px] font-normal">
                    {t('alternative.badge')}
                  </Badge>
                  {t('alternative.of')}{' '}
                  <Link
                    href={`/dashboard/content?opportunity=${sd.alternativeOf.id}`}
                    className="text-primary hover:underline"
                  >
                    {sd.alternativeOf.title}
                  </Link>
                </p>
              )}
              {opportunity.description && (
                <p className="text-sm text-muted-foreground mt-1">{opportunity.description}</p>
              )}
            </div>
          </div>
        </HeaderWithAiUsage>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="text-xs"
            title={t(`typeHint.${opportunity.type}` as 'typeHint.owned' | 'typeHint.earned')}
          >
            {t(`type.${opportunity.type}` as 'type.owned' | 'type.earned')}
          </Badge>
          {primaryType && (
            <Badge variant="outline" className="text-xs">
              {primaryType}
            </Badge>
          )}
          <Badge variant="outline" className={cn('text-xs', IMPACT_COLORS[opportunity.impact])}>
            {t(`impact.${opportunity.impact}` as 'impact.high' | 'impact.medium' | 'impact.low')}
          </Badge>
          <Badge variant="outline" className={cn('text-xs', STATUS_COLORS[opportunity.status])}>
            {t(`status.${opportunity.status}` as `status.${typeof opportunity.status}`)}
          </Badge>
          <Badge variant="outline" className="text-xs tabular-nums">
            Score: {Math.round(opportunity.opportunityScore)}
          </Badge>
          {/* The UI's language, not the browser's: an English page showed "25 Eyl". */}
          <span
            className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
            title={suggestedDate(opportunity.createdAt, locale).full}
          >
            <Clock className="h-3.5 w-3.5" />
            {new Date(opportunity.createdAt).toLocaleDateString(locale, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>
        <OpportunityActions
          actionId={actionId ?? null}
          sendToActions={
            canSendToActionCenter
              ? {
                  sending: sendingAction === 'all',
                  disabled: sendingAction !== null,
                  onSend: guard(() => void handleSendToActionCenter(), {
                    action: tActions('sendAction'),
                  }),
                }
              : null
          }
          brief={{
            generated: !!brief,
            generating: generatingBrief,
            blockedReason: quotaExhausted ? t('briefLimitReached') : null,
            // Generating costs AI: admins and managers start it.
            onGenerate: canManage
              ? guard(() => void handleGenerateBrief(), { action: tActions('generateBrief') })
              : null,
          }}
          content={{
            draftId:
              draft?.opportunityId === opportunity.id && !draft.failed ? draft.id : undefined,
            lookupFailed: draft?.opportunityId === opportunity.id && draft.failed,
            onRetry: retryDraft,
            canStart: canWriteOpportunity(opportunity),
            onStart: guard(() => setContentPreset(opportunityStart(opportunity)), {
              action: tActions('createContent'),
            }),
            onWriteThis: guard(() => setWriteThisOpen(true), {
              action: tActions('createContent'),
            }),
            onOpenDraft: (draftId) => router.push(contentEditorPath(draftId)),
          }}
          plan={
            canManage && canWriteOpportunity(opportunity)
              ? {
                  prioritized: priority?.opportunityId === opportunity.id ? priority.on : undefined,
                  onSend: guard(() => void handleSendToPlan(), {
                    action: tActions('prioritizeContent'),
                  }),
                  onOpen: () => router.push('/dashboard/content/plan'),
                }
              : null
          }
          // Another angle is written from a cluster or a prompt; a task sent
          // from the Action Center (AC-004) has neither.
          alternative={
            canManage && opportunity.source !== 'action'
              ? {
                  running: alternativeRunning,
                  onOpen: guard(() => setAlternativeOpen(true), {
                    action: tActions('generateOpportunities'),
                  }),
                }
              : null
          }
          workflow={
            canSendToWorkflow
              ? {
                  sending,
                  sentBefore: !!opportunity.webhookSentAt,
                  onSend: guard(() => void handleSend(), { action: tActions('sendToWorkflow') }),
                }
              : null
          }
          onCopy={() => void handleCopy()}
          onExport={(format) => void handleExport(format)}
          onReviewed={
            opportunity.status === 'new'
              ? guard(() => void handleReviewed(), { action: tActions('markOpportunityReviewed') })
              : undefined
          }
          onRestore={
            opportunity.status === 'archived'
              ? guard(() => void handleRestore(), { action: tActions('restoreOpportunities') })
              : undefined
          }
          // Dismissing is for admins and managers, as the server allows it.
          onDismiss={
            canManage && opportunity.status === 'new'
              ? guard(() => setDismissOpen(true), { action: tActions('dismissOpportunities') })
              : undefined
          }
        />
      </div>
      <AiUsageBanner />

      {sd.reopened && ['new', 'reviewed'].includes(opportunity.status) && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-400">{t('newSignal')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {sd.reopened.reason === 'score_rose'
              ? t('newSignalScoreRose', {
                  from: Math.round(sd.reopened.previousScore),
                  to: Math.round(sd.reopened.score),
                })
              : t('newSignalGainLost', {
                  after: Math.round((sd.reopened.visibilityAfter ?? 0) * 10) / 10,
                  now: Math.round(sd.reopened.visibility * 10) / 10,
                })}
          </p>
        </div>
      )}

      {(sd.merged ?? []).length > 0 && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-4 py-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p>
            <span className="font-medium">
              {t('sameQuestionMerged', { count: sd.merged?.length ?? 0 })}
            </span>{' '}
            <span className="text-muted-foreground">{t('sameQuestionMergedHint')}</span>
          </p>
        </div>
      )}

      {sd.mergedInto && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-4 py-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p>
            <span className="font-medium">{t('mergedInto')}</span>{' '}
            <Link
              href={`/dashboard/content?opportunity=${sd.mergedInto}`}
              className="text-primary hover:underline"
            >
              {t('mergedIntoOpen')}
            </Link>
          </p>
        </div>
      )}

      {(sd.duplicatesMerged ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-4 py-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p>
            <span className="font-medium">
              {t('duplicatesMerged', { count: sd.duplicatesMerged ?? 0 })}
            </span>{' '}
            <span className="text-muted-foreground">{t('duplicatesMergedHint')}</span>
          </p>
        </div>
      )}

      {opportunity.clusterId && (
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-3">
          <div className="space-y-4 @5xl:col-span-2">
            {opportunity.decision && (
              <TargetPagesCard decision={opportunity.decision} sourceData={sd} />
            )}
            <AssetsCard
              sourceData={sd}
              onSend={
                canSendToActionCenter
                  ? guard(handleSendToActionCenter, { action: tActions('sendAction') })
                  : undefined
              }
              sendingKey={sendingAction}
            />
            <OpportunityBasketCard basket={basket} failed={basketFailed} />
          </div>
          <div className="space-y-4">
            {(Object.keys(sd.actions ?? {}).length > 0 || (sd.pastActions ?? []).length > 0) && (
              <OpportunityResultsCard
                actionIds={[...(sd.pastActions ?? []), ...Object.values(sd.actions ?? {})]}
              />
            )}
            <ScoreBreakdown sourceData={sd} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        {/* Sent from an Action Center task (AC-004): what the task says to do,
            where a generated one shows the data it was built from. */}
        {sd.fromAction?.task ? (
          <FromTaskCard from={sd.fromAction} />
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('detail.sourceData')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sd.promptText && !opportunity.clusterId && (
                <StatCard icon={Search} label={t('detail.relatedPrompt')} value={sd.promptText} />
              )}

              <div className="grid grid-cols-2 gap-3">
                {(sd.estAiVolume !== undefined || volume !== null) && (
                  <StatCard
                    icon={TrendingUp}
                    label={t('detail.estAiVolume')}
                    value={
                      volume === undefined ? (
                        <Skeleton className="h-6 w-24" />
                      ) : volume === null ? (
                        '—'
                      ) : (
                        // Its question's estimate, one of its prompts (questionVolume.ts).
                        <span className="flex flex-col items-start gap-1">
                          <EstimateRange estimate={volume} perMonth />
                          <EstimateBadge estimate={volume} />
                          <QuestionVolumeNote question={question} prompts={prompts} />
                        </span>
                      )
                    }
                  />
                )}
                {sd.visibilityScore !== undefined && (
                  <StatCard
                    icon={Eye}
                    label={t('detail.visibility')}
                    value={`${Math.round(sd.visibilityScore)}%`}
                  />
                )}
                {sd.competitorGap !== undefined && (
                  <StatCard
                    icon={Users}
                    label={t('detail.competitorGap')}
                    value={`${sd.competitorGap > 0 ? '+' : ''}${Math.round(sd.competitorGap)}%`}
                  />
                )}
                {sd.topCompetitorVisibility !== undefined && (
                  <StatCard
                    icon={Users}
                    label={t('detail.topCompetitor')}
                    value={`${Math.round(sd.topCompetitorVisibility)}%`}
                  />
                )}
                {sd.intent && (
                  <StatCard
                    icon={Tag}
                    label={t('detail.intent')}
                    value={INTENT_LABELS[sd.intent] || sd.intent}
                  />
                )}
              </div>

              {sd.keywords && sd.keywords.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">{t('detail.keywords')}</p>
                  <div className="flex flex-wrap gap-1">
                    {sd.keywords.map((kw) => (
                      <Badge key={kw} variant="outline" className="text-xs">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {fanoutQueries.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Observed fan-out queries</p>
                  <div className="flex flex-wrap gap-1">
                    {fanoutQueries.map((sq) => (
                      <Badge
                        key={sq.query}
                        variant="outline"
                        className="text-xs border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400 gap-1"
                        title={`Searched ${sq.timesSearched}× by answer engines`}
                      >
                        <Search className="h-2.5 w-2.5 shrink-0" />
                        {sq.query}
                        <span className="opacity-60 tabular-nums">×{sq.timesSearched}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {sd.competitorsCited && sd.competitorsCited.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    {t('detail.competitorsCited')}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {sd.competitorsCited.map((comp) => (
                      <Badge
                        key={comp}
                        variant="outline"
                        className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      >
                        {comp}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {brief ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-medium">Content Brief</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">{brief.suggestedTitle}</h3>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant="outline" className="text-xs">
                    {brief.contentType.replace(/-/g, ' ')}
                  </Badge>
                  <Badge variant="outline" className="text-xs tabular-nums">
                    ~{formatNumber(brief.targetWordCount)} words
                  </Badge>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Target className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium">Keywords</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {brief.targetKeywords.map((kw) => (
                    <Badge
                      key={kw}
                      variant="outline"
                      className="text-xs border-primary/30 bg-primary/5"
                    >
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">CTA</p>
                <p className="text-xs font-medium">{brief.callToAction}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              {quotaExhausted ? (
                <>
                  <Crown className="h-10 w-10 text-amber-500/60 mb-3" />
                  <h3 className="text-sm font-medium mb-1">Monthly Brief Limit Reached</h3>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                    You&apos;ve used all {quota.limit} content briefs included in your plan this
                    billing period. Upgrade for a higher limit, or wait until your subscription
                    renews and the quota resets.
                  </p>
                  <Link href="/dashboard/settings?tab=billing">
                    <Button className="gap-2">
                      <Crown className="h-4 w-4" />
                      Upgrade Plan
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <Sparkles className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-sm font-medium mb-1">No Content Brief Yet</h3>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                    Generate an AI-powered content brief with a suggested title, outline, target
                    keywords, and competitor insights.
                  </p>
                  {canManage ? (
                    <Button
                      onClick={guard(handleGenerateBrief, { action: tActions('generateBrief') })}
                      disabled={generatingBrief}
                      className="gap-2"
                    >
                      {generatingBrief ? <LoadingDots /> : <Sparkles className="h-4 w-4" />}
                      {generatingBrief ? 'Generating...' : 'Generate Content Brief'}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tManagers('generateBrief')}</p>
                  )}
                  {quotaLimited && (
                    <p className="text-xs text-muted-foreground mt-3 tabular-nums">
                      {noPlan
                        ? tReadOnly('noPlan')
                        : `${quota.remaining}/${quota.limit} briefs remaining this billing period`}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Full Brief Detail (shown when brief exists) */}
      {brief && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">Brief Outline</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {brief.outline.map((section, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm font-medium mb-1.5">
                    {idx + 1}. {section.heading}
                  </p>
                  <ul className="space-y-1 ml-4">
                    {section.keyPoints.map((point, pIdx) => (
                      <li key={pIdx} className="text-xs text-muted-foreground list-disc">
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Competitor Insights</p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {brief.competitorInsights}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      <AlternativeDialog
        open={alternativeOpen}
        onOpenChange={setAlternativeOpen}
        onSubmit={handleAlternative}
      />
      <DismissReasonDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        onChoose={(reason) => void handleDismiss(reason)}
      />
      <NewContentDialog
        open={contentPreset !== null}
        onOpenChange={(open) => !open && setContentPreset(null)}
        brandId={opportunity.brandId}
        siteType={siteTypeOf(opportunityBrand ?? {})}
        preset={contentPreset}
      />
      <WriteThisDialog
        // With a brief generated here meanwhile: its suggested title names the page.
        opportunity={writeThisOpen ? { ...opportunity, brief: brief ?? opportunity.brief } : null}
        onOpenChange={setWriteThisOpen}
        siteType={siteTypeOf(opportunityBrand ?? {})}
      />
    </div>
  );
}

/** The Action Center task an opportunity was sent from (AC-004): where, why, how, done when. */
function FromTaskCard({
  from,
}: {
  from: NonNullable<ContentOpportunity['sourceData']['fromAction']>;
}) {
  const t = useTranslations('content.detail.fromTask');
  const task = from.task ?? {};
  const effort = [task.effort, task.role].filter(Boolean).join(' · ');
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {from.actionNo !== null ? t('title', { ref: `AC-${from.actionNo}` }) : t('titleNoRef')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {task.url && (
            <>
              <dt className="text-muted-foreground">{t('url')}</dt>
              <dd className="min-w-0 break-words">{task.url}</dd>
            </>
          )}
          {task.where && (
            <>
              <dt className="text-muted-foreground">{t('where')}</dt>
              <dd className="min-w-0 break-words">{task.where}</dd>
            </>
          )}
          {task.why && (
            <>
              <dt className="text-muted-foreground">{t('why')}</dt>
              <dd className="min-w-0 break-words">{task.why}</dd>
            </>
          )}
          {task.change && (
            <>
              <dt className="text-muted-foreground">{t('change')}</dt>
              <dd className="min-w-0 break-words">
                {task.change.before ? (
                  <>
                    <span className="text-muted-foreground">{t('changeBefore')}: </span>
                    {task.change.before}
                    <br />
                    <span className="text-muted-foreground">{t('changeAfter')}: </span>
                    {task.change.after}
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">{t('changeAdd')}: </span>
                    {task.change.after}
                  </>
                )}
              </dd>
            </>
          )}
          {task.how && task.how.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t('how')}</dt>
              <dd>
                <ol className="list-decimal space-y-0.5 pl-4">
                  {task.how.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </dd>
            </>
          )}
          {task.doneWhen && (
            <>
              <dt className="text-muted-foreground">{t('doneWhen')}</dt>
              <dd className="min-w-0 break-words">{task.doneWhen}</dd>
            </>
          )}
          {effort && (
            <>
              <dt className="text-muted-foreground">{t('effort')}</dt>
              <dd>{effort}</dd>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
