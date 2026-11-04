import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** The check inside every done mark: a rounded stroke, never a filled circle. */
export function TickIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn(
        'fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3.4]',
        className,
      )}
    >
      <path d="M5.5 12.5l4.2 4.2L18.5 8" />
    </svg>
  );
}

/** The soft green circle around a tick: the tick, a done step, a done list dot. */
export const TICK_CIRCLE = 'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400';

/**
 * Done (Chat v2 design polish, "Done tick"): a soft green circle with a green
 * check, for completed steps, checklists and included rows. `pop` animates it
 * in once, for a success moment; reduced motion shows it at once.
 */
export function DoneTick({
  size = 'md',
  pop = false,
  decorative = false,
  className,
}: {
  /** md: 20 px (steps, checklists); sm: 16 px (beside small text). */
  size?: 'md' | 'sm';
  pop?: boolean;
  /** Next to words that already say it's done: hidden from screen readers. */
  decorative?: boolean;
  className?: string;
}) {
  const t = useTranslations('agentic');
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t('tick') })}
      data-slot="done-tick"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full align-middle',
        TICK_CIRCLE,
        size === 'md' ? 'size-5' : 'size-4',
        pop && 'animate-agent-tick motion-reduce:animate-none',
        className,
      )}
    >
      <TickIcon className={size === 'md' ? 'size-[13px]' : 'size-[11px]'} />
    </span>
  );
}
