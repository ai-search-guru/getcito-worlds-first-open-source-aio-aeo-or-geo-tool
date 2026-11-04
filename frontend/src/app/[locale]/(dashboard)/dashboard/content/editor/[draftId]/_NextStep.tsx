'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { AgentRun } from '@/lib/content/agentRuns';
import {
  FEW_OPEN_RULES,
  stepsLeft,
  type NextAction,
  type NextPath,
  type NextStep,
  type NextStepId,
  type NextStepState,
  type PathState,
  type ThirdPasses,
  type ThirdTry,
} from '@/lib/content/nextStep';
import { cn } from '@/lib/utils';
import { RunSteps } from './_AgentCard';
import { TRUST_GATE } from './_BeforePublish';
import { WorkingDots } from './_WorkingDots';

/**
 * The Next step basket (Next step spec §2–3): the header's "Next · {step}"
 * button, with the path as small bars, opens it as a popover under the
 * header. It names the one step to take now, why (from the page's own
 * numbers), its button and at most one other, Skip, the path of five
 * steps, and up to two "If you see…" lines. Each button is one the editor
 * already has; the basket only says which to use now. While the agent
 * works, it shows the run's step and Stop instead.
 */

/** The steps skipped on this draft, in this browser (Skip, spec §4). */
const skipsKey = (draftId: string) => `aeo:next-step-skips:${draftId}`;

export function readSkips(draftId: string): Partial<Record<NextStepId, string>> {
  try {
    const read = JSON.parse(localStorage.getItem(skipsKey(draftId)) ?? 'null') as unknown;
    if (read && typeof read === 'object') return read as Partial<Record<NextStepId, string>>;
  } catch {
    // Storage unavailable (private mode) or unreadable: nothing skipped.
  }
  return {};
}

export function writeSkips(draftId: string, skips: Partial<Record<NextStepId, string>>) {
  try {
    localStorage.setItem(skipsKey(draftId), JSON.stringify(skips));
  } catch {
    // Skipped for this visit only.
  }
}

/**
 * The agent on the third step on this draft, in this browser: the run under
 * way or waiting for a decision (thirdStepTried), and the steps it took with
 * what the page read then (thirdStepPasses). An attempt kept before these
 * (#1550's, with no step) is read as none.
 */
export interface ThirdStepStore {
  attempt: ThirdTry | null;
  passes: ThirdPasses;
}
const NO_THIRD_STEP: ThirdStepStore = { attempt: null, passes: {} };
const thirdTryKey = (draftId: string) => `aeo:next-step-third-try:${draftId}`;

export function readThirdStep(draftId: string): ThirdStepStore {
  try {
    const read = JSON.parse(localStorage.getItem(thirdTryKey(draftId)) ?? 'null') as {
      attempt?: unknown;
      passes?: unknown;
    } | null;
    if (read && typeof read === 'object' && 'passes' in read) {
      const attempt = read.attempt as ThirdTry | null;
      return {
        attempt: attempt && typeof attempt === 'object' && 'step' in attempt ? attempt : null,
        passes: read.passes && typeof read.passes === 'object' ? (read.passes as ThirdPasses) : {},
      };
    }
  } catch {
    // Storage unavailable (private mode) or unreadable: none taken.
  }
  return NO_THIRD_STEP;
}

