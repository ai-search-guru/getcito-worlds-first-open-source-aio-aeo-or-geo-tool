import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * How a step runs (CHAT-20 approval classes, CHAT-23 P10): READ runs by
 * itself (auto); a WRITE asks, or runs and is logged in Full auto; an
 * EXECUTE always needs the person's click; done once it ran.
 */
export type ApprovalPillKind = 'auto' | 'asks' | 'logged' | 'click' | 'done';

export const APPROVAL_PILL_KINDS: readonly ApprovalPillKind[] = [
  'auto',
  'asks',
  'logged',
  'click',
  'done',
];

const KIND: Record<ApprovalPillKind, string> = {
  auto: 'bg-muted text-foreground/70',
  asks: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  logged: 'bg-muted text-foreground/70',
  click: 'bg-foreground text-background',
  done: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
};

/** The two that need saying why, in their tooltip (the mockup's titles). */
const TIP: Partial<Record<ApprovalPillKind, 'loggedTip' | 'clickTip'>> = {
  logged: 'loggedTip',
  click: 'clickTip',
};

/**
 * A step's approval pill (Chat v2 design polish, "Status pills"): soft grey
 * Auto, soft amber Asks you, grey Auto · logged with a small dot, soft green
 * Done, and Needs your click, the only dark pill, so it stands out. In a
 * step row the pill takes a fixed width (`className`), so the pills line up.
 */
export function ApprovalPill({ kind, className }: { kind: ApprovalPillKind; className?: string }) {
  const t = useTranslations('agentic.approval');
  const tip = TIP[kind];
  return (
    <span
      data-slot="approval-pill"
      data-state={kind}
      title={tip ? t(tip) : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full px-2 py-px text-[11px] leading-[14px] whitespace-nowrap',
        KIND[kind],
        className,
      )}
    >
      {kind === 'logged' && (
        <span aria-hidden className="mr-[5px] size-[5px] shrink-0 rounded-full bg-current" />
      )}
      {t(kind)}
    </span>
  );
}
