import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatStep, ChatStepStatus } from '@/lib/chat/events';
import { cn } from '@/lib/utils';
import { ApprovalPill, type ApprovalPillKind } from './ApprovalPill';
import { StepMarker, type StepMarkerState } from './StepMarker';

/** One row of a plan or a run (the mockups' `.step`). */
export interface StepRow {
  /** Its place in the run, from 1. */
  n: number;
  /** "Read the 4 tasks and rank them by impact" */
  label: string;
  /** The grey line under it: what it reads, or why it failed. */
  detail?: string | null;
  state: StepMarkerState;
  /** How it runs (Auto, Asks you, Needs your click…); none once it ran. */
  pill?: ApprovalPillKind | null;
  /** Skipped by the person or by a Stop: greyed, with its reason ("Stopped"), else "Skipped". */
  skipped?: boolean;
}

/** A stored step's status as its marker shows it (CHAT-03 icons, Chat v2 step states). */
export function stepMarkerState(status: ChatStepStatus): StepMarkerState {
  switch (status) {
    case 'running':
      return 'current';
    case 'waiting':
      return 'waiting';
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

/** A run's step (A1's ChatStep) as a row: its label, its detail, and where it stands. */
export function stepRowFrom(step: ChatStep, pill?: ApprovalPillKind | null): StepRow {
  return {
    n: step.n,
    label: step.label,
    detail: step.detail ?? null,
    state: stepMarkerState(step.status),
    skipped: step.status === 'skipped',
    pill: step.status === 'done' ? null : (pill ?? null),
  };
}

/**
 * Numbered steps (Chat v2 mockups `#s-plan`, `#s-work`, `#s-failed`): the
 * marker, the step in words with a grey line under it, and its approval pill
 * at a fixed width on the right, so the pills line up. A step waiting on the
 * person says so. `controls` adds what a row offers while a plan is edited.
 */
export function StepList({
  rows,
  controls,
  className,
}: {
  rows: StepRow[];
  controls?: (row: StepRow, index: number) => ReactNode;
  className?: string;
}) {
  const t = useTranslations('agentic.stepList');
  return (
    <ol data-slot="step-list" className={cn('m-0 list-none p-0', className)}>
      {rows.map((row, index) => {
        const detail = row.skipped
          ? (row.detail ?? t('skipped'))
          : (row.detail ?? (row.state === 'waiting' ? t('waiting') : null));
        return (
          <li
            key={row.n}
            data-state={row.skipped ? 'skipped' : row.state}
            className="flex items-start gap-2.5 border-b border-dashed py-[9px] text-[13.5px] last:border-b-0"
          >
            <StepMarker number={row.n} state={row.state} />
            <div className={cn('min-w-0 flex-1', row.skipped && 'text-muted-foreground')}>
              {row.label}
              {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
            </div>
            {controls?.(row, index)}
            {row.pill && <ApprovalPill kind={row.pill} className="w-[104px] self-center" />}
          </li>
        );
      })}
    </ol>
  );
}
