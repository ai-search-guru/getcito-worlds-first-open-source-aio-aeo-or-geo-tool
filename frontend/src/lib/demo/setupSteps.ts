/**
 * The demo brand's setup as its setup screen tells it (DemoSetupDialog),
 * while POST /api/demo writes it: what the server's generator writes
 * (backend/src/lib/demo), in its order, with the counts it writes, and about
 * how long each part takes on a first build. The counts are the generator's
 * own, the same on every build (its data is seeded): change them here when a
 * module changes what it writes.
 *
 * The screen follows the plan while it waits, holds on the last step until
 * the answer comes (never showing the demo done before it is), and once it
 * comes, runs through what is left quickly.
 */

/** The made-up brand the demo shows (backend/src/lib/demo/brewline.js). */
export const DEMO_BRAND_NAME = 'Brewline Coffee';
/** The engines its answers come from (core.js: PLATFORMS). */
export const DEMO_PLATFORMS = 6;

export interface DemoSetupStep {
  key: 'brand' | 'answers' | 'citations' | 'mentions' | 'audit' | 'actions' | 'content' | 'reports';
  /** About how long it takes on a first build. */
  ms: number;
  /** What it writes, counted up while it is under way. */
  count?: number;
}

export const DEMO_SETUP_STEPS: readonly DemoSetupStep[] = [
  // core.js: the brand, its 4 competitors, 3 topics and 12 prompts.
  { key: 'brand', ms: 1200 },
  // core.js: 12 prompts on 6 engines, a run every 3 days for a month.
  { key: 'answers', ms: 3000, count: 720 },
  // core.js: the pages those answers cite.
  { key: 'citations', ms: 1500, count: 2694 },
  // core.js refresh: the Brand Visibility, Mentions and Citations rollups.
  { key: 'mentions', ms: 2500 },
  // site.js: the pages Site Audit scored.
  { key: 'audit', ms: 1500, count: 18 },
  // actionCenter.js: the actions.
  { key: 'actions', ms: 1200, count: 9 },
  // content.js: the content opportunities.
  { key: 'content', ms: 1200, count: 10 },
  // reports.js.
  { key: 'reports', ms: 900, count: 2 },
];

/** How long each step left takes once the answer came. */
export const FINISH_STEP_MS = 140;
/** How long the screen shows everything done before the demo opens. */
export const DONE_PAUSE_MS = 400;
/** Past this, the wait reads as longer than usual. */
export const SLOW_AFTER_MS = 25_000;

/** How far into its last step the screen goes while it waits. */
const HOLD = 0.9;

/**
 * Where the plan stands `elapsed` ms in, as a number of steps: 2.5 is two
 * done and the third half way. Holds in the last step.
 */
function planned(elapsed: number, steps: readonly DemoSetupStep[]): number {
  let left = Math.max(0, elapsed);
  for (let i = 0; i < steps.length; i += 1) {
    if (left < steps[i].ms) return Math.min(i + left / steps[i].ms, steps.length - 1 + HOLD);
    left -= steps[i].ms;
  }
  return steps.length - 1 + HOLD;
}

/**
 * Where the screen stands `elapsed` ms after the setup was asked, as a number
 * of steps done (DEMO_SETUP_STEPS.length when all are): on plan while the
 * answer is awaited, then, from when it came (`answered`, ms after it was
 * asked), FINISH_STEP_MS a step.
 */
export function setupPosition(
  elapsed: number,
  answered: number | null,
  steps: readonly DemoSetupStep[] = DEMO_SETUP_STEPS,
): number {
  if (answered === null || elapsed < answered) return planned(elapsed, steps);
  const from = planned(answered, steps);
  return Math.min(steps.length, from + (elapsed - answered) / FINISH_STEP_MS);
}

/**
 * How long after the answer came the demo opens: the steps left run through,
 * then everything shows done a moment.
 */
export function finishDelay(
  answered: number,
  steps: readonly DemoSetupStep[] = DEMO_SETUP_STEPS,
): number {
  return Math.ceil((steps.length - planned(answered, steps)) * FINISH_STEP_MS) + DONE_PAUSE_MS;
}

/** A step's state at `position`: done, under way (and how far, 0–1), or still to come. */
export function stepState(
  index: number,
  position: number,
): { state: 'done' | 'now' | 'next'; progress: number } {
  if (position >= index + 1) return { state: 'done', progress: 1 };
  if (position >= index) return { state: 'now', progress: position - index };
  return { state: 'next', progress: 0 };
}

/**
 * What a step's counter shows: its whole count once done, counted up (fast,
 * then slower) while under way, nothing before. With reduced motion, the
 * whole count as soon as it starts.
 */
export function stepCount(
  step: DemoSetupStep,
  index: number,
  position: number,
  reducedMotion = false,
): number | null {
  if (step.count === undefined) return null;
  const { state, progress } = stepState(index, position);
  if (state === 'next') return null;
  if (state === 'done' || reducedMotion) return step.count;
  return Math.round(step.count * (1 - (1 - progress) ** 2));
}
