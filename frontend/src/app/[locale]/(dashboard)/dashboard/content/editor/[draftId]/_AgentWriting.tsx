'use client';

import { useEffect, useState } from 'react';
import { useNow, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Check, Circle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { stopAgentRun } from '@/lib/content/agentRunsClient';
import type { AgentRun, AgentRunKind } from '@/lib/content/agentRuns';
import { CONTENT_LIBRARY_PATH, type DraftMethod } from '@/lib/content/drafts';
import { cn } from '@/lib/utils';
import { AgentTile, RunSteps, StepSweep } from './_AgentCard';
import { WorkingDots } from './_WorkingDots';
import { useAgentRun } from './_useAgentRun';

/**
 * What the agent does with a draft, in order (contentWriter.js): it reads
 * what it was given, sets out the rules (or, on a live page, the passages it
 * keeps), writes, and the page opens for review.
 */
const STEPS = ['read', 'rules', 'write', 'review'] as const;
/**
 * The step it is on while the draft says it writes: the first two take it a
 * second from the start, the model's call is the wait.
 */
const WRITING = STEPS.indexOf('write');

/**
 * Past this, the wait is longer than usual: the model's call is cut at three
 * minutes (contentWriter.js CALL_TIMEOUT_MS), and the page then says it
 * couldn't finish.
 */
const SLOW_AFTER_S = 120;

/**
 * The run this page waits on, as the server starts it (contentWriter.js
 * startWritingRun): a Start on a new page writes it, one on a live page runs
 * as a Fix (its suggestions), and a rewrite rewrites the whole page. Write
 * this (customer priorities item 9) builds the brief first, in a run of its
 * own (briefThenWrite).
 */
const WRITING_RUNS = {
  create: ['brief', 'write'],
  optimize: ['brief', 'fix'],
  rewrite: ['rewrite'],
} as const satisfies Record<DraftMethod | 'rewrite', readonly AgentRunKind[]>;

/**
 * What the agent does while it writes, as its prompt asks it
 * (contentWriter.js WRITE_SYSTEM_PROMPT and SUGGEST_SYSTEM_PROMPT,
 * contentRewrite.js), one line at a time: the wait reads as the work going
 * on, never as progress made up.
 */
const DOING = {
  create: ['answerFirst', 'outline', 'rules', 'sources', 'placeholders'],
  optimize: ['missing', 'quoted', 'rules', 'sources', 'placeholders'],
  rewrite: ['rules', 'length', 'kept', 'voice', 'sources', 'placeholders'],
  // Write this's brief, before the page.
  brief: ['outline', 'sources'],
} as const;
/** Seconds each line stays. */
const DOING_S = 4;

/** A page's lines, drawn in one after another while it is written: [kind, width %]. */
const PAGE_LINES = [
  ['h', 55],
  ['p', 96],
  ['p', 88],
  ['p', 64],
  ['h', 40],
  ['p', 92],
  ['p', 84],
  ['p', 52],
] as const;

/** The seconds since the agent started, null when the start isn't known. */
function elapsedSeconds(since: string | null, now: Date): number | null {
  const start = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / 1000));
}

/** "1:05". */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The line on what the agent does now, from DOING, with the counts its run
 * read (its rules, its sources); a new one every DOING_S seconds.
 */
function DoingLine({
  mode,
  run,
  seconds,
}: {
  mode: keyof typeof DOING;
  run: AgentRun | null;
  seconds: number | null;
}) {
  const t = useTranslations('contentEditor.editor.agentWriting.doing');
  const counted = (key: 'read_rules' | 'gather_sources') =>
    run?.steps.find((step) => step.key === key)?.count ?? null;
  const counts = { rules: counted('read_rules'), sources: counted('gather_sources') };
  // None read (the step's chip is left out too): not a line to say.
  const lines = DOING[mode].filter(
    (line) => (line !== 'rules' && line !== 'sources') || counts[line] !== 0,
  );
  const line = lines[Math.floor((seconds ?? 0) / DOING_S) % lines.length];
  const said = (): string => {
    if (line !== 'rules' && line !== 'sources') return t(line);
    const count = counts[line];
    return count === null ? t(`${line}Any`) : t(line, { count });
  };
  return (
    // Hidden from screen readers, as the clock: a status that reads out every few seconds.
    <p aria-hidden className="min-w-0 flex-1 text-xs text-muted-foreground">
      <span
        key={line}
        className="block truncate animate-in duration-500 fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
      >
        {said()}
      </span>
    </p>
  );
}

/**
 * A faint page whose lines are drawn in, one after another, while the agent
 * writes it. Still, and whole, with reduced motion.
 */
function PageFilling() {
  return (
    <div aria-hidden className="mt-6 w-full max-w-sm space-y-2 rounded-xl border border-dashed p-4">
      {PAGE_LINES.map(([kind, width], i) => (
        <span
          key={i}
          className={cn(
            'block origin-left animate-agent-fill rounded-full motion-reduce:animate-none',
            kind === 'h'
              ? 'h-2.5 bg-muted-foreground/25 [&:not(:first-child)]:mt-4'
              : 'h-1.5 bg-muted-foreground/15',
          )}
          style={{ width: `${width}%`, animationDelay: `${i * 0.45}s` }}
        />
      ))}
    </div>
  );
}

