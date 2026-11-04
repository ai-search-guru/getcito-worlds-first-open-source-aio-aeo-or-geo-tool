'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { overrideMentionSentiment } from '@/lib/actions/mentions';
import {
  MENTION_SENTIMENTS,
  type MentionRow,
  type MentionSentiment,
  type SentimentOverride,
} from '@/lib/mentionsList';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';

const NOTE_MAX = 500;

/**
 * "Sentiment is wrong" (MS-08): the answer's last correction, if any, and
 * for admins and managers a form to correct it with an optional note. The
 * database changes the answer everywhere its sentiment counts and keeps the
 * history (00160); the drawer and the table show the new tone at once.
 */
export function SentimentCorrection({
  row,
  override,
  canCorrect,
  onCorrected,
}: {
  row: MentionRow;
  /** The latest correction, once the answer has loaded. */
  override: SentimentOverride | null;
  canCorrect: boolean;
  onCorrected: (sentiment: MentionSentiment, override: SentimentOverride | null) => void;
}) {
  const t = useTranslations('mentions.drawer.correction');
  const tSentiment = useTranslations('mentions.overview.sentiment');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<MentionSentiment | null>(row.sentiment);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // A read-only workspace (plan not active): the upgrade dialog instead of the form.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    const result = await overrideMentionSentiment(row.id, choice, note);
    setSaving(false);
    if ('error' in result) {
      toast.error(t('failed'), {
        description: result.error === 'forbidden' ? t('forbidden') : result.message,
      });
      return;
    }
    if (!result.changed) {
      toast.info(t('unchanged'));
    } else {
      toast.success(t('saved'), {
        description: t('savedDescription', { sentiment: tSentiment(result.sentiment) }),
      });
      onCorrected(result.sentiment, result.override);
    }
    setOpen(false);
    setNote('');
  };

  const date = override
    ? new Date(override.createdAt).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  const history = override
    ? override.userName
      ? t('correctedBy', {
          name: override.userName,
          date,
          previous: tSentiment(override.previousSentiment),
        })
      : t('correctedOn', { date, previous: tSentiment(override.previousSentiment) })
    : null;

  if (!history && !canCorrect) return null;

  return (
    <div className="space-y-2">
      {history && (
        <p className="text-xs text-muted-foreground">
          {history}
          {override?.note && <span className="block italic">“{override.note}”</span>}
        </p>
      )}
      {canCorrect && !open && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-xs"
          onClick={guard(
            () => {
              setChoice(row.sentiment);
              setOpen(true);
            },
            { action: tActions('correctSentiment') },
          )}
        >
          {t('open')}
        </Button>
      )}
      {canCorrect && open && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div>
            <p className="text-sm font-medium">{t('title')}</p>
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('options')}>
            {MENTION_SENTIMENTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={choice === s}
                onClick={() => setChoice(s)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  choice === s
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted',
                )}
              >
                {tSentiment(s)}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor={`correction-note-${row.id}`} className="text-xs font-medium">
              {t('note')}
            </label>
            <Textarea
              id={`correction-note-${row.id}`}
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              className="mt-1 min-h-16 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !choice || choice === row.sentiment}
            >
              {t('save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
