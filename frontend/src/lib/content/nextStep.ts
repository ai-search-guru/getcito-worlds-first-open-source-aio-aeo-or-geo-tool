import type { QualityTodo } from './qualityTodos';
import {
  REWRITE_OPEN_RULES,
  openRulesForAgent,
  type ActiveRule,
  type RewriteAdvice,
  type RuleStatus,
} from './rules';
import { runDecided } from './triedRules';

/**
 * The Content Editor's Next step basket (Next step spec §4): the one step to
 * take now, chosen from the draft's state by rules, with no AI call; the
 * path of five steps it sits on; and the "If you see…" lines that match the
 * page now. Nothing here runs a step: the editor maps each action to the
 * button that already does it.
 */

export type NextStepId =
  | 'plan'
  | 'write'
  | 'import'
  | 'length'
  | 'fixRules'
  | 'proof'
  | 'check'
  | 'ready'
  // The agent's suggestions wait for a decision: every other step waits on them.
  | 'review';

/** What a step's buttons do: each is a button the editor already has. */
export type NextAction =
  | 'buildBrief'
  // No prompt, fan-out or Search Console query kept: the brief has nothing to build from.
  | 'addSources'
  // The first suggestion still to decide, in the page (or the rewrite's card).
  | 'review'
  | 'writeWithAgent'
  | 'writeMyself'
  | 'rewritePage'
  | 'fixRules'
  | 'pickAuthor'
  | 'addAuthor'
  | 'showTodos'
  // No to-do left, Trust still low: what Quality names that raises it.
  | 'showTrust'
  | 'beforePublish'
  | 'markReady'
  | 'export'
  // CE-013: the address the page went live at.
  | 'markPublished';

/**
 * The most open rules "If you see…" names for Fix open rules alone: from
 * REWRITE_OPEN_RULES, the Rules tab recommends rewriting the page whole, and
 * the basket offers Rewrite page beside it.
 */
export const FEW_OPEN_RULES = REWRITE_OPEN_RULES - 1;

/**
 * The open rules a run of Fix open rules can close: the ones the agent is
 * asked to fix, less a setting only the person fills (Who it's for) and
 * Length, which its own step takes once it is far off; a page a little off
 * its Length isn't sent round Fix again and again for it; and rules `held` by
 * what the page keeps word for word, which no run can close: what's left is
 * the person's, and Next moves on. Sorted keys, so Skip can tell when the
 * set changes.
 */
export function rulesForNext<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  held?: ReadonlySet<string>,
): string[] {
  return openRulesForAgent(rules, undefined, held)
    .forAgent.filter(
      ({ rule, status }) =>
        rule.key !== 'length' && !(status.state === 'bad' && status.code === 'notSet'),
    )
    .map(({ rule }) => rule.key)
    .sort();
}

export interface NextStepState {
  method: 'create' | 'optimize';
  /** Draft or in review: open to the agent and to Mark ready. */
  open: boolean;
  /** Published (not only marked ready): Ready to publish says it went out. */
  published: boolean;
  /** Whether the draft has a brief; null while it isn't read, or couldn't be. */
  hasBrief: boolean | null;
  /**
   * Whether a prompt, fan-out or Search Console query is kept to build the
   * brief from (the server's no_sources check); null while the sources
   * aren't read. With none, Plan the page asks for sources first (editor UX
   * review 2026-11-03: Build brief failed with a toast that went away).
   */
  briefSources?: boolean | null;
  /**
   * The agent's suggestions on the page still to decide (a rewrite counts
   * one): while any wait, the step is to review them, and the path shows
   * the step they're for.
   */
  waiting?: number;
  /** No words under the page's title. */
  empty: boolean;
  /** Why rewriting the page whole is recommended (rewriteAdvice), or null. */
  rewrite: RewriteAdvice | null;
  /** The open rules a Fix run can close (rulesForNext). */
  openRules: string[];
  /** Every rule on that the page doesn't meet, as the Rules tab counts them. */
  openTotal?: number;
  /**
   * The open rules a Fix run is sent (openRulesForAgent), as Rules says the
   * agent can fix them: the step's words count these (editor UX review
   * 2026-11-03), its pass the openRules above.
   */
  fixable?: number;
  /**
   * Quality's reads (Quality spec, CE-040/041): Trust under its gate (60)
   * while Quality names something that raises it (a Trust with nothing to
   * raise it is no step the person can take: editor test 2026-11-03), and
   * the to-dos only the person can do. Null while Quality is off.
   */
  quality: { trust: number | null; trustLow: boolean; todos: QualityTodo[] } | null;
  /** The steps skipped, each with the state it was skipped at (stepState). */
  skipped: Partial<Record<NextStepId, string>>;
  /**
   * The third-step steps the agent took (thirdStepTried), each with what the
   * page read then: passed while that holds (thirdStepPasses), with rules
   * still open or the Length off, and what's left is the person's in the
   * Rules tab.
   */
  thirdPasses?: ThirdPasses;
  /**
   * The agent's latest batch on the page (a Fix, a hand-off, a rewrite):
   * one a pass hasn't read yet holds it until it is read again
   * (thirdStepPasses, thirdPassesToRead).
   */
  batch?: string | null;
}