/**
 * The draft while the Content Agent writes it (CE-015): nothing to edit yet,
 * so the page shows the agent at work, step by step as Chat shows its tools,
 * with the time it has taken, and says when that's longer than usual. The
 * editor opens on what it wrote. Once its run reads (v1.1 CE-027/035), its
 * real steps, named by the data they use, and Stop, which leaves the page as
 * it was. It moves while it waits (CE-026): the agent's tile, a sweep on the
 * step under way, a line on what it does, and the page drawn in.
 */
export function AgentWriting({
  draftId,
  brandId,
  title,
  method,
  since,
  rewrite = false,
  onRunEnded,
}: {
  draftId: string;
  brandId: string;
  title: string;
  method: DraftMethod;
  /** When the agent started (content_drafts.agent_state_at). */
  since: string | null;
  /** Rewrite the page to these rules (the draft's agent_run): its run is a rewrite. */
  rewrite?: boolean;
  /** The run ended (stopped, done or failed): the page reads the draft again. */
  onRunEnded?: (stopped?: boolean) => void;
}) {
  const t = useTranslations('contentEditor.editor');
  const seconds = elapsedSeconds(since, useNow({ updateInterval: 1000 }));
  const mode = rewrite ? 'rewrite' : method;
  const live = useAgentRun(draftId, true, WRITING_RUNS[mode]);
  const [stopping, setStopping] = useState(false);
  // The last run read stays until the editor opens: the fixed list never
  // comes back for a moment at its end.
  const [shown, setShown] = useState(live);
  if (live && live !== shown) setShown(live);
  const run = live ?? shown;
  // It ended (done, failed, or gone stale): the draft is read at once, not
  // on the page's next look.
  const ended = shown !== null && live === null;
  useEffect(() => {
    if (ended) onRunEnded?.();
  }, [ended, onRunEnded]);
  const stop = async () => {
    setStopping(true);
    const result = await stopAgentRun(draftId, brandId, run?.id ?? null).catch(
      (): { error: 'failed' } => ({
        error: 'failed',
      }),
    );
    if ('error' in result) {
      toast.error(t('agentCard.stopFailed'));
      setStopping(false);
    } else if (result.stopped) {
      // The page opens again as it was: the server let go of the draft.
      toast(t('agentCard.stopped'));
      onRunEnded?.(true);
    } else {
      setStopping(false);
    }
  };
  return (
    <>
      <header className="flex items-center gap-2.5 border-b px-4 py-2.5">
        <Link
          href={CONTENT_LIBRARY_PATH}
          aria-label={t('back')}
          title={t('back')}
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="min-w-0 truncate text-sm font-medium">{title.trim() || t('untitled')}</h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div role="status" className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-3">
            <AgentTile tone="working" count={0} />
            <p className="text-sm font-medium">
              {t(run?.kind === 'brief' ? 'agentWriting.titleBrief' : 'agentWriting.title')}
            </p>
          </div>
          {run ? (
            <div className="space-y-2 rounded-xl border bg-card px-4 py-3.5">
              <RunSteps run={run} moving />
              <div className="flex items-center gap-3 border-t pt-2.5">
                <DoingLine
                  mode={run.kind === 'brief' ? 'brief' : mode}
                  run={run}
                  seconds={seconds}
                />
                {seconds !== null && (
                  <p aria-hidden className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {clock(seconds)}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 rounded-xl border bg-card px-4 py-3.5">
              <ol className="space-y-2.5">
                {STEPS.map((step, i) => (
                  <li
                    key={step}
                    aria-current={i === WRITING ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 text-sm',
                      i === WRITING && 'relative -mx-2 -my-1 overflow-hidden rounded-md px-2 py-1',
                      i > WRITING && 'text-muted-foreground',
                    )}
                  >
                    {i === WRITING && <StepSweep />}
                    {i < WRITING ? (
                      <Check
                        aria-hidden
                        className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      />
                    ) : i === WRITING ? (
                      // No spinning ring (v1.1 §2.4): the agent's dots.
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        <WorkingDots className="ml-0" />
                      </span>
                    ) : (
                      <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                    )}
                    <span className="min-w-0 flex-1">
                      {t(`agentWriting.steps.${mode}.${step}`)}
                    </span>
                    {/* Hidden from screen readers: a status that reads out every second. */}
                    {i === WRITING && seconds !== null && (
                      <span
                        aria-hidden
                        className="shrink-0 text-xs text-muted-foreground tabular-nums"
                      >
                        {clock(seconds)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              <div className="border-t pt-2.5">
                <DoingLine mode={mode} run={null} seconds={seconds} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {seconds !== null && seconds >= SLOW_AFTER_S ? (
              <span className="font-medium text-foreground">{t('agentWriting.slow')}</span>
            ) : (
              t('agentWriting.usual')
            )}{' '}
            {rewrite ? t('agentWriting.leaveRewrite') : t('agentWriting.leave')}
          </p>
        </div>
        {/* Outside the status, which a screen reader reads as it changes. */}
        {run && (
          <div className="mt-4 w-full max-w-sm">
            <Button variant="outline" size="sm" disabled={stopping} onClick={() => void stop()}>
              {t('agentCard.stop')}
            </Button>
          </div>
        )}
        <PageFilling />
      </div>
    </>
  );
}
