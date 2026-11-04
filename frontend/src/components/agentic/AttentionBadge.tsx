import { useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The amber dot on the Chat icon in the main menu (or Content's, when a page
 * needs the person), while anything needs them (Chat agentic plan §2,
 * "Attention badge"). The caller places it on the icon's corner. Nothing
 * shows at 0.
 */
export function AttentionDot({ needsYou, className }: { needsYou: number; className?: string }) {
  const t = useTranslations('agentic.attention');
  if (needsYou <= 0) return null;
  return (
    <span
      role="img"
      aria-label={t('needsYou', { count: needsYou })}
      data-slot="attention-dot"
      className={cn(
        'inline-block size-[9px] shrink-0 rounded-full border-2 border-sidebar bg-amber-600 dark:bg-amber-400',
        className,
      )}
    />
  );
}

/**
 * The count on Home (Chat's Inbox in the mockup): how many items wait there,
 * with an amber dot first while any of them needs the person. Nothing shows
 * at 0.
 */
export function AttentionCount({
  count,
  needsYou = 0,
  className,
}: {
  count: number;
  /** Of `count`, the ones that need the person. */
  needsYou?: number;
  className?: string;
}) {
  const t = useTranslations('agentic.attention');
  if (count <= 0) return null;
  const label =
    needsYou > 0
      ? t('itemsNeedYou', { count, needsYou: t('needsYou', { count: needsYou }) })
      : t('items', { count });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-slot="attention-count"
      className={cn('inline-flex shrink-0 items-center gap-1.5', className)}
    >
      {needsYou > 0 && (
        <span
          aria-hidden
          className="size-[7px] shrink-0 rounded-full bg-amber-600 dark:bg-amber-400"
        />
      )}
      <span
        aria-hidden
        className="min-w-[22px] rounded-[6px] bg-foreground/10 px-1.5 text-center text-[11px] leading-[18px] text-foreground/80 tabular-nums"
      >
        {formatNumber(count)}
      </span>
    </span>
  );
}
