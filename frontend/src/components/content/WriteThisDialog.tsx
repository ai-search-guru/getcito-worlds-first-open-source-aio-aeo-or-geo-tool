'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import {
  createContentDraft,
  importContentPage,
  startAgentWriting,
} from '@/lib/actions/contentDrafts';
import { percentLabel } from '@/lib/billing/aiUsage';
import { agentWriteRequest, useRuleDescriber } from '@/lib/content/agentWrite';
import { cleanHtml } from '@/lib/content/cleanHtml';
import { contentEditorPath } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';
import type { SiteType } from '@/lib/content/pageTypes';
import { startingRules } from '@/lib/content/rules';
import { writeThisPrompts, writeThisStart } from '@/lib/content/writeThis';
import { useBrandStore } from '@/state/useBrandStore';
import type { ContentOpportunity } from '@/types';

/**
 * Write this (customer priorities item 9): an opportunity to a page to
 * review in one go. The dialog says what happens (the brief, the page from
 * it, the person's review) and what it takes of the month's AI usage; Write
 * this starts the draft as Start would, and the Content Agent builds the
 * brief and writes from it in one run (contentWriter.js briefThenWrite),
 * while the editor shows it at work. An opportunity on an existing page has
 * that page read first, and the agent leaves suggestions on it.
 */
export function WriteThisDialog({
  opportunity,
  onOpenChange,
  siteType,
}: {
  /** The opportunity to write for; null when closed. */
  opportunity: ContentOpportunity | null;
  onOpenChange: (open: boolean) => void;
  siteType: SiteType;
}) {
  const t = useTranslations('content.writeThis');
  const tStart = useTranslations('contentEditor.newContent.start');
  const router = useRouter();
  const describeRule = useRuleDescriber();
  const { usage } = useAiUsage();
  const brandId = opportunity?.brandId;
  // The Language rule's default for the agent: the brand's language.
  const language = useBrandStore((s) => s.brands.find((b) => b.id === brandId)?.language);
  const [starting, setStarting] = useState(false);

  const start = opportunity ? writeThisStart(opportunity, siteType) : null;
  const prompts = opportunity ? writeThisPrompts(opportunity) : null;
  const estimate = usage && !usage.unlimited ? usage.estimates?.writeThis : undefined;

  const close = (open: boolean) => {
    if (!starting) onOpenChange(open);
  };

  const write = async () => {
    if (!opportunity || !start || !brandId) return;
    setStarting(true);
    let id: string;
    let bodyHtml: string | undefined;
    try {
      // An existing page is read first: the agent's suggestions are on its live text.
      if (start.page) {
        const read = await importContentPage(brandId, start.page.url);
        if (!('page' in read)) {
          toast.error(t('pageUnread', { page: pagePath(start.page.url) }));
          setStarting(false);
          return;
        }
        bodyHtml = cleanHtml(read.page.html, { keepImages: true }).html;
      }
      id = await createContentDraft(brandId, {
        method: start.method,
        title: start.title,
        pageType: start.pageType,
        typePicked: false,
        source: { kind: 'opportunity', id: opportunity.id },
        bodyHtml,
        sourceUrl: start.page?.url,
      });
    } catch (err) {
      console.error('Failed to start a draft for Write this:', err);
      toast.error(tStart('failed'));
      setStarting(false);
      return;
    }
    const openDraft = {
      label: tStart('openDraft'),
      onClick: () => router.push(contentEditorPath(id)),
    };
    let started: Awaited<ReturnType<typeof startAgentWriting>>;
    try {
      const request = await agentWriteRequest(
        {
          id,
          brandId,
          title: start.title,
          pageType: start.pageType,
          method: start.method,
          sourceUrl: start.page?.url ?? null,
          bodyHtml: bodyHtml ?? '',
          rules: startingRules(start.method, bodyHtml),
          language,
        },
        describeRule,
      );
      started = await startAgentWriting(id, brandId, { ...request, buildBrief: true });
    } catch (err) {
      console.error('Failed to hand Write this to the Content Agent:', err);
      started = { error: 'failed' };
    }
    if ('error' in started) {
      // The draft stays in the Library, to open and start again.
      setStarting(false);
      onOpenChange(false);
      toast.error(tStart(`agentErrors.${started.error}`), { action: openDraft });
      return;
    }
    // As Start's Agent: the dialog stays busy until the editor shows the agent at work.
    router.push(contentEditorPath(id));
  };

  const steps = start
    ? [
        {
          key: 'brief',
          detail:
            prompts !== null
              ? t('steps.briefDetail', { count: prompts })
              : t('steps.briefDetailAny'),
        },
        {
          key: 'draft',
          detail: start.page
            ? t('steps.draftDetailPage', { page: pagePath(start.page.url) })
            : t('steps.draftDetail'),
        },
        { key: 'review', detail: t('steps.reviewDetail') },
      ]
    : [];

  return (
    <Dialog open={opportunity !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {opportunity?.title}
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step.key} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{t(`steps.${step.key}`)}</p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {estimate !== undefined && usage && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t.rich(estimate >= 1 ? 'usage' : 'usageSmall', {
              estimate: `${Math.round(estimate)}%`,
              used: percentLabel(usage.percentUsed ?? 0),
              trial: usage.trial ? 'yes' : 'no',
              b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
            })}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={starting} onClick={() => close(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={starting || !start} onClick={() => void write()} className="gap-2">
            {starting && <LoadingDots />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