export interface NextStep {
  id: NextStepId;
  primary: NextAction;
  alternative: NextAction | null;
  /** Skip moves past it; the last steps have nothing after them. */
  skippable: boolean;
}

/** 'passed': the agent took it, and what's left is the person's (thirdStepPasses). */
export type PathState = 'done' | 'skipped' | 'passed' | 'now' | 'ahead';

export type TipId = 'longPage' | 'shortPage' | 'someRules' | 'noBrief' | 'lowTrust';

export interface NextPath {
  step: NextStep;
  /** The five steps in order (four while Quality is off). */
  path: { id: NextStepId; state: PathState }[];
  /** Up to two "If you see…" lines, each with its button, none repeating the step's own. */
  tips: { id: TipId; action: NextAction }[];
}

const openTodos = (s: NextStepState) => s.quality?.todos.filter((todo) => !todo.done) ?? [];

/**
 * A step's state as Skip remembers it: once it changes (a rule met or newly
 * open, Trust past 60, a to-do done), a skipped step comes back. Coarse on
 * purpose: which rules are open, not how far off each is, so typing a word
 * doesn't bring one back.
 */
export function stepState(id: NextStepId, s: NextStepState): string {
  switch (id) {
    case 'plan':
      return String(s.hasBrief);
    case 'write':
    case 'import':
      return String(s.empty);
    case 'length':
      return s.rewrite?.reason === 'length'
        ? s.rewrite.count > s.rewrite.target
          ? 'long'
          : 'short'
        : '';
    case 'fixRules':
      return s.openRules.join(',');
    case 'proof':
      // Not the brand facts' to-do: it joins when the brand's site is read,
      // a skip made before then holds.
      return `${s.quality?.trustLow ?? false}:${openTodos(s)
        .filter((todo) => todo.id !== 'brandFacts')
        .map((todo) => todo.key ?? todo.id)
        .join(',')}`;
    default:
      return '';
  }
}

/** The third step, as the page needs it: its Length, or its open rules. */
export type ThirdStepId = 'length' | 'fixRules';

/**
 * A run of the agent on the third step: the step it takes (a rewrite takes
 * the Length, a Fix of every rule the step counts takes Fix open rules); its kind,
 * to read how it ended once the editor opens again; when it began; the
 * latest batch on the page then; and whether it found nothing to change.
 * A run that fails, is stopped or never runs isn't one.
 */
export interface ThirdTry {
  step: ThirdStepId;
  kind: 'fix' | 'rewrite';
  /** When it began (ISO), against the run row's start. */
  at: string;
  batch: string | null;
  ended?: boolean;
}

/**
 * A third-step step the agent took, with what the page read then: the open
 * rules a Fix run can close (rulesForNext), the Length's state, and the
 * agent's latest batch on the page then (none kept by passes from before
 * it: read as one since).
 */
export interface ThirdPass {
  rules: string[];
  length: string;
  batch?: string | null;
}
export type ThirdPasses = Partial<Record<ThirdStepId, ThirdPass>>;

/**
 * Whether the agent has taken the step its run was for (editor test
 * 2026-10-26): it found nothing to change, or left a batch since and every
 * change in it is decided.
 */
export function thirdStepTried(
  attempt: ThirdTry | null,
  now: { batch: string | null; open: number; busy: boolean },
): boolean {
  return runDecided(attempt, now);
}

