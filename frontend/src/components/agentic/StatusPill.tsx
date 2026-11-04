import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Where a chat or a page stands, in the pill next to its title (Chat agentic plan §2). */
export type StatusPillState =
  | 'working'
  | 'answering'
  | 'needsYou'
  | 'done'
  | 'answered'
  | 'ready'
  | 'planReady'
  | 'draft'
  | 'failed';

export const STATUS_PILL_STATES: readonly StatusPillState[] = [
  'working',
  'answering',
  'needsYou',
  'done',
  'answered',
  'ready',
  'planReady',
  'draft',
  'failed',
];

type Tone = 'ink' | 'grey' | 'green' | 'amber' | 'red';

const TONE_OF: Record<StatusPillState, Tone> = {
  working: 'ink',
  answering: 'ink',
  needsYou: 'amber',
  done: 'green',
  answered: 'green',
  ready: 'green',
  planReady: 'grey',
  draft: 'grey',
  failed: 'red',
};

const TONE: Record<Tone, string> = {
  ink: 'border-foreground text-foreground',
  grey: 'border-border text-muted-foreground',
  green:
    'border-green-200 bg-green-100 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  amber:
    'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  red: 'border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
};

/**
 * The status pill beside a chat's or a page's title (Chat v2 mockups):
 * Working with a dark outline, Needs you in amber, Done, Answered and Ready
 * in green, Draft and Plan ready in grey, Failed in red. Its words are its
 * state, so a screen reader reads it as it is.
 */
export function StatusPill({ state, className }: { state: StatusPillState; className?: string }) {
  const t = useTranslations('agentic.status');
  return (
    <span
      data-slot="status-pill"
      data-state={state}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-[9px] py-px text-[11.5px] leading-[14px] whitespace-nowrap',
        TONE[TONE_OF[state]],
        className,
      )}
    >
      {t(state)}
    </span>
  );
}
