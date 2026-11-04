'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { ChatStep } from '@/lib/chat/events';
import { cn } from '@/lib/utils';
import { DoneTick } from './DoneTick';
import { ListDot } from './ListDot';
import { StepList, stepRowFrom } from './StepList';

/** Where a run is, for its step header (CHAT-03 items 9–12, 18–19). */
export type RunStepsStatus = 'running' | 'waiting' | 'done' | 'stopped' | 'error';

/** Working time in the header's words: "41s" under a minute, else "1m 12s". */
export function workedParts(ms: number): { m: number; s: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { m: Math.floor(total / 60), s: total % 60 };
}

/** The running header's clock: "0:41", "1:12". */
export function runClock(ms: number): string {
  const { m, s } = workedParts(ms);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * A run's steps under its header (CHAT-03 "Step list" and "Header"). While
 * it runs: "Working on it", "{N} steps · m:ss", open. Once done, it folds to
 * "Worked for 1m 12s" and "{N} steps · {M} sources"; a run of one step (not
 * counting thinking) shows that step's own line and its rows instead. Stopped:
 * "Stopped after 41s"; failed: "Stopped: something went wrong"; while its
 * stream reconnects, "Reconnecting…" (W1-15). A click opens and closes it
 * (aria-expanded). Screen readers hear each new step as it
 * starts, and the end (aria-live, polite). No steps, nothing.
 *
 * `workingMs` is the run's working time, which pauses while a step waits for
 * the person; the caller ticks it.
 */
export function RunSteps({
  status,
  steps,
  workingMs,
  sources = 0,
  reconnecting = false,
  className,
}: {
  status: RunStepsStatus;
  steps: ChatStep[];
  workingMs: number;
  /** How many "Data used" chips the run has. */
  sources?: number;
  /** The stream dropped and is reconnecting (CHAT-03 item 21). */
  reconnecting?: boolean;
  className?: string;
}) {
  const t = useTranslations('agentic.runSteps');
  const listId = useId();
  const active = status === 'running' || status === 'waiting';
  // Open while it runs, folded once it ends, until the person toggles it.
  const [toggled, setToggled] = useState<{ active: boolean; open: boolean } | null>(null);
  const open = toggled && toggled.active === active ? toggled.open : active;

  if (steps.length === 0) return null;

  const ordered = [...steps].sort((a, b) => a.n - b.n);
  const count = ordered.length;
  const duration = (() => {
    const { m, s } = workedParts(workingMs);
    return m > 0 ? t('minutes', { m, s }) : t('seconds', { s });
  })();
  const current =
    ordered.find((s) => s.status === 'waiting') ??
    [...ordered].reverse().find((s) => s.status === 'running');
  const work = ordered.filter((s) => s.kind !== 'thinking');
  const single = status === 'done' && work.length === 1 ? work[0] : null;

  let title: string;
  let end: string;
  if (active) {
    title = reconnecting ? t('reconnecting') : t('working');
    end = t('stepsClock', { steps: count, clock: runClock(workingMs) });
  } else if (single) {
    title = single.detail ? `${single.label} · ${single.detail}` : single.label;
    end =
      single.rowCount !== undefined
        ? t(single.scope?.unit === 'items' ? 'items' : 'rows', { count: single.rowCount })
        : '';
  } else if (status === 'done') {
    title = t('workedFor', { duration });
    end = sources > 0 ? t('stepsSources', { steps: count, sources }) : t('steps', { count });
  } else if (status === 'stopped') {
    title = t('stoppedAfter', { duration });
    end = t('steps', { count });
  } else {
    title = t('failed');
    end = t('steps', { count });
  }

  const announce =
    active && !reconnecting
      ? current
        ? t('now', { n: current.n, label: current.label })
        : t('working')
      : title;

  return (
    <div data-slot="run-steps" data-status={status} className={className}>
      {/* CHAT-23 has no id for it yet: answer.toggleSteps, after answer.toggleThinking. */}
      <button
        type="button"
        data-action="answer.toggleSteps"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setToggled({ active, open: !open })}
        className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-[13px] hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {status === 'done' ? (
          <DoneTick size="sm" decorative />
        ) : (
          <ListDot
            state={active ? 'running' : status === 'stopped' ? 'paused' : 'failed'}
            decorative
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {end && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{end}</span>}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div id={listId} hidden={!open}>
        <StepList rows={ordered.map((step) => stepRowFrom(step))} className="pl-1" />
      </div>
    </div>
  );
}
