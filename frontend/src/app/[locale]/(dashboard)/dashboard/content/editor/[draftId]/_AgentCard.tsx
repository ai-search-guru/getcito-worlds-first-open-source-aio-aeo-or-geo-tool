'use client';

import { useId, useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Check, ChevronRight, User, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { AgentAvatar } from '@/components/agentic/AgentAvatar';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { Button } from '@/components/ui/button';
import {
  AGENT_RUN_MAX,
  suggestionCounts,
  type DraftSuggestion,
  type SuggestionStatus,
} from '@/lib/content/suggestions';
import { shownSteps, stepMessage, type AgentRun } from '@/lib/content/agentRuns';
import { cn } from '@/lib/utils';
import { PageCompareDialog, pageCharacters } from './_PageRewrite';
import { PLACEHOLDER, pagePlaceholders } from '@/lib/content/placeholders';
import { StepSweep } from '@/components/ui/step-sweep';
import { WorkingDots } from './_WorkingDots';

/**
 * The Content Agent card over the page (Content Editor v1.1, CE-025/026):
 * one place for what the agent left and what it is doing, in three states.
 *   - waiting: how many suggestions, what they change and the rules they
 *     gain ("Rules 9 → 10 of 14"), with Review, Reject all and Accept all;
 *     a whole page rewritten shows its characters, with Compare;
 *   - all reviewed: how many were accepted and the rules met and still
 *     open, with Undo all and Run Agent;
 *   - working: while the agent runs from the page.
 * The tile moves a little (a soft ring, a blink, a spark; a sweep and a
 * breath while working), never a rotating ring, and not at all with reduced
 * motion. The card wraps on a narrow page: its buttons go under the text.
 */

/** A ghost button on the card's grey: its hover shows. */
const GHOST = 'hover:bg-foreground/5 dark:hover:bg-foreground/10';

/** The rules as the card counts them. */
export interface CardRules {
  met: number;
  total: number;
  /** The keys of the rules on that the page doesn't meet now. */
  open: Set<string>;
  /**
   * What accepting the open result would do, checked on a copy of the page
   * (editor test 2026-10-25): the rules met then, and those met now it would
   * break, named. Without it, the gain is read from what each change says
   * it fixes (rulesAfter).
   */
  after?: { now: number; met: number; breaks: string | null };
}

/**
 * The rules met once the open suggestions are in: each open rule a
 * suggestion says it meets counts once.
 */
export function rulesAfter(suggestions: DraftSuggestion[], rules: CardRules): number {
  const meets = new Set(
    suggestions
      .filter((s) => s.status === 'open')
      .flatMap((s) => s.ruleKeys)
      .filter((key) => rules.open.has(key)),
  );
  return Math.min(rules.total, rules.met + meets.size);
}

/** The agent's reason as a sentence: its first letter upper-cased, in the page's locale. */
function sentence(reason: string, locale: string): string {
  return reason.charAt(0).toLocaleUpperCase(locale) + reason.slice(1);
}

/**
 * The agent: a robot whose eyes blink (or look around while it works) and a
 * spark by its antenna, slower once all are reviewed.
 */
function AgentIcon({ working, slow }: { working: boolean; slow: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-[22px] w-[22px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
    >
      <rect x="4" y="8" width="16" height="11" rx="3.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" className="fill-current" />
      <g
        className={cn(
          '[transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none',
          working ? 'animate-agent-look' : 'animate-agent-blink',
        )}
      >
        <path d="M9 13v1.5M15 13v1.5" className="[stroke-width:2.2]" />
      </g>
      <path d="M2 12.5v2M22 12.5v2" />
      <path
        d="M19 2.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"
        className={cn(
          'animate-agent-spark fill-amber-400 stroke-amber-400 [stroke-width:0.8] [transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none dark:fill-amber-500 dark:stroke-amber-500',
          slow && '[animation-duration:2.4s]',
        )}
      />
    </svg>
  );
}

export function AgentTile({
  tone,
  count,
}: {
  tone: 'waiting' | 'done' | 'working';
  /** The open suggestions, as a badge while there are any. */
  count: number;
}) {
  return (
    // The title says it all: the tile and its count are for the eye.
    <span
      aria-hidden
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-xl',
        tone === 'done'
          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
          : 'bg-foreground text-background',
        tone === 'working' && 'animate-agent-breathe motion-reduce:animate-none',
      )}
    >
      {/* A soft ring that grows out of the tile: never one that rotates. */}
      {tone !== 'working' && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-1 rounded-[15px] border-2 motion-reduce:hidden',
            tone === 'done'
              ? 'animate-agent-ring-slow border-emerald-500/45'
              : 'animate-agent-ring border-foreground/35',
          )}
        />
      )}
      {tone === 'working' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-agent-sweep rounded-xl bg-[linear-gradient(115deg,transparent_30%,color-mix(in_oklab,var(--background)_22%,transparent)_50%,transparent_70%)] bg-[length:250%_100%] motion-reduce:hidden"
        />
      )}
      <AgentIcon working={tone === 'working'} slow={tone === 'done'} />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-muted bg-amber-700 px-1 text-[11px] font-semibold text-white dark:bg-amber-500 dark:text-amber-950">
          {count}
        </span>
      )}
    </span>
  );
}

