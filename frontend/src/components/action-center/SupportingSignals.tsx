'use client';

import { useTranslations } from 'next-intl';
import type { Signal } from '@/lib/actions/signals';
import { signalAffected, signalTypeLabel } from '@/lib/signals/display';
import { platformName } from '@/lib/signals/names';
import { supportingOf } from '@/lib/action-center/affected';

/** How many supporting signals "Why this action?" lists before "All signals". */
export const SUPPORT_SHOWN = 5;

/**
 * "n signals support this action" (AC-007): the open signals an action rests
 * on, each by type, platform and what it is about, so why it exists can be
 * checked. Resolved and dismissed signals no longer support it, nor do ones
 * that have moved on to a later cycle's action; the Signals tab, which
 * "All signals" opens, still lists them all.
 */
export function SupportingSignals({
  actionId,
  signals,
  onOpenSignal,
  onShowAll,
}: {
  actionId: string;
  /** Every signal the action has taken as evidence, newest first. */
  signals: Signal[];
  onOpenSignal: (id: string) => void;
  onShowAll: () => void;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer');
  const tSignals = useTranslations('actionCenter.signalsPage');
  const tCategories = useTranslations('actionCenter.signalCategories');

  // As the list counts them: open, and this action's now.
  const supporting = supportingOf(signals, actionId);

  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{t('support', { count: supporting.length })}</p>
      {supporting.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {supporting.slice(0, SUPPORT_SHOWN).map((signal) => {
            const affected = signalAffected(signal, tSignals);
            const where = [
              signal.where.platforms.map(platformName).join(', '),
              affected.detail ?? affected.label,
            ].filter(Boolean);
            return (
              <li key={signal.id}>
                <button
                  type="button"
                  onClick={() => onOpenSignal(signal.id)}
                  className="flex w-full items-baseline gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/40"
                >
                  <span className="shrink-0 font-medium">
                    {signalTypeLabel(signal, tCategories, tSignals)}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {where.join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {signals.length > Math.min(supporting.length, SUPPORT_SHOWN) && (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-2 text-xs font-medium underline-offset-2 hover:underline"
        >
          {t('supportAll', { count: signals.length })}
        </button>
      )}
    </div>
  );
}
