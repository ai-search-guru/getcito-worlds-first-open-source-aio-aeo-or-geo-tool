'use client';

import { useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Bot, History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingDots } from '@/components/ui/loading-dots';
import { getDraftHandoffs, getDraftVersions } from '@/lib/actions/contentDrafts';
import { HISTORY_DAYS, type DraftHandOff, type DraftVersion } from '@/lib/content/history';

/**
 * History in the editor's header (CE-018): the draft now, then its earlier
 * versions with their time and origin, read each time the menu opens. Picking
 * one restores it; the page it replaces is kept as a version too. Its
 * hand-offs to the Content Agent (Quality CE-051) are listed among them by
 * time, with nothing to restore: their changes were suggestions.
 */
export function HistoryMenu({
  draftId,
  disabled,
  onRestore,
  'aria-describedby': describedBy,
}: {
  draftId: string;
  /** The header's hint for it (HeaderTip). */
  'aria-describedby'?: string;
  /** Why it can't open now (the HTML view is open), or null. */
  disabled: string | null;
  onRestore: (version: DraftVersion, label: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.history');
  const format = useFormatter();
  const now = useNow();
  const [versions, setVersions] = useState<DraftVersion[] | 'loading' | 'failed'>('loading');
  const [handOffs, setHandOffs] = useState<DraftHandOff[]>([]);

  const load = () => {
    setVersions('loading');
    setHandOffs([]);
    getDraftVersions(draftId)
      .then(setVersions)
      .catch((err) => {
        console.error('Failed to read the draft history:', err);
        setVersions('failed');
      });
    // The versions are History; the hand-offs only add to it.
    getDraftHandoffs(draftId)
      .then(setHandOffs)
      .catch((err) => console.error('Failed to read the hand-offs:', err));
  };
  // Versions and hand-offs, the latest first.
  const rows =
    versions === 'loading' || versions === 'failed'
      ? []
      : [
          ...versions.map((version) => ({ at: version.createdAt, version, handOff: null })),
          ...handOffs.map((handOff) => ({ at: handOff.startedAt, version: null, handOff })),
        ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  /** "Today 10:42", or "Oct 12, 10:42". */
  const when = (iso: string) => {
    const date = new Date(iso);
    const time = format.dateTime(date, { hour: 'numeric', minute: '2-digit' });
    return date.toDateString() === now.toDateString()
      ? t('today', { time })
      : format.dateTime(date, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon-sm" />}
        disabled={disabled !== null}
        // The header shows its label and hint on hover and focus; why it waits, here.
        title={disabled ?? undefined}
        aria-label={t('button')}
        aria-describedby={describedBy}
      >
        <History className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('title')}{' '}
            <span className="font-normal text-muted-foreground">
              · {t('kept', { days: HISTORY_DAYS })}
            </span>
          </DropdownMenuLabel>
          <div className="rounded-md bg-muted/60 px-1.5 py-1.5">
            <p className="text-sm font-medium">{t('now')}</p>
            <p className="text-xs text-muted-foreground">{t('nowNote')}</p>
          </div>
          {versions === 'loading' ? (
            <p className="flex items-center gap-2 px-1.5 py-2 text-xs text-muted-foreground">
              <LoadingDots />
              {t('loading')}
            </p>
          ) : versions === 'failed' ? (
            <p className="px-1.5 py-2 text-xs text-destructive">{t('failed')}</p>
          ) : rows.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            rows.map(({ version, handOff }) => {
              if (handOff) {
                return (
                  <div key={handOff.id} className="flex items-start gap-2 px-1.5 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {t(`handOff.${handOff.origin}`)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {when(handOff.startedAt)} ·{' '}
                        {t(
                          `handOff.note.${handOff.changes === 0 ? 'none' : (handOff.outcome ?? 'running')}`,
                          { count: handOff.checks ?? 0 },
                        )}
                      </span>
                    </span>
                    <Bot className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  </div>
                );
              }
              if (!version) return null;
              const label = t(`origin.${version.origin}`);
              return (
                <DropdownMenuItem
                  key={version.id}
                  onClick={() => onRestore(version, label)}
                  aria-label={t('restoreLabel', { version: label, when: when(version.createdAt) })}
                  className="items-start"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {when(version.createdAt)} · {t(`note.${version.origin}`)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <RotateCcw className="h-3 w-3" />
                    {t('restore')}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">{t('footer')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