/** The person's tile: a step only they can take (their to-dos, their checks). */
function PersonTile() {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background text-foreground"
    >
      <User className="h-[18px] w-[18px]" />
    </span>
  );
}

// The step under way's sweep, shared with the demo's setup screen.
export { StepSweep };

/**
 * A run's steps as chips (CE-027/035), named by the data they use: the ones
 * done in green with a check, the one under way in full, the rest muted.
 */
export function RunSteps({
  run,
  moving = false,
}: {
  run: AgentRun;
  /**
   * The step under way moves (a sweep and the agent's dots), where nothing
   * else on the page says the agent works (CE-026: its waiting page).
   */
  moving?: boolean;
}) {
  const t = useTranslations('contentEditor.editor.agentCard.steps');
  const tCard = useTranslations('contentEditor.editor.agentCard');
  const tRules = useTranslations('contentEditor.editor.rules.names');
  const format = useFormatter();
  const shown = shownSteps(run);
  // The rules it keeps its changes small for (learning B6), by their names.
  const careful = (run.steps[0]?.careful ?? [])
    .filter((key) => tRules.has(key))
    .map((key) => tRules(key));
  // What the live page earns, kept in mind on its sources step (learning B5).
  const live = run.steps.find((step) => step.key === 'gather_sources')?.live;
  return (
    <>
      <ol className="mt-1 flex flex-wrap items-center gap-1 text-[12px]">
        {shown.map(({ step, index }, i) => {
          const { key, count } = stepMessage(step);
          const done = index < run.step;
          const now = index === run.step;
          return (
            <li key={step.key} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              )}
              <span
                aria-current={now ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5',
                  done &&
                    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
                  now && 'bg-background font-medium text-foreground',
                  now && moving && 'relative overflow-hidden',
                  !done && !now && 'border-dashed text-muted-foreground',
                )}
              >
                {now && moving && <StepSweep />}
                {done && <Check aria-hidden className="h-3 w-3 shrink-0" />}
                {t(key, count === undefined ? {} : { count })}
                {now && moving && <WorkingDots className="ml-0.5" />}
              </span>
            </li>
          );
        })}
      </ol>
      {careful.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {tCard('careful', { rules: format.list(careful, { type: 'conjunction' }) })}
        </p>
      )}
      {/* The live page it kept in mind (learning B5). */}
      {live && <p className="mt-1 text-[11px] text-muted-foreground">{tCard('live', live)}</p>}
    </>
  );
}

