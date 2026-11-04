'use client';

import { useTranslations } from 'next-intl';
import {
  ExternalLink,
  FilePen,
  FileText,
  ListChecks,
  ListPlus,
  MoreHorizontal,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingDots } from '@/components/ui/loading-dots';

/**
 * An Opportunities list row's actions, in one "…" menu as the panel keeps
 * its own (the user's spec): Write this and Send to Editor (Open draft once
 * one is being written), Send to Plan (Open in Plan once it is a priority
 * there), Send to Workflow, the full page in a new tab, and Dismiss.
 */
export function OpportunityRowMenu({
  title,
  editor,
  plan,
  workflow,
  pageHref,
  onDismiss,
}: {
  /** The opportunity's title, naming the menu for screen readers. */
  title: string;
  /**
   * The draft written for it (undefined while looked up), or Start for one
   * when `canStart`. A lookup that failed offers to check again instead of
   * Start, so it never turns into a second draft.
   */
  editor: {
    draftId: string | null | undefined;
    lookupFailed?: boolean;
    onRetry?: () => void;
    canStart: boolean;
    onStart: () => void;
    /** Write this (customer priorities item 9): the brief and the page in one go, beside Start. */
    onWriteThis?: () => void;
    onOpenDraft: (draftId: string) => void;
  };
  /** Its Plan row's priority mark (undefined while looked up); null when not offered. */
  plan: { prioritized: boolean | undefined; onSend: () => void; onOpen: () => void } | null;
  /** The CMS webhook; null when not offered. */
  workflow: { sending: boolean; onSend: () => void } | null;
  pageHref: string;
  onDismiss?: () => void;
}) {
  const t = useTranslations('content');
  const draftId = editor.draftId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={t('rowActions', { title })}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {editor.lookupFailed ? (
          <DropdownMenuItem className="gap-2" onClick={editor.onRetry}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t('draftCheckFailed')}
          </DropdownMenuItem>
        ) : draftId ? (
          <DropdownMenuItem className="gap-2" onClick={() => editor.onOpenDraft(draftId)}>
            <FileText className="h-3.5 w-3.5" />
            {t('openDraft')}
          </DropdownMenuItem>
        ) : (
          editor.canStart && (
            <>
              {editor.onWriteThis && (
                <>
                  <DropdownMenuItem
                    className="items-start gap-2"
                    onClick={editor.onWriteThis}
                    disabled={draftId === undefined}
                  >
                    {draftId === undefined ? (
                      <LoadingDots />
                    ) : (
                      <Sparkles className="mt-0.5 h-3.5 w-3.5" />
                    )}
                    <span className="flex flex-col">
                      {t('writeThis.menu')}
                      <span className="text-[11px] text-muted-foreground">
                        {t('writeThis.menuHint')}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="gap-2"
                onClick={editor.onStart}
                disabled={draftId === undefined}
              >
                {draftId === undefined ? <LoadingDots /> : <FilePen className="h-3.5 w-3.5" />}
                {t('sendToEditor')}
              </DropdownMenuItem>
            </>
          )
        )}
        {plan && (
          <DropdownMenuItem
            className="gap-2"
            onClick={plan.prioritized ? plan.onOpen : plan.onSend}
            disabled={plan.prioritized === undefined}
          >
            {plan.prioritized === undefined ? (
              <LoadingDots />
            ) : plan.prioritized ? (
              <ListChecks className="h-3.5 w-3.5" />
            ) : (
              <ListPlus className="h-3.5 w-3.5" />
            )}
            {plan.prioritized ? t('openInPlan') : t('sendToPlan')}
          </DropdownMenuItem>
        )}
        {workflow && (
          <DropdownMenuItem className="gap-2" onClick={workflow.onSend} disabled={workflow.sending}>
            {workflow.sending ? <LoadingDots /> : <Send className="h-3.5 w-3.5" />}
            {t('sendToWorkflow')}
          </DropdownMenuItem>
        )}
        {/* The full page, in a new tab so the list stays put. */}
        <DropdownMenuItem
          className="gap-2"
          render={<Link href={pageHref} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('openInNewTab')}
        </DropdownMenuItem>
        {onDismiss && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" variant="destructive" onClick={onDismiss}>
              <X className="h-3.5 w-3.5" />
              {t('dismiss')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
