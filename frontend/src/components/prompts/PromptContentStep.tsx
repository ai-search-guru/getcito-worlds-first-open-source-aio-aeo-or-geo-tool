'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FilePen, FilePlus, FileText, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { DialogPreset } from '@/components/content/NewContentDialog';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { getDraftForPrompt } from '@/lib/actions/contentDrafts';
import { contentEditorPath } from '@/lib/content/drafts';
import { contentStep } from '@/lib/promptContent';
import type { CitedPage, PositionsSummary } from '@/lib/promptPositions';

/**
 * The Improve tab's way into the Content Editor: whether this prompt calls
 * for content in the panel's period (lib/promptContent.ts), and Start for
 * it, a new page or the page AI cites for it to optimize. A draft already
 * being written for the prompt opens instead of a second one.
 */
export function PromptContentStep({
  brandId,
  prompt,
  summary,
  citedPage,
  onStart,
  recheck = 0,
}: {
  brandId: string;
  prompt: { id: string; text: string };
  summary: PositionsSummary;
  citedPage: CitedPage | null;
  onStart: (preset: DialogPreset) => void;
  /**
   * Changes when Start sent a draft to the Agent or the Team and the panel
   * stayed open: the lookup runs again, so the step offers Open draft rather
   * than a second draft.
   */
  recheck?: number;
}) {
  const t = useTranslations('prompts.content');
  const router = useRouter();
  // A read-only workspace (plan not active): Create or Optimize content opens
  // the upgrade dialog instead; Open draft stays open.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const step = contentStep(summary);
  const wanted = step !== null;
  // The draft lookup for this prompt: undefined while it runs.
  const [draft, setDraft] = useState<{ promptId: string; id: string | null } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    getDraftForPrompt(brandId, prompt.id).then(
      (id) => !cancelled && setDraft({ promptId: prompt.id, id }),
      () => !cancelled && setDraft({ promptId: prompt.id, id: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [brandId, prompt.id, wanted, recheck]);

  if (!step) return null;
  const draftId = draft?.promptId === prompt.id ? draft.id : undefined;
  const page = citedPage ? (citedPage.title ?? pathOf(citedPage.url)) : null;
  const start = () =>
    onStart(
      step.kind === 'create'
        ? { kind: 'prompt', id: prompt.id, text: prompt.text, method: 'create' }
        : {
            kind: 'prompt',
            id: prompt.id,
            text: prompt.text,
            method: 'optimize',
            page: citedPage ? { url: citedPage.url, title: citedPage.title } : null,
          },
    );

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">
          {step.kind === 'create'
            ? t('createTitle')
            : step.reason === 'rare'
              ? t('rareTitle', { pct: step.mentionPct })
              : t('lateTitle', { position: step.position })}
        </p>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {draftId
            ? t('draftNote')
            : step.kind === 'create'
              ? t('createBody', { answers: step.answers })
              : page
                ? t('optimizePage', { page })
                : t('optimizePick')}
        </p>
      </div>
      {draftId ? (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => router.push(contentEditorPath(draftId))}
        >
          <FileText className="h-3.5 w-3.5" />
          {t('openDraft')}
        </Button>
      ) : (
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={draftId === undefined}
          onClick={guard(start, {
            action: tActions(step.kind === 'create' ? 'createContent' : 'optimizeContent'),
          })}
        >
          {draftId === undefined ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : step.kind === 'create' ? (
            <FilePlus className="h-3.5 w-3.5" />
          ) : (
            <FilePen className="h-3.5 w-3.5" />
          )}
          {step.kind === 'create' ? t('create') : t('optimize')}
        </Button>
      )}
    </div>
  );
}

/** "https://acme.example/guides/x?y" → "/guides/x". */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}
