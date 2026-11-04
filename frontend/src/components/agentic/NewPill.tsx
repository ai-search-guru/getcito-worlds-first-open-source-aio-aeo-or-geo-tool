import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * "New" on a new area or feature (Chat agentic plan §2): an outlined grey
 * pill, shown until the person first opens it (the caller decides when).
 */
export function NewPill({ className }: { className?: string }) {
  const t = useTranslations('agentic');
  return (
    <span
      data-slot="new-pill"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-foreground/20 bg-card px-[7px] text-[10.5px] leading-4 font-medium whitespace-nowrap text-foreground/80',
        className,
      )}
    >
      {t('newPill')}
    </span>
  );
}
