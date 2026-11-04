'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DateRangePreset } from '@/config/datePresets';

/**
 * The one date range control (#713).
 *
 * Visibility and Citations carried byte-identical copies of this markup and
 * Prompts a third, divergent one — same concept, three shapes, three places.
 * Extracting it is what stops the next page from adding a fourth.
 *
 * Which presets a page offers stays the page's decision. Prompts deliberately
 * omits 24h and All: its table scores each prompt over the window, and a
 * single day yields one or two runs per prompt, so the column would read zero
 * for most rows (#686). Parity here means the same shape, label and position —
 * not pretending every page answers the same question.
 */

export { ALL_DATE_PRESETS, type DateRangePreset } from '@/config/datePresets';

export function dateRangePresetLabel(preset: DateRangePreset, t: (key: string) => string): string {
  if (preset === 'custom') return t('custom');
  if (preset === 'all') return t('all');
  return preset;
}

interface DateRangeFilterProps<P extends string = DateRangePreset> {
  value: P;
  onChange: (preset: P) => void;
  /** Presets this page offers, in display order. */
  presets: readonly P[];
  label?: string;
  /** Custom-range inputs render only when both the value and handlers are present. */
  from?: string;
  to?: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
  className?: string;
}

/**
 * Renders as sibling blocks rather than one wrapper, so it drops into the
 * `flex flex-wrap items-end gap-3` filter bars the pages already use and the
 * custom-range inputs sit alongside the other filters instead of under them.
 */
export function DateRangeFilter<P extends string = DateRangePreset>({
  value,
  onChange,
  presets,
  label,
  from,
  to,
  onFromChange,
  onToChange,
  className,
}: DateRangeFilterProps<P>) {
  const t = useTranslations('common');
  const resolvedLabel = label ?? t('dateRange');
  const showCustom = value === 'custom' && onFromChange && onToChange;

  return (
    <>
      <div className={className}>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {resolvedLabel}
        </label>
        {/* h-8: as tall as the selects and buttons beside it, and the date inputs. */}
        <div
          className="flex h-8 rounded-md border overflow-hidden"
          role="group"
          aria-label={resolvedLabel}
        >
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              aria-pressed={value === preset}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                value === preset
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted text-foreground',
              )}
            >
              {dateRangePresetLabel(preset as DateRangePreset, t)}
            </button>
          ))}
        </div>
      </div>

      {showCustom && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('from')}
            </label>
            <Input
              type="date"
              value={from ?? ''}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('to')}
            </label>
            <Input
              type="date"
              value={to ?? ''}
              onChange={(e) => onToChange(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
        </>
      )}
    </>
  );
}