export function writeThirdStep(draftId: string, store: ThirdStepStore) {
  try {
    if (store.attempt || Object.keys(store.passes).length) {
      localStorage.setItem(thirdTryKey(draftId), JSON.stringify(store));
    } else {
      localStorage.removeItem(thirdTryKey(draftId));
    }
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Words besides the page's title: a page with none is empty (Write the first
 * draft). The title is read from the block draftTitleFromDoc picks: the
 * first H1 with words, else the first heading, else the first block with
 * words; an empty line or an image above it changes nothing.
 */
export function wordsUnderTitle(html: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = html;
  const blocks = Array.from(template.content.children);
  const words = (el: Element) => /\S/.test(el.textContent ?? '');
  const title =
    blocks.find((el) => el.matches('h1') && words(el)) ??
    blocks.find((el) => el.matches('h1, h2, h3, h4, h5, h6') && words(el)) ??
    blocks.find(words);
  title?.remove();
  return /\S/.test(template.content.textContent ?? '');
}

export type T = ReturnType<typeof useTranslations<'contentEditor.editor.nextStep'>>;

/** A step's name: the Length step says which way the page is off. */
export function stepName(t: T, id: NextStepId, state: NextStepState): string {
  if (id === 'review') return t('steps.review', { count: state.waiting ?? 0 });
  if (id === 'length' && state.rewrite?.reason === 'length') {
    return state.rewrite.count > state.rewrite.target
      ? t('steps.lengthLong')
      : t('steps.lengthShort');
  }
  return id === 'length' ? t('steps.lengthLong') : t(`steps.${id}`);
}

/** Who takes a step: the agent's run, or the person (their to-dos, their checks, their words). */
const AGENT_ACTIONS: ReadonlySet<NextAction> = new Set([
  'buildBrief',
  'writeWithAgent',
  'rewritePage',
  'fixRules',
]);
export function stepActor(step: NextStep): 'agent' | 'you' {
  return AGENT_ACTIONS.has(step.primary) ? 'agent' : 'you';
}

/**
 * Fix open rules' reason: the rules a run can close, and the others the
 * Rules tab counts as open (Length, a setting only the person fills, rules
 * held by quoted passages), so the two never seem to disagree.
 */
function fixRulesReason(t: T, state: NextStepState): string {
  const count = state.fixable ?? state.openRules.length;
  const total = Math.max(state.openTotal ?? count, count);
  // The open rules counted once, as Rules counts them (editor UX review
  // 2026-11-03: "9 rules" here beside "10 open" there read as two numbers).
  return total > count
    ? t('reasons.fixRulesSplit', { total, count, others: total - count })
    : t('reasons.fixRules', { count });
}

/** Why the step is next, from the page's own numbers. */
export function stepReason(
  t: T,
  step: NextStep,
  state: NextStepState,
  todoLine: string | null,
  /** The path, for a page marked ready with steps left: "Every step is done" only with none. */
  path?: NextPath['path'],
): string {
  const { id } = step;
  switch (id) {
    case 'review':
      return t('reasons.review', { count: state.waiting ?? 0 });
    case 'plan':
      return step.primary === 'addSources' ? t('reasons.planNoSources') : t('reasons.plan');
    case 'length':
      return state.rewrite?.reason === 'length'
        ? t('reasons.length', { count: state.rewrite.count, target: state.rewrite.target })
        : fixRulesReason(t, state);
    case 'fixRules':
      return fixRulesReason(t, state);
    case 'write':
    case 'import':
      // Once the person said they'd write it, the step is theirs.
      return step.primary === 'writeMyself' ? t('reasons.writeMine') : t(`reasons.${id}`);
    case 'proof': {
      const trust = state.quality?.trust;
      if (state.quality?.trustLow && trust !== null && trust !== undefined) {
        return todoLine
          ? t('reasons.proofTrustTodo', { trust, gate: TRUST_GATE, todo: todoLine })
          : t('reasons.proofTrust', { trust, gate: TRUST_GATE });
      }
      return t('reasons.proofTodo', { todo: todoLine ?? '' });
    }
    case 'check':
      return state.quality ? t('reasons.check', { gate: TRUST_GATE }) : t('reasons.checkRules');
    case 'ready': {
      const left = path ? stepsLeft(path) : 0;
      if (left > 0) {
        return t(state.published ? 'reasons.publishedLeft' : 'reasons.readyLeft', { count: left });
      }
      return state.published ? t('reasons.published') : t('reasons.ready');
    }
  }
}

/**
 * Done, or taken by the agent with what's left the person's: either reads
 * as behind the page (editor test 2026-11-03: a step the agent took, shown
 * like one ahead, read as never done).
 */
const behind = (state: PathState) => state === 'done' || state === 'passed';

/** The path as small bars: done, the one now, and those ahead. */
function Bars({ path, className }: { path: NextPath['path']; className?: string }) {
  return (
    <span aria-hidden className={cn('flex items-center gap-[3px]', className)}>
      {path.map((p) => (
        <i
          key={p.id}
          className={cn(
            'block h-1.5 w-2.5 rounded-full',
            behind(p.state)
              ? 'bg-foreground'
              : p.state === 'now'
                ? 'bg-foreground/60'
                : 'bg-foreground/15',
          )}
        />
      ))}
    </span>
  );
}

const PATH_DOT: Record<PathState, string> = {
  done: 'bg-foreground text-background',
  now: 'bg-foreground/10 text-foreground ring-1 ring-foreground',
  skipped: 'bg-muted text-muted-foreground',
  passed: 'bg-foreground text-background',
  ahead: 'bg-muted text-muted-foreground',
};

export function NextStepButton({
  next,
  state,
  todoLine,
  open,
  onOpenChange,
  focusOnOpen,
  onAction,
  onSkip,
  blocked,
  working,
  raises = [],
  cost = null,
}: {
  next: NextPath;
  state: NextStepState;
  /** The first open to-do as "pick the page's author", for the proof step's reason. */
  todoLine: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened by a click: focus moves in. Opened by itself (a new draft): it doesn't. */
  focusOnOpen: boolean;
  onAction: (action: NextAction) => void;
  onSkip: (id: NextStepId) => void;
  /** Why an action can't run now (another run, suggestions to decide), or null. */
  blocked: (action: NextAction) => string | null;
  /** The agent's run under way from this page, with Stop; null while none. */
  working: { run: AgentRun | null; onStop: () => void; stopping: boolean } | null;
  /**
   * What raises the score on this step, the most first: each with its points
   * ("+15 E-E-A-T"), or none for a rule the agent closes.
   */
  raises?: { line: string; gain: string | null }[];
  /**
   * The agent's step, typically: about how many minutes, and the share of
   * the month's AI usage (null on an unlimited plan, or while unread).
   */
  cost?: { minutes: number; percent: number | null } | null;
}) {
  const t = useTranslations('contentEditor.editor.nextStep');
  const { step, path, tips } = next;
  const name = stepName(t, step.id, state);
  const now = path.findIndex((p) => p.state === 'now');
  const why = blocked(step.primary);
  const whyAlternative = step.alternative ? blocked(step.alternative) : null;
  const whyId = useId();
  // After Skip, the new step's button takes focus (Skip itself may be gone).
  const primaryRef = useRef<HTMLButtonElement>(null);
  const skipped = useRef(false);
  useEffect(() => {
    if (!skipped.current) return;
    skipped.current = false;
    primaryRef.current?.focus();
  }, [step.id]);

  const actor = stepActor(step);
  const path_ = (
    <ol aria-label={t('path')} className="space-y-1.5">
      {path.map((p, i) => (
        <li
          key={p.id}
          aria-current={p.state === 'now' ? 'step' : undefined}
          className={cn(
            'flex items-start gap-2 text-[13px]',
            p.state === 'done' && 'text-muted-foreground line-through',
            p.state === 'now' && 'font-medium',
            (p.state === 'ahead' || p.state === 'skipped' || p.state === 'passed') &&
              'text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold no-underline',
              PATH_DOT[p.state],
            )}
          >
            {behind(p.state) ? <Check className="h-2.5 w-2.5" /> : i + 1}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {/* A step the agent took is crossed out as a done one is; its
                note, the person's part, isn't (editor test 2026-10-27). */}
            <span className={cn(p.state === 'passed' && 'line-through')}>
              {stepName(t, p.id, state)}
            </span>
            {(p.state === 'skipped' || p.state === 'passed') && (
              <span aria-hidden className="block text-xs no-underline">
                {t(p.state).replace(/^· /, '')}
              </span>
            )}
            <span className="sr-only"> · {t(`states.${p.state}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label={t('button', { step: name })}
        title={t('button', { step: name })}
      >
        <Bars path={path} />
        <span>{t('short')}</span>
        {/* The step's name where there's room (§3b: "Next" with the bars at 1024px). */}
        <span className="hidden max-w-48 truncate xl:inline">
          {t('buttonStep', { step: name })}
        </span>
      </DialogTrigger>
      {/* One large window in the page's middle (the user, 2026-11-03): every
          step on the left, the one to take on the right with why, what
          raises the score, who takes it and its one button. */}
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
        initialFocus={focusOnOpen ? primaryRef : undefined}
      >
        <div className="grid max-h-[calc(100dvh-4rem)] overflow-y-auto md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="space-y-3 border-b bg-muted/40 p-5 md:border-r md:border-b-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t('label')}
              </span>
              <Bars path={path} className="ml-auto" />
            </div>
            <p className="text-xs text-muted-foreground">
              {now >= 0
                ? t('stepOf', { n: now + 1, total: path.length })
                : stepsLeft(path) > 0
                  ? t('stepsLeft', { count: stepsLeft(path) })
                  : t('allDone')}
            </p>
            {path_}
          </aside>

          <section className="min-w-0 space-y-4 p-5 pr-12">
            {working ? (
              <div className="space-y-3">
                <DialogTitle className="flex items-center text-lg">
                  {t('working')}
                  <WorkingDots />
                </DialogTitle>
                {working.run && <RunSteps run={working.run} />}
                {working.run && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working.stopping}
                    onClick={working.onStop}
                  >
                    {t('stop')}
                  </Button>
                )}
              </div>
            ) : (
              // A step that changes (Skip, a run's end) is read out.
              <div className="space-y-4" aria-live="polite">
                <div className="space-y-1.5">
                  <span
                    className={cn(
                      'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                      actor === 'agent'
                        ? 'border-primary/30 text-foreground'
                        : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
                    )}
                  >
                    {t(actor === 'agent' ? 'byAgent' : 'byYou')}
                  </span>
                  <DialogTitle className="text-lg">{name}</DialogTitle>
                  <DialogDescription className="text-sm [overflow-wrap:anywhere]">
                    {stepReason(t, step, state, todoLine, path)}
                  </DialogDescription>
                  {actor === 'agent' && cost && (
                    <p className="text-xs text-muted-foreground">
                      {cost.percent === null
                        ? t('costTime', { minutes: cost.minutes })
                        : t('cost', {
                            minutes: cost.minutes,
                            percent: cost.percent >= 1 ? `${Math.round(cost.percent)}%` : `<1%`,
                          })}
                    </p>
                  )}
                </div>

                {raises.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">
                      {t('raisesTitle')}
                    </h4>
                    <ul className="space-y-1.5">
                      {raises.slice(0, 5).map((raise) => (
                        <li
                          key={raise.line}
                          className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]"
                        >
                          {raise.gain && (
                            <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 tabular-nums dark:bg-emerald-950 dark:text-emerald-300">
                              {raise.gain}
                            </span>
                          )}
                          <span className="min-w-0 [overflow-wrap:anywhere]">{raise.line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    ref={primaryRef}
                    disabled={why !== null}
                    aria-describedby={why ? whyId : undefined}
                    onClick={() => onAction(step.primary)}
                  >
                    {t(`actions.${step.primary}`)}
                  </Button>
                  {step.alternative && (
                    <Button
                      variant="outline"
                      disabled={whyAlternative !== null}
                      aria-describedby={!why && whyAlternative ? whyId : undefined}
                      onClick={() => onAction(step.alternative!)}
                    >
                      {t(`actions.${step.alternative}`)}
                    </Button>
                  )}
                  {step.skippable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-muted-foreground"
                      onClick={() => {
                        skipped.current = true;
                        onSkip(step.id);
                      }}
                    >
                      {t('skip')}
                    </Button>
                  )}
                </div>
                {/* The step's own button first; else why the other one is held
                    (Mark published on an archived page). */}
                {(why ?? whyAlternative) && (
                  <p
                    id={whyId}
                    className="text-xs text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400"
                  >
                    {why ?? whyAlternative}
                  </p>
                )}
              </div>
            )}

            {/* The lines' buttons start runs: none while one is under way. */}
            {tips.length > 0 && !working && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {t('tipsTitle')}
                </p>
                {tips.map((tip) => (
                  <p key={tip.id} className="text-[13px] text-muted-foreground">
                    {t('tipLine', {
                      state: t(`tips.${tip.id}`, { gate: TRUST_GATE, max: FEW_OPEN_RULES }),
                    })}{' '}
                    <button
                      type="button"
                      disabled={blocked(tip.action) !== null}
                      onClick={() => onAction(tip.action)}
                      className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                    >
                      {t(`actions.${tip.action}`)}
                    </button>
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
