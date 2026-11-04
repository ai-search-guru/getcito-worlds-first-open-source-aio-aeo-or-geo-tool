import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { TICK_CIRCLE, TickIcon } from './DoneTick';

/**
 * A chat's or a run's state in a list (Chat agentic plan §2, "List status
 * dot"): the chat list, Agents at work, Content Library and Action Center rows.
 */
export type ListDotState = 'idle' | 'running' | 'needsYou' | 'done' | 'failed' | 'paused';

export const LIST_DOT_STATES: readonly ListDotState[] = [
  'running',
  'needsYou',
  'done',
  'failed',
  'idle',
  'paused',
];

/**
 * The list dot (Chat v2 mockups): a grey dot when nothing runs; a dark one
 * with a ring that grows out while running; amber with a soft halo, nudging
 * now and then, when it needs the person; a green tick when done; red on soft
 * red when it stopped or failed; a lighter grey while paused. Motion stops
 * with reduced motion. It says its state to a screen reader and in its
 * tooltip, unless the words beside it already do (`decorative`).
 */
export function ListDot({
  state,
  decorative = false,
  className,
}: {
  state: ListDotState;
  decorative?: boolean;
  className?: string;
}) {
  const t = useTranslations('agentic.dot');
  return (
    <span
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': t(state), title: t(state) })}
      data-slot="list-dot"
      data-state={state}
      className={cn(
        'relative inline-flex size-4 shrink-0 items-center justify-center rounded-full',
        state === 'needsYou' && 'animate-agent-nudge motion-reduce:animate-none',
        state === 'done' && TICK_CIRCLE,
        state === 'failed' && 'bg-red-100 dark:bg-red-950',
        className,
      )}
    >
      {state === 'done' ? (
        <TickIcon className="size-[11px]" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            state === 'idle' && 'bg-foreground/20',
            state === 'paused' && 'bg-foreground/35',
            state === 'running' && 'bg-foreground',
            state === 'needsYou' &&
              'bg-amber-600 ring-3 ring-amber-100 dark:bg-amber-400 dark:ring-amber-950',
            state === 'failed' && 'bg-red-600 dark:bg-red-400',
          )}
        />
      )}
      {state === 'running' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0.5 animate-agent-dot-ring rounded-full border-[1.5px] border-foreground opacity-0 motion-reduce:animate-none"
        />
      )}
    </span>
  );
}

/**
 * The thin progress line under a running row (Chat agentic plan §2): how far
 * the run is, out of 100. Moves to a new value smoothly, at once with reduced
 * motion.
 */
export function ListProgress({ value, className }: { value: number; className?: string }) {
  const t = useTranslations('agentic.dot');
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <span
      role="progressbar"
      aria-label={t('progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-slot="list-progress"
      className={cn('block h-[3px] overflow-hidden rounded-[3px] bg-border', className)}
    >
      <span
        className="block h-full bg-foreground transition-[width] duration-600 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
