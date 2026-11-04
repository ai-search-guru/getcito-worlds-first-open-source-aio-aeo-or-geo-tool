'use client';

import type { ReactNode } from 'react';
import { stampParts } from '@/lib/chat/stamp';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { isChatHref, type ChatHref, type ChatStep } from '@/lib/chat/events';
import { AgentCard, AgentCardBody, AgentCardFooter, AgentHead } from './AgentCard';
import { RunSteps } from './RunSteps';

/** Done: everything ran. needsClick: done but for a step that goes live on the person's click. */
export type ResultCardState = 'done' | 'needsClick';

export interface ResultKpi {
  /** "Tasks ready" */
  label: string;
  /** "4" */
  value: string;
  /** "of 4" */
  note?: string;
}

export interface ResultFile {
  /** A short glyph for its tile: "≡", "{ }", "▤". */
  icon?: string;
  title: string;
  /** "6 questions · HTML + Markdown · in Files" */
  meta?: string;
  /** Its Open: a path in the app only (A1's ChatHref); anything else shows no Open. */
  href?: string;
}

/** The time line's parts, kept with the downloads' (lib/chat/stamp). */
export { stampParts };

/**
 * The result card (CHAT-mockup-v2 `#s-done`, CHAT-03 v2, CHAT-23 G7): the
 * agent's line in the run's end state, with what it did, and when — an
 * absolute "Generated Oct 26, 2026 · 14:32" and "Data as of …" when it read
 * workspace data, the GMT offset in their tooltips, never a relative time
 * alone; the run's steps folded under "Worked for …"; the counts; the files
 * it made, each with Open into the app; and a footer with one next action.
 * A step that goes live waits as its own click card (`before`, above it).
 */
export function ResultCard({
  state,
  title,
  summary,
  generatedAt,
  dataAsOf,
  timeZone,
  run,
  kpis = [],
  files = [],
  note,
  primary,
  before,
  children,
}: {
  state: ResultCardState;
  /** "Done. 4 tasks are ready for you to close." */
  title: string;
  /** "6 of 6 steps · Auto (Haiku 5.5 + Sonnet 5.5) · 2% of monthly AI limit" */
  summary?: string;
  /** ISO. */
  generatedAt: string;
  /** ISO; null when the run read no workspace data. */
  dataAsOf?: string | null;
  /** The IANA time zone the answer was shown in (chat_messages.timezone). */
  timeZone?: string;
  run?: { steps: ChatStep[]; workingMs: number; sources?: number };
  kpis?: ResultKpi[];
  files?: ResultFile[];
  note?: string;
  /** The footer's one next action, with its CHAT-23 id ("done.closeTasksInActionCenter"). */
  primary?: { label: string; href: ChatHref; action: string };
  /** The EXECUTE click card that waits, shown above the result. */
  before?: ReactNode;
  /** Follow-up checks and the like, inside the card under the files. */
  children?: ReactNode;
}) {
  const t = useTranslations('agentic.resultCard');
  const generated = stampParts(generatedAt, timeZone);
  const data = dataAsOf ? stampParts(dataAsOf, timeZone) : null;
  const stamps = (
    <span suppressHydrationWarning>
      <span
        title={t('generatedTip', {
          full: `${generated.date} ${generated.time} ${generated.offset}`.trim(),
        })}
      >
        {t('generated', { date: generated.date, time: generated.time })}
      </span>
      {data && (
        <>
          {' · '}
          <span
            title={t('dataAsOfTip', { full: `${data.date} ${data.time} ${data.offset}`.trim() })}
          >
            {t('dataAsOf', { date: data.day, time: data.time })}
          </span>
        </>
      )}
    </span>
  );
  const showPrimary = primary && isChatHref(primary.href);

  return (
    <div data-slot="result-card" data-state={state}>
      <AgentHead
        state={state === 'done' ? 'done' : 'waiting'}
        title={title}
        subtitle={summary}
        note={stamps}
      />
      {before}
      <AgentCard aria-label={t('summary')}>
        <AgentCardBody className="pt-3">
          {run && run.steps.length > 0 && (
            <RunSteps
              status="done"
              steps={run.steps}
              workingMs={run.workingMs}
              sources={run.sources}
              className="mb-2"
            />
          )}
          {kpis.length > 0 && (
            <div className="my-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-[14px] border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(10,10,10,.04)]"
                >
                  <span className="block text-[11.5px] text-muted-foreground">{kpi.label}</span>
                  <b className="text-[28px] leading-[1.15] font-semibold tracking-[-0.6px] tabular-nums">
                    {kpi.value}
                  </b>
                  {kpi.note && (
                    <span className="ml-1 text-[11.5px] text-green-700 dark:text-green-400">
                      {kpi.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <ul aria-label={t('files')} className="m-0 my-2 grid list-none gap-1.5 p-0">
              {files.map((file) => (
                <li
                  key={file.title}
                  className="grid min-h-[50px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-2.5 py-2 text-[13px]"
                >
                  <span
                    aria-hidden
                    className="flex size-[30px] items-center justify-center rounded-lg border bg-muted text-[13px]"
                  >
                    {file.icon ?? '≡'}
                  </span>
                  <span className="min-w-0 truncate">
                    {file.title}
                    {file.meta && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {file.meta}
                      </span>
                    )}
                  </span>
                  {isChatHref(file.href) ? (
                    <Link
                      href={file.href}
                      data-action="deliverable.open"
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      {t('open')}
                    </Link>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}
          {children}
        </AgentCardBody>
        {(note || showPrimary) && (
          <AgentCardFooter note={note}>
            {showPrimary && (
              <Link href={primary.href} data-action={primary.action} className={buttonVariants()}>
                {primary.label}
              </Link>
            )}
          </AgentCardFooter>
        )}
      </AgentCard>
    </div>
  );
}