export function AgentCard({
  suggestions,
  rules,
  busy,
  working,
  onServer = false,
  onAcceptAll,
  onRejectAll,
  onUndoAll,
  onReview,
  onRun,
  onClose,
  onDecidePage,
  runBlocked = null,
  sourceCount = 0,
  onSeeSources,
  run = null,
  onStop,
  stopping = false,
  next = null,
  onAllSteps,
  length = null,
  lastRunFailed = false,
  pageChars = null,
}: {
  suggestions: DraftSuggestion[];
  rules: CardRules;
  /** A decision is being saved, or the page can't take one now. */
  busy: boolean;
  /** The agent is working from this page (Apply rules with Agent). */
  working: boolean;
  /**
   * Its run is on the server now, so the page can be left: not while the
   * browser still gathers what it sends (the brief's prompts and sources).
   */
  onServer?: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onUndoAll: () => void;
  /** Scrolls to the first open suggestion and marks it. */
  onReview: () => void;
  /** Run Agent once all are reviewed: the open rules, fixed. */
  onRun: () => void;
  onClose: () => void;
  /** A whole page rewritten: accepted, rejected, or open again (Undo). */
  onDecidePage: (status: SuggestionStatus) => void;
  /** Why Run Agent can't run now (another agent run, locked passages loading), or null. */
  runBlocked?: string | null;
  /** How many of the person's sources the batch was written from (CE-033/034). */
  sourceCount?: number;
  /** Opens the Sources tab. */
  onSeeSources?: () => void;
  /** The run under way, step by step (CE-027/035), or null before its first step reads. */
  run?: AgentRun | null;
  /** Stops the run under way: nothing it had is kept. */
  onStop?: () => void;
  /** Stop was pressed: it waits for the run to end. */
  stopping?: boolean;
  /**
   * The Next step basket's step (Next step spec §3), offered in Run Agent's
   * place once nothing is left to decide: its button, and why it can't run.
   */
  next?: {
    label: string;
    onRun: () => void;
    blocked: string | null;
    /** The step's name: the card heads with it, "Next · {title}" (Next step spec §3). */
    title?: string;
    /** Why it is next, from the page's numbers. */
    reason?: string;
    /** Who takes it: the agent's run, or the person. */
    actor?: 'agent' | 'you';
  } | null;
  /** Opens the basket with every step. */
  onAllSteps?: () => void;
  /** The agent's last run failed: said in place of an earlier batch's review. */
  lastRunFailed?: boolean;
  /** A rewrite's characters, before and after, as the toolbar counts them (the editor's count). */
  pageChars?: { before: number; after: number } | null;
  /**
   * The page's Length rule (its target and band) and what a rewrite keeps
   * as it is: a rewrite's result is read against it, never the agent's say.
   */
  length?: {
    target: number;
    min: number;
    max: number;
    kept: number;
    /** What the rewrite keeps puts the Length out of its reach (rules.ts lengthOutOfReach). */
    outOfReach?: boolean;
  } | null;
}) {
  const t = useTranslations('contentEditor.editor.agentCard');
  const chatOn = useChatAgentic();
  const locale = useLocale();
  const tSuggestions = useTranslations('contentEditor.editor.suggestions');
  const tRewrite = useTranslations('contentEditor.editor.rewrite');
  const [comparing, setComparing] = useState(false);
  const page = suggestions.find((s) => s.kind === 'page') ?? null;
  // The placeholders an open rewrite adds, for the person to fill: read once
  // a rewrite, not on every key the page takes.
  const pageOpen = page?.status === 'open';
  const pageLeft = useMemo(
    () =>
      pageOpen && page
        ? Math.max(
            0,
            pagePlaceholders(page.afterText).count - pagePlaceholders(page.beforeHtml ?? '').count,
          )
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rewrite's two pages, not the object
    [pageOpen, page?.afterText, page?.beforeHtml],
  );
  const { open, accepted } = suggestionCounts(suggestions);
  const openOnes = suggestions.filter((s) => s.status === 'open');
  const action = suggestions.find((s) => s.actionId && s.actionNo !== null);
  // From the page as it is now when checked so: never a count a beat behind it.
  const from = rules.after?.now ?? rules.met;
  const after = rules.after?.met ?? rulesAfter(suggestions, rules);
  // Rules met now that accepting it would break: said, never left to find after.
  const breaks = rules.after?.breaks ? (
    <span className="text-amber-700 dark:text-amber-400">
      {' · '}
      {t('breaks', { names: rules.after.breaks })}
    </span>
  ) : null;
  const stillOpen = Math.max(0, rules.total - rules.met);
  // Run Agent shows once nothing is left to decide; why it can't run is
  // written in the card, never only on hover (as the Rules card does, CE-028).
  const runShown = !working && stillOpen > 0 && (page ? page.status !== 'open' : open === 0);
  const reasonId = useId();
  const nextShown = !!next && !working && (page ? page.status !== 'open' : open === 0);
  const reason = next ? (nextShown ? next.blocked : null) : runShown ? runBlocked : null;
  // What follows the review: the basket's next step, or Run Agent for the rules still open.
  const afterReview = next ? (
    <>
      {onAllSteps && (
        <Button variant="ghost" size="sm" className={GHOST} onClick={onAllSteps}>
          {t('allSteps')}
        </Button>
      )}
      <Button
        size="sm"
        disabled={busy || next.blocked !== null}
        aria-describedby={reason ? reasonId : undefined}
        onClick={next.onRun}
      >
        {t('next', { action: next.label })}
      </Button>
    </>
  ) : (
    stillOpen > 0 && (
      <Button
        size="sm"
        disabled={busy || runBlocked !== null}
        aria-describedby={reason ? reasonId : undefined}
        onClick={onRun}
      >
        {t('run')}
      </Button>
    )
  );
  const tone = working ? 'working' : open > 0 ? 'waiting' : 'done';
  // "built from 3 of your sources · See sources" (v1.1 §3b).
  const builtFrom = sourceCount > 0 && (
    <>
      {' · '}
      {t('builtFrom', { count: sourceCount })}
      {onSeeSources && (
        <>
          {' · '}
          <button
            type="button"
            onClick={onSeeSources}
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t('seeSources')}
          </button>
        </>
      )}
    </>
  );

  let title: React.ReactNode;
  let line: React.ReactNode;
  if (working) {
    title = (
      <>
        {t('working')}
        <WorkingDots />
      </>
    );
    line = (
      <>
        {/* As Chat says it: the run goes on without the page open, once it is on the server. */}
        {chatOn && onServer && <span className="block">{t('leavePage')}</span>}
        {/* Its real steps, as the run says them; none until its first is read. */}
        {run && <RunSteps run={run} />}
        <span
          aria-hidden
          className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-border"
        >
          {/* Without motion, a faint full line: never a still bar that reads as progress. */}
          <span className="block h-full w-[30%] animate-agent-slide rounded-full bg-foreground motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-30" />
        </span>
      </>
    );
  } else if (page) {
    const { before, after: afterChars } = pageChars ?? pageCharacters(page);
    title =
      page.status === 'open'
        ? tRewrite('ready')
        : page.status === 'accepted'
          ? tRewrite('accepted')
          : tRewrite('rejected');
    // Read against the Length, not the agent's say: a rewrite that missed it
    // says so, and why when what it keeps is most of the Length.
    const missed = length && (afterChars > length.max || afterChars < length.min) ? length : null;
    line =
      page.status === 'open' ? (
        <>
          {tRewrite('characters', { before, after: afterChars })}
          {' · '}
          {missed ? (
            <span className="text-amber-700 dark:text-amber-400">
              {tRewrite('lengthMissed', { target: missed.target })}
              {afterChars > missed.max &&
                missed.outOfReach &&
                missed.kept > 0 &&
                ` ${tRewrite('lengthKept', { kept: missed.kept })}`}
              {/* Asked to shorten it, it came out longer: said, not offered silently. */}
              {afterChars > missed.max &&
                before > missed.max &&
                afterChars > before &&
                ` · ${tRewrite('longer')}`}
            </span>
          ) : (
            page.reason
          )}
          {pageLeft > 0 && ` · ${t('placeholders', { count: pageLeft })}`}
          {rules.after && rules.after.met !== from && (
            <>
              {' · '}
              <span
                className={cn(
                  'font-medium',
                  rules.after.met > from
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400',
                )}
              >
                {t('gain', { met: from, after: rules.after.met, total: rules.total })}
              </span>
            </>
          )}
          {breaks}
          {builtFrom}
        </>
      ) : page.status === 'accepted' && stillOpen > 0 ? (
        tRewrite('rulesOpen', { count: stillOpen })
      ) : null;
  } else if (open > 0) {
    title = t('waiting', { count: open });
    // The placeholders its changes add, for the person to fill once accepted.
    const batchLeft = openOnes.reduce(
      (n, s) =>
        n +
        Math.max(
          0,
          (s.afterText.match(PLACEHOLDER) ?? []).length -
            (s.beforeText.match(PLACEHOLDER) ?? []).length,
        ),
      0,
    );
    line = (
      <>
        {sentence(openOnes[0]?.reason ?? '', locale)}
        {openOnes.length > 1 && ` · ${t('more', { count: openOnes.length - 1 })}`}
        {batchLeft > 0 && ` · ${t('placeholders', { count: batchLeft })}`}
        {after > from && (
          <>
            {' · '}
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {t('gain', { met: from, after, total: rules.total })}
            </span>
          </>
        )}
        {after < from && (
          <>
            {' · '}
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {t('gain', { met: from, after, total: rules.total })}
            </span>
          </>
        )}
        {breaks}
        {builtFrom}
        {action && (
          <>
            {' · '}
            <Link
              href={`/dashboard/action-center/actions?action=${action.actionId}`}
              className="underline underline-offset-2 hover:no-underline"
            >
              {tSuggestions('fromAction', { no: action.actionNo! })}
            </Link>
          </>
        )}
      </>
    );
  } else if (lastRunFailed) {
    title = t('runFailed');
    line = t('runFailedLine');
  } else {
    title = t('reviewed');
    line = (
      <>
        {t('reviewedLine', { accepted, met: rules.met, total: rules.total, open: stillOpen })}
        {/* A full run's batch may have stopped short of the rules still open. */}
        {stillOpen > 0 && suggestions.length === AGENT_RUN_MAX && (
          <>
            {' · '}
            {tSuggestions('runMax', { max: AGENT_RUN_MAX })}
          </>
        )}
      </>
    );
  }

  // With the basket (Next step spec §3), the card heads with the step and
  // who takes it; what the agent left is its last run, under it. Not while
  // the agent's result waits for a decision: it heads with what it is
  // (editor test 2026-10-25: "Next · Shorten…" over a rewrite read as
  // another agent).
  const stepHead = nextShown && next?.title ? next : null;
  let lastRun: React.ReactNode = null;
  if (stepHead) {
    const run = title;
    const runLine = line;
    lastRun = t.rich('lastRun', {
      run: () => (
        <>
          {run}
          {runLine && <> · {runLine}</>}
        </>
      ),
    });
    title = (
      <>
        {t('nextTitle', { step: stepHead.title! })}
        <span className="sr-only">
          {' · '}
          {t(stepHead.actor === 'you' ? 'byYou' : 'byAgent')}
        </span>
      </>
    );
    line = stepHead.reason ?? null;
  }

  return (
    <div
      role="region"
      aria-label={page ? tRewrite('bar') : tSuggestions('bar')}
      aria-busy={working}
      className="mx-4 mt-3 mb-1 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl border bg-muted px-3.5 py-3 shadow-xs"
    >
      {/* The person's tile only with nothing of the agent's to decide: its count stays in sight.
          With Chat on, the agent at work is Chat's own avatar (Chat agentic plan §2–3). */}
      {stepHead?.actor === 'you' && open === 0 && page?.status !== 'open' ? (
        <PersonTile />
      ) : working && chatOn ? (
        <AgentAvatar state="working" decorative />
      ) : (
        <AgentTile tone={tone} count={working ? 0 : open} />
      )}
      {/* Room for a line of text first: on a narrow page the buttons go under it. */}
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-sm font-semibold [overflow-wrap:anywhere]">{title}</div>
        {line && (
          <div className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{line}</div>
        )}
        {reason && (
          <div
            id={reasonId}
            className="text-[12.5px] text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400"
          >
            {reason}
          </div>
        )}
        {lastRun && (
          <div className="text-[12px] text-muted-foreground/90 [overflow-wrap:anywhere]">
            {lastRun}
          </div>
        )}
      </div>
      {/* Working, only Stop: it drops whatever the run had. */}
      {working && onStop && run && (
        <span className="ml-auto flex shrink-0 items-center">
          <Button variant="outline" size="sm" disabled={stopping} onClick={onStop}>
            {t('stop')}
          </Button>
        </span>
      )}
      {!working && (
        <span className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {page ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={GHOST}
                disabled={busy}
                onClick={() => setComparing(true)}
              >
                {tRewrite('compare')}
              </Button>
              {page.status === 'open' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDecidePage('rejected')}
                  >
                    {tRewrite('reject')}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => onDecidePage('accepted')}>
                    {tRewrite('accept')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={GHOST}
                    disabled={busy}
                    onClick={() => onDecidePage('open')}
                  >
                    {tRewrite('undo')}
                  </Button>
                  {afterReview}
                </>
              )}
            </>
          ) : open > 0 ? (
            <>
              <Button variant="ghost" size="sm" className={GHOST} onClick={onReview}>
                {t('review')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={onRejectAll}>
                {tSuggestions('rejectAll')}
              </Button>
              <Button size="sm" disabled={busy} onClick={onAcceptAll}>
                {tSuggestions('acceptAll')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={GHOST}
                disabled={busy}
                onClick={onUndoAll}
              >
                {tSuggestions('undoAll')}
              </Button>
              {afterReview}
            </>
          )}
          {open === 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              className={GHOST}
              aria-label={tSuggestions('close')}
              title={tSuggestions('close')}
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      )}
      {page && (
        <PageCompareDialog
          suggestion={page}
          open={comparing}
          onOpenChange={setComparing}
          busy={busy}
          onDecide={onDecidePage}
          chars={pageChars}
        />
      )}
    </div>
  );
}
