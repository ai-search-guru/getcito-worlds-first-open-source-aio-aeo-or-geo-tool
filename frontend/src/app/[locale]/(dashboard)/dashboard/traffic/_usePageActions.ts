'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFailureToast } from '@/hooks/useFailureToast';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { useRecentAudit } from '@/components/audit/useRecentAudit';
import { getAuditQuota, runAuditsBulk, type AuditQuota } from '@/lib/actions/audits';
import { isNoPlan } from '@/lib/billing/noPlan';
import { generateOpportunitiesOnDemand, getGenerationJobStatus } from '@/lib/actions/content';
import { suggestForPage } from '@/lib/contentJob';
import {
  sendTrafficPagesToActionCenter,
  type TrafficDateWindow,
  type TrafficPagesReason,
} from '@/lib/actions/traffic';

/** The most pages one action, or one bulk audit, takes. */
export const PAGE_ACTION_MAX = 50;

/** The server calls behind a page's "Suggest content" (part B3). */
const SUGGEST_CALLS = { start: generateOpportunitiesOnDemand, getStatus: getGenerationJobStatus };

/**
 * The Pages section's actions (AT-006 part B), shared by its rows and its
 * footer: send pages to the Action Center as one action, audit several
 * pages at once within the month's audits, and suggest content for a page
 * (part B3, one of the month's content suggestions). Each reports how it went
 * in a toast that opens what it made. On a read-only workspace (plan not
 * active) each opens the upgrade dialog instead.
 */
