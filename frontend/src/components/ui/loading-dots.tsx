import { cn } from '@/lib/utils';

/**
 * Something loading or at work, without a spinning ring (Content Editor
 * brief: "no spinning ring anywhere"): three dots that bounce in turn, in the
 * text's color. Still with reduced motion. `md` for a page or a panel
 * loading, `sm` (the default) beside a button's label, as wide as the 16 px
 * icon it often stands in for, so the label beside it doesn't move.
 *
 * The dots say nothing to a screen reader. `label` is for a loader nothing
 * else names (a page or a dialog loading, a button whose label they
 * replace): it is said as a status.
 */
export function LoadingDots({
  size = 'sm',
  label,
  className,
}: {
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  const dots = (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center align-middle',
        size === 'md' ? 'gap-1' : 'w-4 justify-center gap-0.5',
        !label && className,
      )}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            // Still with reduced motion, at an opacity that stays visible on muted text.
            'animate-agent-dot rounded-full bg-current opacity-25 motion-reduce:animate-none motion-reduce:opacity-60',
            size === 'md' ? 'h-1.5 w-1.5' : 'h-1 w-1',
          )}
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
  if (!label) return dots;
  return (
    <span role="status" className={cn('inline-flex shrink-0 items-center align-middle', className)}>
      {dots}
      <span className="sr-only">{label}</span>
    </span>
  );
}
