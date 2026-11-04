import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AgentAvatar, type AgentAvatarState } from './AgentAvatar';
import { DoneTick } from './DoneTick';

/**
 * The parts every run card shares (Chat v2 mockups: plan, approval, result,
 * out-of-permission and failed run): a 14 px card with a hairline border and
 * a soft shadow that rises in once (still with reduced motion), a header row,
 * a body and a footer with the note on the left and the buttons on the right.
 */

/** How a card stands out: plain; amber while it needs the person's OK; dark for a click; red once failed. */
export type AgentCardTone = 'plain' | 'needsYou' | 'click' | 'failed';

const TONE: Record<AgentCardTone, string> = {
  plain: '',
  needsYou: 'border-amber-200 ring-3 ring-amber-50 dark:border-amber-900 dark:ring-amber-950/60',
  click: 'border-foreground ring-3 ring-foreground/5',
  failed: 'border-red-200 dark:border-red-900',
};

export function AgentCard({
  tone = 'plain',
  className,
  children,
  ...rest
}: {
  tone?: AgentCardTone;
  className?: string;
  children: ReactNode;
  ref?: React.Ref<HTMLElement>;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  return (
    <section
      data-slot="agent-card"
      data-tone={tone}
      className={cn(
        'mb-4 animate-in overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)] duration-300 fade-in-0 slide-in-from-bottom-1.5 motion-reduce:animate-none',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/** The card's title row: a tag or pill on the left, the title, and pills on the right. */
export function AgentCardHeader({
  lead,
  title,
  end,
  titleId,
}: {
  lead?: ReactNode;
  title: ReactNode;
  end?: ReactNode;
  /** For the card's aria-labelledby. */
  titleId?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-3">
      {lead}
      <h3 id={titleId} className="m-0 min-w-0 text-sm font-semibold">
        {title}
      </h3>
      {end && <div className="ml-auto flex items-center gap-1.5">{end}</div>}
    </div>
  );
}

export function AgentCardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('px-3.5 pt-1.5 pb-3', className)}>{children}</div>;
}

/** The footer: a short muted note on the left, the card's buttons on the right. */
export function AgentCardFooter({ note, children }: { note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5">
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
      {children && <div className="ml-auto flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

/** A small grey pill on the right of a header, or amber when it is a warning. */
export function CardPill({
  tone = 'grey',
  children,
}: {
  tone?: 'grey' | 'amber';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-[9px] py-px text-[11.5px] leading-[14px] whitespace-nowrap',
        tone === 'grey'
          ? 'border-border text-muted-foreground'
          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
      )}
    >
      {children}
    </span>
  );
}

/** Source chips: where a change or an answer comes from ("Brand fact · Plans (approved)"). */
export function SourceChips({ label, sources }: { label: string; sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <ul aria-label={label} className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
      {sources.map((source) => (
        <li
          key={source}
          className="rounded-full border bg-card px-[9px] py-px text-[11.5px] text-foreground/80"
        >
          {source}
        </li>
      ))}
    </ul>
  );
}

/**
 * The agent's line above its card (the mockups' answer head): the avatar in
 * the run's state, a bold title, and muted lines under it.
 */
export function AgentHead({
  state,
  title,
  subtitle,
  note,
}: {
  state: AgentAvatarState;
  title: ReactNode;
  subtitle?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div data-slot="agent-head" className="mb-2 flex items-center gap-2.5">
      <AgentAvatar state={state} />
      <div className="min-w-0 leading-normal">
        <p className="m-0 text-[13.5px] font-semibold">{title}</p>
        {subtitle && <p className="m-0 text-xs text-muted-foreground">{subtitle}</p>}
        {note && <p className="m-0 text-[11.5px] text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

/** The success line a card collapses into (the mockups' okline), its tick popping in once. */
export function DoneLine({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return (
    <div
      role="status"
      data-slot="done-line"
      className="my-2 flex flex-wrap items-center gap-2.5 rounded-xl border border-green-200 bg-green-50/60 px-3 py-[9px] text-[13px] dark:border-green-900 dark:bg-green-950/40"
    >
      <DoneTick pop decorative />
      <div className="min-w-0 flex-1">
        {children}
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </div>
    </div>
  );
}