export function usePageActions(brandId: string, dateWindow: TrafficDateWindow) {
  const t = useTranslations('traffic.pageList.actions');
  const failureToast = useFailureToast();
  const router = useRouter();
  const { saySkipped } = useRecentAudit();
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [sending, setSending] = useState(false);
  const [auditing, setAuditing] = useState(false);
  // The page whose content suggestion is being written.
  const [suggesting, setSuggesting] = useState<string | null>(null);
  // The organization's audits this month, for the bulk audit's limit.
  const [quota, setQuota] = useState<AuditQuota | null>(null);

  const loadQuota = useCallback(() => {
    getAuditQuota()
      .then(setQuota)
      // Unknown: the server still refuses audits over the limit.
      .catch(() => setQuota(null));
  }, []);
  useEffect(loadQuota, [loadQuota]);

  const send = useCallback(
    async (pages: string[], reason: TrafficPagesReason): Promise<boolean> => {
      const sent = pages.slice(0, PAGE_ACTION_MAX);
      if (sent.length === 0) return false;
      setSending(true);
      const toastId = toast.loading(t('sending'));
      try {
        const result = await sendTrafficPagesToActionCenter(brandId, dateWindow, sent, reason);
        if ('error' in result) {
          toast.error(t('sendFailed'), { id: toastId, description: result.error });
          return false;
        }
        const open = {
          label: t('open'),
          onClick: () => router.push(`/dashboard/action-center/actions?action=${result.actionId}`),
        };
        if (result.created) {
          toast.success(t('sent'), {
            id: toastId,
            description: t('sentDescription', { number: result.actionNo, count: sent.length }),
            duration: 10_000,
            action: open,
          });
        } else {
          toast.info(t('alreadySent'), {
            id: toastId,
            description: t('alreadySentDescription', { number: result.actionNo }),
            duration: 10_000,
            action: open,
          });
        }
        return true;
      } catch {
        toast.error(t('sendFailed'), { id: toastId });
        return false;
      } finally {
        setSending(false);
      }
    },
    [brandId, dateWindow, router, t],
  );

  const auditMany = useCallback(
    (urls: string[]): Promise<boolean> => {
      const start = async (pages: string[], force: boolean): Promise<boolean> => {
        if (pages.length === 0) return false;
        setAuditing(true);
        const toastId = toast.loading(t('auditing'));
        try {
          const chunk = pages.slice(0, PAGE_ACTION_MAX);
          const { started, recent } = force
            ? await runAuditsBulk(brandId, chunk, { force: true })
            : await runAuditsBulk(brandId, chunk);
          if (started > 0) {
            toast.success(t('auditsStarted', { count: started }), {
              id: toastId,
              description: t('auditsStartedDescription'),
              duration: 10_000,
              action: { label: t('openAudit'), onClick: () => router.push('/dashboard/audit') },
            });
          } else {
            toast.dismiss(toastId);
          }
          // Pages audited minutes ago aren't started: said so, with Audit again.
          saySkipped(recent, () => {
            void start(
              recent.flatMap((r) => (r.url ? [r.url] : [])),
              true,
            );
          });
          return true;
        } catch (err) {
          toast.error(t('auditsFailed'), {
            id: toastId,
            description: err instanceof Error ? err.message : undefined,
          });
          return false;
        } finally {
          setAuditing(false);
          loadQuota();
        }
      };
      return start(urls, false);
    },
    [brandId, loadQuota, router, saySkipped, t],
  );

  /**
   * Writes a content suggestion for one page, from the tracked prompts about
   * it. With none, it offers to add prompts for the page (`onAddPrompts`).
   */
  const suggestContent = useCallback(
    async (page: string, onAddPrompts: (page: string) => void): Promise<void> => {
      setSuggesting(page);
      const toastId = toast.loading(t('suggesting', { page }));
      const openOpportunity = (id: string, label: string) => ({
        label,
        onClick: () => router.push(`/dashboard/content?opportunity=${id}`),
      });
      try {
        const outcome = await suggestForPage(brandId, page, SUGGEST_CALLS);
        switch (outcome.kind) {
          case 'created':
            toast.success(t('suggested'), {
              id: toastId,
              description: t('suggestedDescription', { page }),
              duration: 10_000,
              action: openOpportunity(outcome.opportunityId, t('open')),
            });
            break;
          case 'existing':
            toast.info(t('suggestionExists'), {
              id: toastId,
              duration: 10_000,
              action: openOpportunity(outcome.opportunityId, t('openExisting')),
            });
            break;
          case 'noMatch':
            toast.info(t('suggestNoPrompts', { page }), {
              id: toastId,
              description: t('suggestNoPromptsDescription'),
              duration: 10_000,
              action: { label: t('addPrompts'), onClick: () => onAddPrompts(page) },
            });
            break;
          case 'limited':
            toast.error(t('suggestLimited'), { id: toastId });
            break;
          case 'nothing':
            toast.info(t('suggestNothing'), {
              id: toastId,
              description: t('suggestNothingDescription'),
            });
            break;
          case 'timeout':
            toast.info(t('suggestTimeout'), {
              id: toastId,
              description: t('suggestTimeoutDescription'),
            });
            break;
          default:
            // A reason the API gave, in plain words (BUG-001); else what went wrong.
            if (outcome.failure && outcome.failure !== 'failed') {
              failureToast(outcome.failure, { id: toastId });
              break;
            }
            toast.error(t('suggestFailed'), {
              id: toastId,
              description: outcome.message ?? undefined,
            });
        }
      } finally {
        setSuggesting(null);
      }
    },
    [brandId, failureToast, router, t],
  );

  return {
    send: guard(send, { action: tActions('sendAction') }),
    sending,
    auditMany: guard(auditMany, { action: tActions('auditPages') }),
    auditing,
    quota,
    suggestContent: guard(suggestContent, { action: tActions('suggestContent') }),
    suggesting,
  };
}

/**
 * Why a bulk audit of `count` pages can't start, or null when it can: the
 * month's audits are spent, or fewer are left than pages (the server starts
 * all of them or none). An unknown or unlimited quota never blocks, nor one
 * read without an active plan (0 of 0, or a read-only workspace: `isLocked`):
 * Audit opens the plan dialog.
 */
export function auditBlock(
  quota: AuditQuota | null,
  count: number,
  isLocked = false,
): { reason: 'noneLeft' } | { reason: 'overQuota'; remaining: number } | null {
  if (!quota || quota.limit === -1 || isNoPlan(quota, isLocked)) return null;
  const remaining = Math.max(0, quota.remaining);
  if (remaining === 0) return { reason: 'noneLeft' };
  if (count > remaining) return { reason: 'overQuota', remaining };
  return null;
}