/** What a pass keeps of the page as it reads when the step is taken. */
export function thirdPassOf(s: NextStepState, batch: string | null = s.batch ?? null): ThirdPass {
  return { rules: s.openRules, length: stepState('length', s), batch };
}

/** A batch of the agent's on the page that the pass hasn't read: one since it was taken. */
const batchSince = (pass: ThirdPass, batch: string | null | undefined) =>
  batch !== undefined && batch !== null && pass.batch !== batch;

/**
 * The passes to read again, once the agent's batch since them is decided
 * (editor test 2026-11-03): what its own changes left open is no rule it
 * never saw, so they never bring the step back. Fix open rules passed, a
 * hand-off or another Fix from the Rules tab that opened a rule sent the
 * person round Fix again and again; only Skip moved on.
 */
export function thirdPassesToRead(
  passes: ThirdPasses,
  now: { batch: string | null; open: number; busy: boolean },
): ThirdStepId[] {
  if (now.busy || now.open > 0) return [];
  return (Object.entries(passes) as [ThirdStepId, ThirdPass | undefined][])
    .filter(([, pass]) => pass && batchSince(pass, now.batch))
    .map(([id]) => id);
}

/**
 * The steps passed that still hold: the Length reads as it did and, for Fix
 * open rules, every rule open now was open when the agent took it (one it
 * never saw brings the step back, one it couldn't close doesn't). A step
 * whose page has moved on is the agent's again. Fix open rules holds while
 * the person brings the page within its Length (#1556 review): only a
 * Length far off now, and not as it was, brings it back. While a batch of
 * the agent's since the pass waits to be decided and read
 * (thirdPassesToRead), it holds: what that batch opens is the agent's own.
 */
export function thirdStepPasses(s: NextStepState): Set<ThirdStepId> {
  const held = new Set<ThirdStepId>();
  const length = stepState('length', s);
  for (const [id, pass] of Object.entries(s.thirdPasses ?? {}) as [ThirdStepId, ThirdPass][]) {
    if (!pass) continue;
    if (batchSince(pass, s.batch)) {
      held.add(id);
      continue;
    }
    if (pass.length !== length && (id === 'length' || length !== '')) continue;
    if (id === 'fixRules' && !s.openRules.every((rule) => pass.rules.includes(rule))) continue;
    held.add(id);
  }
  return held;
}

/** The skips that still hold: one whose step's state has changed since is dropped. */
export function liveSkips(s: NextStepState): Partial<Record<NextStepId, string>> {
  return Object.fromEntries(
    Object.entries(s.skipped).filter(([id, at]) => stepState(id as NextStepId, s) === at),
  );
}

/** Each step whose state calls for it now, in the order they are checked. */
function steps(s: NextStepState): NextStep[] {
  const todos = openTodos(s);
  const byline = todos.find((todo) => todo.id === 'byline');
  const writeId = s.method === 'create' ? ('write' as const) : ('import' as const);
  // An empty page has nothing for the agent to fix or rewrite: it is written
  // first. Once the person said they'd write it, only that is left to do.
  if (s.empty && s.skipped[writeId] === stepState(writeId, s)) {
    return [{ id: writeId, primary: 'writeMyself', alternative: null, skippable: false }];
  }
  return [
    ...(s.method === 'create' && s.hasBrief === false
      ? [
          {
            id: 'plan' as const,
            primary: s.briefSources === false ? ('addSources' as const) : ('buildBrief' as const),
            alternative: null,
            skippable: true,
          },
        ]
      : []),
    ...(s.empty
      ? [
          {
            id: writeId,
            primary: 'writeWithAgent' as const,
            alternative: 'writeMyself' as const,
            skippable: true,
          },
        ]
      : []),
    ...(!s.empty && s.rewrite?.reason === 'length'
      ? [
          {
            id: 'length' as const,
            primary: 'rewritePage' as const,
            alternative: s.openRules.length > 0 ? ('fixRules' as const) : null,
            skippable: true,
          },
        ]
      : []),
    ...(!s.empty && s.openRules.length > 0
      ? [
          {
            id: 'fixRules' as const,
            primary: 'fixRules' as const,
            // Where the Rules tab recommends rewriting it whole (rewriteAdvice):
            // the two say the same, and never for a page too long to send.
            alternative: s.rewrite !== null ? ('rewritePage' as const) : null,
            skippable: true,
          },
        ]
      : []),
    ...(s.quality && (s.quality.trustLow || todos.length > 0)
      ? [
          {
            id: 'proof' as const,
            primary: byline
              ? byline.action === 'addAuthor'
                ? ('addAuthor' as const)
                : ('pickAuthor' as const)
              : todos.length > 0
                ? ('showTodos' as const)
                : ('showTrust' as const),
            alternative: null,
            skippable: true,
          },
        ]
      : []),
  ];
}

