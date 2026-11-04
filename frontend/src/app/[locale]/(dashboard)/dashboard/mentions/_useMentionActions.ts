'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useFailureToast } from '@/hooks/useFailureToast';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useRouter } from '@/i18n/navigation';
import { getGenerationJobStatus, suggestContentForPrompt } from '@/lib/actions/content';
import { sendMentionsToActionCenter } from '@/lib/actions/mentions';
import { suggestForPrompt } from '@/lib/contentJob';
import type { MentionRow } from '@/lib/mentionsList';

/** The server calls behind "Suggest content", as on the Prompts page (PROMPT-006). */
const SUGGEST_CALLS = { start: suggestContentForPrompt, getStatus: getGenerationJobStatus };

/**
 * The Mentions tab's actions (MS-08), shared by the response drawer and the
 * table's selection bar: send answers to the Action Center as one action,
 * and suggest content for an answer's prompt. Each reports how it went in a
 * toast that opens what it made. On a read-only workspace (plan not active)
 * both open the upgrade dialog instead.
 */
export function useMentionActions(brandId: string) {
  const t = useTranslations('mentions.actions');
  const router = useRouter();
  const failureToast = useFailureToast();
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState<string | null>(null);

  const send = useCallback(
    async (rows: MentionRow[]): Promise<boolean> => {
      if (rows.length === 0) return false;
      setSending(true);
      const toastId = toast.loading(t('sending'));
      try {
        const result = await sendMentionsToActionCenter(
          brandId,
          rows.map((r) => ({ id: r.id, excerpt: r.excerpt })),
        );
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
            description: t('sentDescription', { number: result.actionNo, count: rows.length }),
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
    [brandId, router, t],
  );

  const suggest = useCallback(
    async (row: MentionRow) => {
      setSuggesting(row.promptId);
      const toastId = toast.loading(t('suggesting'), { description: row.promptText });
      const outcome = await suggestForPrompt(row.promptId, SUGGEST_CALLS);
      setSuggesting(null);
      const openOpportunity = (id: string) => () =>
        router.push(`/dashboard/content?opportunity=${id}`);
      switch (outcome.kind) {
        case 'created':
          toast.success(t('suggested'), {
            id: toastId,
            description: row.promptText,
            duration: 10_000,
            action: { label: t('open'), onClick: openOpportunity(outcome.opportunityId) },
          });
          break;
        case 'existing':
          toast.info(t('suggestionExists'), {
            id: toastId,
            description: row.promptText,
            duration: 10_000,
            action: { label: t('openExisting'), onClick: openOpportunity(outcome.opportunityId) },
          });
          break;
        case 'limited':
          toast.error(t('suggestLimited'), { id: toastId, description: row.promptText });
          break;
        case 'nothing':
          toast.info(t('suggestNothing'), {
            id: toastId,
            description: t('suggestNothingDescription'),
          });
          break;
        case 'failed':
          // A reason the API gave, in plain words (BUG-001); else what went wrong.
          if (outcome.failure && outcome.failure !== 'failed') {
            failureToast(outcome.failure, { id: toastId, description: row.promptText });
            break;
          }
          toast.error(t('suggestFailed'), {
            id: toastId,
            description: outcome.message ?? undefined,
          });
          break;
        case 'timeout':
          toast.info(t('suggestTimeout'), {
            id: toastId,
            description: t('suggestTimeoutDescription'),
          });
          break;
      }
    },
    [failureToast, router, t],
  );

  return {
    send: guard(send, { action: tActions('sendAction') }),
    sending,
    suggest: guard(suggest, { action: tActions('suggestContent') }),
    suggesting,
  };
}
