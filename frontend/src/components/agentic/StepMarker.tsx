import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { TICK_CIRCLE, TickIcon } from './DoneTick';

/** Where a step of a run stands (Chat v2 design polish, "Step states"). */
export type StepMarkerState = 'pending' | 'current' | 'waiting' | 'failed' | 'done';

export const STEP_MARKER_STATES: readonly StepMarkerState[] = [
  'pending',
  'current',
  'waiting',
  'failed',
  'done',
];

const STATE: Record<StepMarkerState, string> = {
  pending: 'border-foreground/20 bg-card text-muted-foreground',
  current:
    'animate-agent-step border-amber-500 bg-card text-amber-700 ring-3 ring-amber-100 motion-reduce:animate-none dark:border-amber-400 dark:text-amber-300 dark:ring-amber-950',
  waiting:
    'border-amber-600 bg-amber-100 text-amber-700 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-300',
  failed:
    'border-red-600 bg-red-100 text-red-700 dark:border-red-500 dark:bg-red-950 dark:text-red-300',
  done: cn('border-transparent', TICK_CIRCLE),
};

/**
 * A step's number circle in a plan or a run: grey outlined while it waits its
 * turn; with a soft amber ring that pulses while it runs (still with reduced
 * motion); amber while it waits for the person; soft red with "!" when it
 * failed; a green tick once done. It says the step and its state to a screen
 * reader ("Step 2 · Running").
 */
export function StepMarker({
  number,
  state,
  className,
}: {
  /** The step's place in the run, from 1. */
  number: number;
  state: StepMarkerState;
  className?: string;
}) {
  const t = useTranslations('agentic.step');
  return (
    <span
      role="img"
      aria-label={t('label', { number, state: t(state) })}
      data-slot="step-marker"
      data-state={state}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] leading-none font-semibold tabular-nums',
        STATE[state],
        className,
      )}
    >
      {state === 'done' ? (
        <TickIcon className="size-[13px]" />
      ) : (
        <span aria-hidden>{state === 'failed' ? '!' : number}</span>
      )}
    </span>
  );
}
