'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { addDraftPrompts, getDraftSources, rebuildDraftBrief } from '@/lib/actions/contentDrafts';
import { builtFromCount, rebuildSources, type DraftBrief } from '@/lib/content/brief';
import type { AgentRule } from '@/lib/content/agentWrite';
import type { ContentDraft } from '@/lib/content/drafts';
import type { DraftSourceChoice, DraftSourcesData } from '@/lib/content/sources';
import type { SourcesRead } from './_useDraftReads';

/** The page as written now: a rebuild reads its headings and length. */
export interface PageNow {
  title: string;
  html: string;
  /** The length the rules ask for. */
  length: number;
  /** The rules in effect, as the agent reads them: the brief plans to them. */
  rules?: AgentRule[];
}

/**
 * Rebuild outline (CE-007), from the Brief tab, Sources' "Rebuild with
 * selection" or Impact's "Use lost prompts": the sources kept (as the
 * editor has them, or read afresh once prompts were added), the page as
 * written now, and the brief the server writes from them, metered from the
 * AI usage budget. `onServer` is on once that write is the server's: before
 * it, the browser still adds the prompts and reads the sources.
 */
export function useBriefRebuild({
  draft,
  pageNow,
  sourcesNow,
  onSourcesRead,
  onRebuilt,
}: {
  draft: ContentDraft;
  pageNow: () => PageNow;
  /** The sources as the editor has them; null until read. */
  sourcesNow: () => SourcesRead | null;
  /** The sources read afresh once prompts were added: the editor's copy, so they aren't read again. */
  onSourcesRead: (read: SourcesRead) => void;
  onRebuilt: (brief: DraftBrief) => void;
}) {
  const t = useTranslations('contentEditor.editor.brief');
  const tCard = useTranslations('contentEditor.editor.agentCard');
  const [rebuilding, setRebuilding] = useState(false);
  // The brief is the server's to write now: the page can be left (Chat on).
  const [onServer, setOnServer] = useState(false);
  // A read-only workspace (plan not active): each way in (Brief, Sources,
  // Impact, Next step's Build brief) opens the upgrade dialog instead.
  const { isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const rebuild = async (
    options: {
      sources?: { data: DraftSourcesData; choices: DraftSourceChoice[] };
      addPrompts?: string[];
    } = {},
  ): Promise<boolean> => {
    if (isLocked) {
      openUpgrade(tActions('buildBrief'));
      return false;
    }
    setRebuilding(true);
    try {
      const added = !!options.addPrompts?.length;
      if (added) await addDraftPrompts(draft.id, options.addPrompts!);
      // Prompts just added aren't in the sources in hand: those are read
      // afresh, and the fresh read becomes the editor's.
      const inHand = added ? null : sourcesNow();
      let read: { data: DraftSourcesData; choices: DraftSourceChoice[] } | null =
        options.sources ?? (inHand && !inHand.failed ? inHand : null);
      if (!read) {
        read = await getDraftSources(draft.id);
        if (added) {
          onSourcesRead(
            read
              ? { data: read.data, choices: read.choices, failed: false }
              : { data: null, choices: [], failed: true },
          );
        }
      }
      if (!read) throw new Error('not_found');
      const page = pageNow();
      setOnServer(true);
      const result = await rebuildDraftBrief(
        draft.id,
        draft.brandId,
        rebuildSources(read.data, read.choices, {
          title: page.title,
          sourceUrl: draft.sourceUrl,
          html: page.html,
          length: page.length,
        }),
        page.rules,
      );
      if ('error' in result) {
        // Stopped from the agent card (CE-027): no failure, nothing changed.
        if (result.error === 'stopped') toast(tCard('stopped'));
        else toast.error(t(`rebuildErrors.${result.error}`));
        return false;
      }
      toast.success(t('rebuilt', { count: builtFromCount(result.brief) }));
      onRebuilt(result.brief);
      return true;
    } catch (err) {
      console.error('Failed to rebuild the brief:', err);
      toast.error(t('rebuildErrors.failed'));
      return false;
    } finally {
      setRebuilding(false);
      setOnServer(false);
    }
  };

  return { rebuilding, onServer, rebuild };
}
