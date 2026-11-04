/**
 * The Content Agent's runs, step by step (Content Editor v1.1, CE-027 and
 * CE-035; content_agent_runs, 00249): the server writes each run's steps as
 * it reaches them, named by the data they use, and the editor shows them while
 * it works, with Stop.
 */

export const RUN_STEP_KEYS = [
  'read_rules',
  // Quality's hand-off (CE-051): the page's checks instead of its rules.
  'read_checks',
  'gather_sources',
  'write_changes',
  'rewrite_page',
  'write_page',
  'write_outline',
  'match_fanouts',
  'check_sources',
] as const;
export type RunStepKey = (typeof RUN_STEP_KEYS)[number];

export interface RunStep {
  key: RunStepKey;
  /** How many of what it reads ("20 cited pages"), or null. */
  count: number | null;
  /** Why its writing step left nothing (contentAgent.js emptyWhy), once done. */
  why?: 'none' | 'locked' | 'dropped';
  /**
   * Its rules step's rules whose changes people at the brand mostly reject,
   * kept small (learning B6), as rule keys.
   */
  careful?: string[];
  /**
   * Its sources step's live page (learning B5): how often tracked AI answers
   * cited it in its last `days` and the days before, and the prompts it lost.
   */
  live?: { days: number; citations: number; before: number; lost: number };
}

export type AgentRunKind = 'fix' | 'rewrite' | 'write' | 'brief' | 'handoff';

export interface AgentRun {
  id: string;
  kind: AgentRunKind;
  steps: RunStep[];
  /** The step under way; steps.length once done. */
  step: number;
  startedAt: string;
  finishedAt: string | null;
  stoppedAt: string | null;
  outcome: 'done' | 'stopped' | 'failed' | null;
}

/**
 * How long a run may say it is under way: the longest model call (three
 * minutes, contentWriter.js) and a margin. One older was left by a server
 * that stopped, and is no run under way.
 */
export const RUN_STALE_MS = 10 * 60_000;

/** A step's live page as stored, when every number is one. */
function liveOf(value: unknown): { live?: RunStep['live'] } {
  if (!value || typeof value !== 'object') return {};
  const { days, citations, before, lost } = value as Record<string, unknown>;
  const whole = [days, citations, before, lost].every(
    (n) => Number.isInteger(n) && (n as number) >= 0,
  );
  return whole
    ? {
        live: {
          days: days as number,
          citations: citations as number,
          before: before as number,
          lost: lost as number,
        },
      }
    : {};
}

/** A run as stored, or null when it isn't one the editor can show. */
export function agentRunFrom(row: Record<string, unknown> | null): AgentRun | null {
  if (!row || typeof row.id !== 'string' || !Array.isArray(row.steps)) return null;
  const keys: readonly string[] = RUN_STEP_KEYS;
  const steps = (row.steps as Partial<RunStep>[]).flatMap((s) =>
    keys.includes(s?.key as string)
      ? [
          {
            key: s.key as RunStepKey,
            count: Number.isInteger(s.count) ? (s.count as number) : null,
            ...(s.why === 'none' || s.why === 'locked' || s.why === 'dropped'
              ? { why: s.why }
              : {}),
            ...(Array.isArray(s.careful) && s.careful.some((k) => typeof k === 'string' && k)
              ? { careful: s.careful.filter((k) => typeof k === 'string' && k).slice(0, 5) }
              : {}),
            ...liveOf(s.live),
          },
        ]
      : [],
  );
  const kind = row.kind;
  if (!steps.length || !['fix', 'rewrite', 'write', 'brief', 'handoff'].includes(kind as string)) {
    return null;
  }
  const outcome = row.outcome;
  return {
    id: row.id,
    kind: kind as AgentRun['kind'],
    steps,
    step: Number.isInteger(row.step) ? Math.min(row.step as number, steps.length) : 0,
    startedAt: String(row.started_at ?? ''),
    finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
    stoppedAt: typeof row.stopped_at === 'string' ? row.stopped_at : null,
    outcome: outcome === 'done' || outcome === 'stopped' || outcome === 'failed' ? outcome : null,
  };
}

/** Whether a run is still under way: not finished, and not one a stopped server left. */
export function runUnderWay(run: AgentRun | null, now = Date.now()): boolean {
  if (!run || run.finishedAt) return false;
  const started = Date.parse(run.startedAt);
  return Number.isFinite(started) && now - started < RUN_STALE_MS;
}

/** Whether two reads of a run show the same: a read that changed nothing redraws nothing. */
export function sameRun(a: AgentRun | null, b: AgentRun | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.step === b.step &&
    a.finishedAt === b.finishedAt &&
    a.stoppedAt === b.stoppedAt &&
    JSON.stringify(a.steps) === JSON.stringify(b.steps)
  );
}

/**
 * The steps a run shows: a step about data it has none of ("Checking 0
 * Search Console queries") says nothing, and is left out.
 */
export function shownSteps(run: AgentRun): { step: RunStep; index: number }[] {
  return run.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.count !== 0 || step.key === 'write_changes');
}

/** A step's message key: with its count, or the one without. */
export function stepMessage(step: RunStep): { key: string; count?: number } {
  const name = step.key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  return step.count === null ? { key: `${name}Any` } : { key: name, count: step.count };
}