/** The agent's suggestions waiting: the step until each is decided. */
const REVIEW: NextStep = { id: 'review', primary: 'review', alternative: null, skippable: false };

/**
 * The step to take now (the first whose state calls for it and that wasn't
 * skipped at that state), the path, and the tips. A page marked ready or
 * published is ready to publish: Export; marked ready, Mark published beside
 * it, for its live address (CE-013). Its path still shows a step it was
 * marked ready past as skipped, not done (editor UX review 2026-11-03).
 * While the agent's suggestions wait, the step is to review them; the path
 * stays on the step they're for.
 */
export function nextStep(s: NextStepState): NextPath {
  const due = steps(s);
  const check: NextStep = s.open
    ? {
        id: 'check',
        primary: s.quality ? 'beforePublish' : 'markReady',
        alternative: null,
        skippable: false,
      }
    : {
        id: 'ready',
        primary: 'export',
        alternative: s.published ? null : 'markPublished',
        skippable: false,
      };
  const passes = thirdStepPasses(s);
  const tried = (id: NextStepId) => passes.has(id as ThirdStepId);
  const under = s.open
    ? (due.find((d) => !tried(d.id) && (!d.skippable || s.skipped[d.id] !== stepState(d.id, s))) ??
      check)
    : check;
  const reviewing = s.open && (s.waiting ?? 0) > 0;
  const step = reviewing ? REVIEW : under;

  // The third step is the one the page needs: its Length, or its open rules
  // (an empty page, its title alone, isn't read against its Length).
  const third: NextStepId =
    under.id === 'length' || under.id === 'fixRules'
      ? under.id
      : !s.empty && s.rewrite?.reason === 'length'
        ? 'length'
        : 'fixRules';
  const ids: NextStepId[] = [
    'plan',
    s.method === 'create' ? 'write' : 'import',
    third,
    ...(s.quality ? (['proof'] as const) : []),
    'check',
  ];
  const now = under.id === 'ready' ? ids.length : ids.indexOf(under.id);
  const calledFor = new Set(due.map((d) => d.id));
  const path = ids.map((id, i) => ({
    id,
    state: (i === now
      ? 'now'
      : i > now
        ? 'ahead'
        : // Passed while its state still calls for it: it was skipped,
          // unless the agent took it.
          calledFor.has(id)
          ? tried(id)
            ? 'passed'
            : 'skipped'
          : 'done') as PathState,
  }));

  const tips: NextPath['tips'] =
    s.open && !s.empty && !reviewing
      ? [
          ...(s.rewrite?.reason === 'length'
            ? [
                {
                  id:
                    s.rewrite.count > s.rewrite.target
                      ? ('longPage' as const)
                      : ('shortPage' as const),
                  action: 'rewritePage' as const,
                },
              ]
            : []),
          ...(s.openRules.length > 0 && s.rewrite === null
            ? [{ id: 'someRules' as const, action: 'fixRules' as const }]
            : []),
          ...(s.method === 'create' && s.hasBrief === false
            ? [{ id: 'noBrief' as const, action: 'buildBrief' as const }]
            : []),
          ...(s.quality?.trustLow
            ? [{ id: 'lowTrust' as const, action: 'showTrust' as const }]
            : []),
        ]
          .filter((tip) => tip.action !== step.primary)
          .slice(0, 2)
      : [];

  return { step, path, tips };
}

/**
 * The steps passed with something still open: skipped, or taken by the agent
 * with what's left the person's. "Every step is done" only with none.
 */
export function stepsLeft(path: NextPath['path']): number {
  return path.filter((p) => p.state === 'skipped' || p.state === 'passed').length;
}
