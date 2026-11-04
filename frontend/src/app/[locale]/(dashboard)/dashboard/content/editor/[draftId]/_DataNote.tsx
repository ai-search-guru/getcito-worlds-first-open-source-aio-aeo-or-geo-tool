'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Database, X } from 'lucide-react';
import type { DraftSourceKind } from '@/lib/content/sources';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/useAuthStore';

/**
 * Where a person's dismissal of the data note is kept: in their own user
 * metadata, so it holds on every device and never shows them again.
 */
export const DATA_NOTE_KEY = 'content_agent_data_note_dismissed';

/**
 * "Uses your data" (Content Editor v1.1 §3b, CE-032): under each Run Agent
 * card, the sources the agent writes from, counted as the Sources tab keeps
 * them, so turning one off there lowers the count at once. Edit sources
 * opens that tab.
 */
export function UsesYourData({
  counts,
  onEdit,
}: {
  counts: Record<DraftSourceKind, number>;
  onEdit: () => void;
}) {
  const t = useTranslations('contentEditor.editor.data');
  const tSources = useTranslations('contentEditor.editor.sources');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const edit = (chunks: React.ReactNode) => (
    <button
      type="button"
      onClick={onEdit}
      className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {chunks}
    </button>
  );
  return (
    <p className="text-xs text-muted-foreground">
      {total > 0
        ? t.rich('uses', {
            parts: tSources('summaryParts', {
              prompts: counts.prompt,
              fanouts: counts.fanout,
              pages: counts.cited_page,
              queries: counts.gsc_query,
            }),
            edit,
          })
        : t.rich('none', { edit })}
    </p>
  );
}

/**
 * The first visit's note at the top of Instructions (CE-032): the Content
 * Agent writes from the person's own data. Shown until they close it.
 */
export function DataNote() {
  const t = useTranslations('contentEditor.editor.data.note');
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [closed, setClosed] = useState(false);
  // Until the person is known, nothing: never a note that flashes and goes.
  if (!user || closed || user.user_metadata?.[DATA_NOTE_KEY]) return null;

  const close = async () => {
    setClosed(true);
    try {
      const { data, error } = await createClient().auth.updateUser({
        data: { [DATA_NOTE_KEY]: true },
      });
      if (error) throw error;
      if (data.user) setUser(data.user);
    } catch (err) {
      // It shows again on the next visit; nothing else is lost.
      console.error('Failed to keep the data note closed:', err);
    }
  };

  return (
    <section
      aria-label={t('title')}
      className="relative flex gap-2.5 rounded-xl border bg-muted/50 px-3 py-2.5 text-xs"
    >
      <Database aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5 pr-5">
        <p className="text-[13px] font-semibold">{t('title')}</p>
        <p className="text-muted-foreground">{t('body')}</p>
      </div>
      <button
        type="button"
        aria-label={t('close')}
        onClick={() => void close()}
        className="absolute top-2 right-2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
