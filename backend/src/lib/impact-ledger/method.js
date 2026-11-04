/**
 * The impact ledger's method (CHAT-22 §2 items 6–11): what a shipped change
 * did, read at 7, 14, 30 and 90 days against a control set, from tracking
 * data already collected: the Insights rollups, which hold the scheduled
 * runs and also any run someone started by hand (Run on a prompt). Nothing
 * here asks an engine or a model (Addendum 2 G). Pure: no database, no
 * clock; the job (job.js) reads the rows and writes what this returns.
 *
 *   * Windows: the baseline is the 14 days before ship; a checkpoint reads
 *     the latest 14 days ending on it, or every day since ship when fewer
 *     have passed (day 7: days 1–7, day 14: 1–14, day 30: 17–30, day 90:
 *     77–90). The ship day itself is in neither.
 *   * Cells: prompt × engine × location, from the Insights rollups
 *     (insights_prompt_daily). A cell's runs are its tracked days. Each day
 *     counts once, as the share of that day's answers naming or citing the
 *     brand (visibility) or citing it (citations), so a day with extra runs
 *     by hand weighs no more and reads no likelier to be "seen" than a day
 *     of one scheduled answer; the cell's rate is the mean of its days. A
 *     cell needs MIN_RUNS days in the baseline and in the checkpoint window.
 *   * Strata: engine × location × baseline band (BAND_PTS-wide slices of
 *     the cell's own baseline). Targets and controls are compared inside a
 *     stratum only, so an engine-wide swing, or a level's own drift, reads
 *     the same for both whatever their mix.
 *   * Controls (item 7): the brand's other active prompts, never a target of
 *     a change shipped in the window, in a target cell's stratum (on
 *     visibility), the same topic first. Fewer than MIN_CONTROL_CELLS, or
 *     than MIN_CONTROL_PROMPTS prompts (one prompt on ten engines is one
 *     control, however many cells): Not measurable.
 *   * Effect (item 8): a difference in differences, stratified: each cell's
 *     change minus its stratum's mean control change, averaged per prompt;
 *     the effect is the target prompts' mean. A target cell with no control
 *     in its stratum is left out. The controls' before and after are
 *     weighted as the targets are spread over the strata, so the row's
 *     numbers add up: effect = (after − before) − (control after − control
 *     before).
 *   * Uncertainty (item 9), by re-randomizing prompts and measuring again:
 *     RESAMPLES reshuffles of which prompts are targets and which controls,
 *     the strata's control means computed afresh each time, tested on the
 *     studentized difference of the two groups' residuals (studentized),
 *     for the p-value; and a bootstrap that resamples the target and the
 *     control prompts and measures the effect again, for the 90% interval
 *     (none from fewer than MIN_INTERVAL_PROMPTS target prompts). Only the
 *     cells in strata holding both a target and a control take part
 *     (measuredUnits). Both seeded, so the same rows always give the same
 *     result.
 *   * Outcome and confidence (item 10) in the one vocabulary: Pending (day 7
 *     shows a direction only), Improved, No meaningful change, Declined, Not
 *     measurable. Judged on the unrounded effect and p; stored rounded. A
 *     verdict and each confidence also need target prompts, not only cells
 *     (one prompt on ten engines is one piece of evidence ten times): from
 *     day 14, fewer than VERDICT_TARGET_PROMPTS is Not measurable
 *     (too_few_prompts), whatever the cells; day 7 still shows a direction.
 *     A Not measurable checkpoint keeps its before and after numbers and
 *     its counts, never an effect, p-value, interval or direction.
 */

/** The checkpoints, in order (Addendum 2 F). */
export const CHECKPOINTS = Object.freeze([
  { key: 'd7', day: 7 },
  { key: 'd14', day: 14 },
  { key: 'd30', day: 30 },
  { key: 'd90', day: 90 },
]);

/** Days of baseline before ship, and the longest checkpoint window. */
export const BASELINE_DAYS = 14;
export const WINDOW_DAYS = 14;
/** The minimum meaningful change, in points (config, item 10). */
export const MIN_EFFECT_PTS = 3;
/** p below it gives a verdict (Improved / Declined) and Medium confidence. */
export const P_VERDICT = 0.2;
/** p below it, with HIGH_TARGET_CELLS and HIGH_TARGET_PROMPTS, gives High confidence. */
export const P_HIGH = 0.05;
/** Tracked days a cell needs in the baseline and in the checkpoint window. */
export const MIN_RUNS = 3;
/** Fewest control cells a checkpoint is compared with. */
export const MIN_CONTROL_CELLS = 10;
/**
 * Fewest control prompts they come from: the prompt is the unit of
 * evidence, for controls as for targets (VERDICT_TARGET_PROMPTS).
 */
export const MIN_CONTROL_PROMPTS = 3;
/** Target cells High, and Medium, confidence need. */
export const HIGH_TARGET_CELLS = 10;
export const MEDIUM_TARGET_CELLS = 5;
/**
 * Target prompts a verdict, Medium and High confidence need (beside the
 * cells). Fewer than VERDICT_TARGET_PROMPTS from day 14: Not measurable
 * (too_few_prompts).
 */
export const VERDICT_TARGET_PROMPTS = 3;
export const MEDIUM_TARGET_PROMPTS = 5;
export const HIGH_TARGET_PROMPTS = 10;
/** Target prompts an interval is read from: none from one. */
export const MIN_INTERVAL_PROMPTS = 2;
/** Share of a bootstrap's resamples that must be measurable for an interval. */
export const MIN_BOOTSTRAP_SHARE = 0.5;
/** A stratum's baseline band, in points: 0–9.9, 10–19.9 … 90–100. */
export const BAND_PTS = 10;
/** Another change shipped on this share of the targets makes a checkpoint Not measurable. */
export const OVERLAP_SHARE = 0.5;
/** Most prompts a change is measured on (item 2). */
export const MAX_TARGET_PROMPTS = 50;
/** Most control cells kept (impact_control_sets.entities stays well under its 200 kB). */
export const MAX_CONTROL_CELLS = 1000;
/** Reshuffles of the permutation test, and resamples of the bootstrap. */
export const RESAMPLES = 1000;
/** The platforms API-model answers are stored under (the tracking worker's resolveModelPlatform). */
export const API_PLATFORMS = Object.freeze(['chatgpt', 'claude', 'gemini']);

/** The verdicts: what a checkpoint from day 14 says. */
export const VERDICTS = Object.freeze(['improved', 'no_meaningful_change', 'declined']);

const DAY_MS = 86_400_000;

// ─── Days and windows ───────────────────────────────────────────────────────

/** A timestamp's UTC day, as YYYY-MM-DD. */
export function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day `n` days later (earlier when negative). */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A checkpoint's windows: the baseline (the BASELINE_DAYS before the ship
 * day) and the latest WINDOW_DAYS ending on the checkpoint, from day 1 at
 * the earliest.
 *
 * @returns {{ pre_start: string, pre_end: string, post_start: string, post_end: string }}
 */
export function checkpointWindow(shippedAt, day) {
  const ship = utcDay(shippedAt);
  return {
    pre_start: addDays(ship, -BASELINE_DAYS),
    pre_end: addDays(ship, -1),
    post_start: addDays(ship, Math.max(1, day - WINDOW_DAYS + 1)),
    post_end: addDays(ship, day),
  };
}

/** When a checkpoint can be read: the UTC midnight after its last day ends. */
export function checkAt(shippedAt, day) {
  return `${addDays(utcDay(shippedAt), day + 1)}T00:00:00.000Z`;
}

/**
 * The checkpoints due now that a measurement hasn't read yet, oldest first:
 * those after the latest it has, whose day has ended. A measurement seeded
 * late reads every one passed (day 7 and day 14, say), each on its own
 * window.
 */
export function dueCheckpoints(checkpointsJson, shippedAt, now) {
  const done = new Set((checkpointsJson ?? []).map((entry) => entry?.checkpoint));
  let last = -1;
  CHECKPOINTS.forEach((cp, index) => {
    if (done.has(cp.key)) last = index;
  });
  return CHECKPOINTS.slice(last + 1).filter(
    (cp) => now.getTime() >= Date.parse(checkAt(shippedAt, cp.day)),
  );
}

/** When the job comes back after a checkpoint: the next one's checkAt, null after day 90. */
export function nextCheckAt(shippedAt, afterKey) {
  const index = CHECKPOINTS.findIndex((cp) => cp.key === afterKey);
  const next = CHECKPOINTS[index + 1];
  return next ? checkAt(shippedAt, next.day) : null;
}

/** Whether a timestamp's day falls inside a window (both ends included). */
export function shippedInWindow(shippedAt, window) {
  const day = utcDay(shippedAt);
  return day >= window.pre_start && day <= window.post_end;
}

// ─── Engines and cells ──────────────────────────────────────────────────────

/**
 * Whether an answer's engine is on the plan (§2 item 15): API models only
 * when the plan lists them (allowedModels), scrapers only those it lists
 * (allowedScrapers); a plan that lists none has them all (Growth's
 * scrapers, self-hosted's everything), as the web's plan-engines reads it.
 */
export function engineOnPlan(limits, row) {
  if (API_PLATFORMS.includes(row.platform)) {
    const models = limits?.allowedModels;
    return !Array.isArray(models) || models.includes(row.model_used);
  }
  const scrapers = limits?.allowedScrapers;
  return !Array.isArray(scrapers) || scrapers.includes(row.platform);
}

/** A cell's key: prompt × engine × location. */
export function cellKey(row) {
  return `${row.prompt_id}|${row.platform ?? ''}|${row.region ?? ''}`;
}

/**
 * One window's rollup rows as cells: on the plan's engines, each with its
 * tracked days (runs), and the sums over those days of the share of each
 * day's answers naming or citing the brand (visible) and citing it
 * (cited). Two rows of a day (a model changed mid-day) are one run, their
 * answers added. A row the daily refresh hasn't rewritten since 00130 (no
 * answer counts yet) reads as one answer, named when the day was.
 * `offPlan` holds the prompts with answers only on engines off the plan.
 *
 * @param {Array<{ day: string, prompt_id: string, platform: string|null, model_used: string|null,
 *   region: string|null, answer_count?: number, mentioning_answers?: number|null,
 *   citation_answers?: number|null, has_mention: boolean, has_citation: boolean }>} rows
 * @returns {{ cells: Map<string, { promptId: string, platform: string|null, region: string|null,
 *   runs: number, visible: number, cited: number }>, offPlan: Set<string> }}
 */
export function aggregateCells(rows, limits) {
  const byCell = new Map();
  const offPlan = new Set();
  for (const row of rows) {
    if (!engineOnPlan(limits, row)) {
      offPlan.add(row.prompt_id);
      continue;
    }
    const key = cellKey(row);
    let cell = byCell.get(key);
    if (!cell) {
      cell = {
        promptId: row.prompt_id,
        platform: row.platform ?? null,
        region: row.region ?? null,
        days: new Map(),
      };
      byCell.set(key, cell);
    }
    const answers = Number(row.answer_count) || 0;
    const counted = answers > 0 && row.mentioning_answers != null && row.citation_answers != null;
    const day = cell.days.get(row.day) ?? { answers: 0, named: 0, cited: 0 };
    day.answers += counted ? answers : 1;
    day.named += counted
      ? Number(row.mentioning_answers)
      : row.has_mention || row.has_citation
        ? 1
        : 0;
    day.cited += counted ? Number(row.citation_answers) : row.has_citation ? 1 : 0;
    cell.days.set(row.day, day);
  }
  const cells = new Map();
  for (const [key, { days, ...cell }] of byCell) {
    let visible = 0;
    let cited = 0;
    for (const day of days.values()) {
      visible += day.named / day.answers;
      cited += day.cited / day.answers;
    }
    cells.set(key, { ...cell, runs: days.size, visible, cited });
  }
  for (const cell of cells.values()) offPlan.delete(cell.promptId);
  return { cells, offPlan };
}

/** A cell's rate in points: visibility (named or cited) or citations. */
export function rate(cell, metric) {
  return ((metric === 'citations' ? cell.cited : cell.visible) / cell.runs) * 100;
}
/** A rate's baseline band: 0 for 0–9.9 points … 9 for 90–100. */
export function bandOf(points) {
  return Math.min(9, Math.floor(points / BAND_PTS + 1e-9));
}

/** A cell's stratum on a metric: engine × location × the band of its baseline. */
export function stratumOf(cell, metric) {
  return `${cell.platform ?? ''}|${cell.region ?? ''}|${bandOf(rate(cell, metric))}`;
}

// ─── Controls ───────────────────────────────────────────────────────────────

/**
 * The control cells (item 7): candidates in a target cell's stratum on
 * visibility (its engine, location and baseline band). The same topic as a
 * target when those reach MIN_CONTROL_CELLS and every stratum the others
 * would; else any topic, the same topic first. At most MAX_CONTROL_CELLS,
 * shared out between the strata so none is crowded out.
 *
 * @param {{ targets: Array<{ key: string, pre: object }>, candidates: Array<{ key: string, pre: object,
 *   post: object }>, targetTopics: Set<string>, topicOf: (promptId: string) => string|null }} input
 */
export function matchControls({ targets, candidates, targetTopics, topicOf }) {
  const strata = new Set(targets.map((t) => stratumOf(t.pre, 'visibility')));
  const near = [];
  for (const candidate of candidates) {
    const stratum = stratumOf(candidate.pre, 'visibility');
    if (!strata.has(stratum)) continue;
    const topic = topicOf(candidate.pre.promptId);
    near.push({ ...candidate, stratum, sameTopic: !!topic && targetTopics.has(topic) });
  }
  const same = near.filter((cell) => cell.sameTopic);
  const covered = (cells) => new Set(cells.map((cell) => cell.stratum)).size;
  const useSame = same.length >= MIN_CONTROL_CELLS && covered(same) === covered(near);
  const pool = (useSame ? same : near).sort(
    (a, b) => Number(b.sameTopic) - Number(a.sameTopic) || (a.key < b.key ? -1 : 1),
  );
  const perStratum = Math.max(1, Math.floor(MAX_CONTROL_CELLS / Math.max(1, covered(pool))));
  const taken = new Map();
  const cells = pool.filter((cell) => {
    const n = taken.get(cell.stratum) ?? 0;
    if (n >= perStratum) return false;
    taken.set(cell.stratum, n + 1);
    return true;
  });
  return {
    cells,
    rules: {
      topic: useSame ? 'same' : same.length ? 'same_then_any' : 'any',
      band_pts: BAND_PTS,
      strata: covered(cells),
      engines: [...new Set(targets.map((t) => t.pre.platform).filter(Boolean))].sort(),
      min_runs: MIN_RUNS,
    },
  };
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/** A 32-bit seed from a string (FNV-1a). */
function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A seeded generator in [0, 1) (mulberry32): the same rows always give the same p and interval. */
export function seededRandom(seed) {
  let state = hashSeed(String(seed));
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** The direction of an effect, as day 7 shows it (up, flat, down). */
export function directionOf(effect) {
  if (effect >= MIN_EFFECT_PTS) return 'up';
  if (effect <= -MIN_EFFECT_PTS) return 'down';
  return 'flat';
}

/**
 * The cells of each prompt on one metric: per cell its stratum (an index),
 * baseline and checkpoint.
 */
function promptUnits(cells, metric, strata) {
  const byPrompt = new Map();
  for (const cell of cells) {
    const key = stratumOf(cell.pre, metric);
    if (!strata.has(key)) strata.set(key, strata.size);
    if (!byPrompt.has(cell.pre.promptId)) byPrompt.set(cell.pre.promptId, []);
    byPrompt.get(cell.pre.promptId).push({
      stratum: strata.get(key),
      pre: rate(cell.pre, metric),
      post: rate(cell.post, metric),
    });
  }
  return [...byPrompt.values()];
}

/**
 * The units a metric is measured, re-labelled and resampled on, targets
 * first: each prompt with its cells in the strata used (those holding a
 * target cell and a control cell), and nothing else. A target cell with
 * no control in its stratum, a target prompt left with none, and a
 * control's cells in a stratum no target is in are out before anything is
 * measured, so a reshuffle labels exactly the units the effect is read on,
 * as many targets as it has.
 *
 * Units still differ in how many cells they bring: a target tracked on
 * five engines brings five, a control matched on one engine one. That is
 * each prompt's own coverage of the strata used, the same rule for both;
 * trimming targets to their controls' cells would drop what they measure,
 * and the prompt (its cells averaged) stays the unit of evidence.
 */
function measuredUnits(targets, controls, metric) {
  const strata = new Map();
  const targetUnits = promptUnits(targets, metric, strata);
  const controlUnits = promptUnits(controls, metric, strata);
  const controlled = new Set(controlUnits.flatMap((unit) => unit.map((cell) => cell.stratum)));
  const kept = targetUnits
    .map((unit) => unit.filter((cell) => controlled.has(cell.stratum)))
    .filter((unit) => unit.length > 0);
  const used = new Set(kept.flatMap((unit) => unit.map((cell) => cell.stratum)));
  const peers = controlUnits
    .map((unit) => unit.filter((cell) => used.has(cell.stratum)))
    .filter((unit) => unit.length > 0);
  return { units: [...kept, ...peers], targetCount: kept.length, strataCount: strata.size };
}

/**
 * The stratified estimate for one labelling of the units (`targets` and
 * `controls` are unit indexes; a bootstrap repeats some): each stratum's
 * control means from the controls given, then each target cell's change
 * minus its stratum's control change, averaged per prompt, the effect the
 * target prompts' mean. A target cell whose stratum has no control in this
 * labelling is left out, as the observed one leaves it out; `strict`
 * (the bootstrap) makes such a labelling unmeasured (null) instead. Null
 * too when no target prompt keeps a cell. With `detail`, the numbers the
 * row shows.
 */
function estimate(units, strataCount, targets, controls, { detail = false, strict = false } = {}) {
  const sumPre = new Float64Array(strataCount);
  const sumPost = new Float64Array(strataCount);
  const count = new Float64Array(strataCount);
  for (const index of controls) {
    for (const cell of units[index]) {
      sumPre[cell.stratum] += cell.pre;
      sumPost[cell.stratum] += cell.post;
      count[cell.stratum]++;
    }
  }
  let effect = 0;
  let prompts = 0;
  const shown = { before: 0, after: 0, controlBefore: 0, controlAfter: 0, cells: 0 };
  for (const index of targets) {
    let residual = 0;
    let kept = 0;
    const own = { before: 0, after: 0, controlBefore: 0, controlAfter: 0 };
    for (const cell of units[index]) {
      const n = count[cell.stratum];
      if (!n) {
        if (strict) return null;
        continue;
      }
      const controlBefore = sumPre[cell.stratum] / n;
      const controlAfter = sumPost[cell.stratum] / n;
      residual += cell.post - cell.pre - (controlAfter - controlBefore);
      kept++;
      if (detail) {
        own.before += cell.pre;
        own.after += cell.post;
        own.controlBefore += controlBefore;
        own.controlAfter += controlAfter;
      }
    }
    if (!kept) continue;
    effect += residual / kept;
    prompts++;
    if (detail) {
      for (const key of Object.keys(own)) shown[key] += own[key] / kept;
      shown.cells += kept;
    }
  }
  if (!prompts) return null;
  if (!detail) return effect / prompts;
  return {
    effect: effect / prompts,
    before: shown.before / prompts,
    after: shown.after / prompts,
    controlBefore: shown.controlBefore / prompts,
    controlAfter: shown.controlAfter / prompts,
    targetCells: shown.cells,
    targetPrompts: prompts,
    controlCells: controls.reduce((sum, index) => sum + units[index].length, 0),
    controlPrompts: controls.length,
  };
}

/**
 * The statistic a labelling is tested on: the target prompts' mean
 * residual minus the control prompts', over its standard error (Welch's),
 * each prompt's residual its cells' changes less their strata's control
 * changes in this labelling. Studentized because the two groups' prompts
 * aren't alike: a target brings its cells on every engine it is tracked on,
 * a control only those matched in the targets' strata (often one or two),
 * so a control's residual is the noisier. The raw difference reshuffled
 * would mix the two and read the targets against a wider spread than
 * their own (in the tests' worlds with no effect: Improved or Declined in
 * 8–9% of them where P_VERDICT allows 20%, and less power with few
 * targets); studentized, a permutation test stays valid when the groups'
 * spreads differ (Chung & Romano 2013), and reads about 18% there. Null
 * without a target or a control prompt left to read.
 */
function studentized(units, strataCount, targets, controls) {
  const sumPre = new Float64Array(strataCount);
  const sumPost = new Float64Array(strataCount);
  const count = new Float64Array(strataCount);
  for (const index of controls) {
    for (const cell of units[index]) {
      sumPre[cell.stratum] += cell.pre;
      sumPost[cell.stratum] += cell.post;
      count[cell.stratum]++;
    }
  }
  const residuals = (indexes) => {
    const out = [];
    for (const index of indexes) {
      let residual = 0;
      let kept = 0;
      for (const cell of units[index]) {
        const n = count[cell.stratum];
        if (!n) continue;
        residual += cell.post - cell.pre - (sumPost[cell.stratum] - sumPre[cell.stratum]) / n;
        kept++;
      }
      if (kept) out.push(residual / kept);
    }
    return out;
  };
  const t = residuals(targets);
  const c = residuals(controls);
  if (t.length === 0 || c.length === 0) return null;
  const meanOf = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const varianceOf = (values, mean) =>
    values.length > 1
      ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
      : 0;
  const mt = meanOf(t);
  const mc = meanOf(c);
  const difference = mt - mc;
  const se = Math.sqrt(varianceOf(t, mt) / t.length + varianceOf(c, mc) / c.length);
  if (se < 1e-9) return difference === 0 ? 0 : Math.sign(difference) * Infinity;
  return difference / se;
}

/**
 * Two-sided p-value by re-randomization over prompts: which of the
 * measured units are targets reshuffled `resamples` times, as many as the
 * effect is read on, each labelling measured afresh (its strata's control
 * means included) on the studentized statistic. Never 0: (hits + 1) /
 * (labellings measured + 1).
 */
function rerandomizedP(units, strataCount, targetCount, random, resamples) {
  const order = units.map((_, index) => index);
  const observed =
    studentized(units, strataCount, order.slice(0, targetCount), order.slice(targetCount)) ?? 0;
  let hits = 0;
  let measured = 0;
  for (let r = 0; r < resamples; r++) {
    // A partial Fisher–Yates: the first targetCount places are a uniform draw.
    for (let i = 0; i < targetCount; i++) {
      const j = i + Math.floor(random() * (order.length - i));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const statistic = studentized(
      units,
      strataCount,
      order.slice(0, targetCount),
      order.slice(targetCount),
    );
    if (statistic === null) continue;
    measured++;
    if (Math.abs(statistic) >= Math.abs(observed) - 1e-9) hits++;
  }
  return (hits + 1) / (measured + 1);
}

/**
 * The 90% interval of the effect: a bootstrap that resamples the target
 * prompts and the control prompts, each group on its own, and measures
 * again. A resample that leaves a target cell's stratum with no control is
 * skipped and counted, not measured on fewer cells; with fewer than
 * MIN_BOOTSTRAP_SHARE of them measured, or fewer than MIN_INTERVAL_PROMPTS
 * target prompts, there is no interval.
 *
 * @returns {{ low: number, high: number, resamples: number, skipped: number } | null}
 */
function bootstrapInterval(units, strataCount, targetCount, random, resamples) {
  if (targetCount < MIN_INTERVAL_PROMPTS) return null;
  const controlCount = units.length - targetCount;
  const effects = [];
  let skipped = 0;
  for (let r = 0; r < resamples; r++) {
    const targets = Array.from({ length: targetCount }, () => Math.floor(random() * targetCount));
    const controls = Array.from(
      { length: controlCount },
      () => targetCount + Math.floor(random() * controlCount),
    );
    const effect = estimate(units, strataCount, targets, controls, { strict: true });
    if (effect === null) skipped++;
    else effects.push(effect);
  }
  if (effects.length < resamples * MIN_BOOTSTRAP_SHARE) return null;
  effects.sort((a, b) => a - b);
  const at = (q) => effects[Math.floor(q * (effects.length - 1))];
  return { low: at(0.05), high: at(0.95), resamples: effects.length, skipped };
}

/**
 * One metric (ActionResultMetric, item 12), stratified: the targets' and
 * the (target-weighted) controls' baseline and checkpoint, the change, the
 * effect, its p-value and 90% interval, in points, as stored (rounded); and
 * the unrounded effect and p it is judged on, with the target cells and
 * prompts kept and the control cells used. Null when no target cell has a
 * control in its stratum. With `resamples` 0 nothing is re-randomized or
 * resampled: no p and no interval (a checkpoint that can't have a verdict).
 */
export function metricResult({ metric, targets, controls, seed, resamples = RESAMPLES }) {
  const { units, targetCount, strataCount } = measuredUnits(targets, controls, metric);
  if (targetCount === 0) return null;
  const indexes = units.map((_, index) => index);
  const seen = estimate(
    units,
    strataCount,
    indexes.slice(0, targetCount),
    indexes.slice(targetCount),
    { detail: true },
  );
  let p = null;
  let interval = null;
  if (resamples > 0) {
    const random = seededRandom(`${seed}:${metric}`);
    p = rerandomizedP(units, strataCount, targetCount, random, resamples);
    interval = bootstrapInterval(units, strataCount, targetCount, random, resamples);
  }
  return {
    stored: {
      metric,
      unit: 'pts',
      before: round1(seen.before),
      after: round1(seen.after),
      delta: round1(seen.after - seen.before),
      deltaPercent:
        seen.before > 0 ? round1(((seen.after - seen.before) / seen.before) * 100) : null,
      direction: directionOf(seen.effect),
      control_before: round1(seen.controlBefore),
      control_after: round1(seen.controlAfter),
      effect: round1(seen.effect),
      p_value: p === null ? null : round3(p),
      interval_low: interval ? round1(interval.low) : null,
      interval_high: interval ? round1(interval.high) : null,
      interval_resamples: interval ? interval.resamples : null,
      target_cells: seen.targetCells,
      target_prompts: seen.targetPrompts,
      control_cells: seen.controlCells,
      control_prompts: seen.controlPrompts,
    },
    effect: seen.effect,
    p,
    targetCells: seen.targetCells,
    targetPrompts: seen.targetPrompts,
    controlCells: seen.controlCells,
    controlPrompts: seen.controlPrompts,
  };
}

/**
 * A stored metric of a Not measurable checkpoint (K4): its before, after,
 * controls and counts stay, read as they were; no effect, p-value,
 * interval or direction, as none is given.
 */
export function withoutVerdict(metric) {
  return {
    ...metric,
    direction: null,
    effect: null,
    p_value: null,
    interval_low: null,
    interval_high: null,
    interval_resamples: null,
  };
}

// ─── One checkpoint ─────────────────────────────────────────────────────────

/** The metric a change is judged on: citations for outreach (third-party placements), else visibility. */
export function primaryMetric(ship) {
  return ship.kind === 'third_party_observed' || ship.change_type === 'outreach'
    ? 'citations'
    : 'visibility';
}

/**
 * One checkpoint of one change, from its windows' cells: the target cells
 * (MIN_RUNS days in both windows), the matched controls, and the metrics,
 * the primary first, with what the primary is judged on (`judged`); or why
 * it can't be measured: no target left once other changes took theirs
 * (overlapping_change), engine_not_on_plan, too_few_runs, or too few
 * controls in the targets' strata, by cells or by prompts
 * (too_few_controls). The controls are returned either way once they were
 * matched, for impact_control_sets. Without `verdict` (day 7: a direction
 * only) nothing is re-randomized or resampled: no p and no interval.
 *
 * @param {{ seed: string, primary: 'visibility'|'citations', targetIds: string[],
 *   pre: ReturnType<typeof aggregateCells>, post: ReturnType<typeof aggregateCells>,
 *   excluded: Set<string>, prompts: Map<string, { topic_id: string|null, is_active: boolean }>,
 *   verdict?: boolean }} input
 */
export function measureCells({
  seed,
  primary,
  targetIds,
  pre,
  post,
  excluded,
  prompts,
  verdict = true,
}) {
  if (targetIds.length === 0) return { reason: 'overlapping_change', targetCells: 0 };
  const isTarget = new Set(targetIds);
  const targets = [];
  let seen = false;
  for (const [key, cell] of pre.cells) {
    if (!isTarget.has(cell.promptId)) continue;
    seen = true;
    const later = post.cells.get(key);
    if (later && cell.runs >= MIN_RUNS && later.runs >= MIN_RUNS) {
      targets.push({ key, pre: cell, post: later });
    }
  }
  if (targets.length === 0) {
    for (const cell of post.cells.values()) if (isTarget.has(cell.promptId)) seen = true;
    const offPlan = targetIds.some((id) => pre.offPlan.has(id) || post.offPlan.has(id));
    return {
      reason: !seen && offPlan ? 'engine_not_on_plan' : 'too_few_runs',
      targetCells: 0,
    };
  }

  const candidates = [];
  for (const [key, cell] of pre.cells) {
    if (excluded.has(cell.promptId) || !prompts.get(cell.promptId)?.is_active) continue;
    const later = post.cells.get(key);
    if (later && cell.runs >= MIN_RUNS && later.runs >= MIN_RUNS) {
      candidates.push({ key, pre: cell, post: later });
    }
  }
  const targetTopics = new Set(
    targetIds.map((id) => prompts.get(id)?.topic_id).filter((topic) => !!topic),
  );
  const control = matchControls({
    targets,
    candidates,
    targetTopics,
    topicOf: (id) => prompts.get(id)?.topic_id ?? null,
  });
  // Read first with nothing re-randomized: too few controls stop here, and
  // too few target prompts for a verdict, or no verdict to give (day 7's
  // direction), need no p or interval.
  const read = (metric, resamples) =>
    metricResult({ metric, targets, controls: control.cells, seed, resamples });
  const first = control.cells.length ? read(primary, 0) : null;
  if (
    !first ||
    first.controlCells < MIN_CONTROL_CELLS ||
    first.controlPrompts < MIN_CONTROL_PROMPTS
  ) {
    return { reason: 'too_few_controls', targetCells: first?.targetCells ?? 0, control };
  }
  const resamples = verdict && first.targetPrompts >= VERDICT_TARGET_PROMPTS ? RESAMPLES : 0;
  const main = resamples ? read(primary, resamples) : first;
  const other = read(primary === 'visibility' ? 'citations' : 'visibility', resamples);
  return {
    reason: null,
    targetCells: main.targetCells,
    control,
    metrics: [main.stored, ...(other ? [other.stored] : [])],
    judged: {
      effect: main.effect,
      p: main.p,
      targetCells: main.targetCells,
      targetPrompts: main.targetPrompts,
    },
  };
}

// ─── Outcome ────────────────────────────────────────────────────────────────

/**
 * A verdict from the primary metric's unrounded effect and p (item 10), for
 * a checkpoint with VERDICT_TARGET_PROMPTS target prompts at least
 * (checkpointEntry makes one with fewer Not measurable).
 */
export function verdictOf({ effect, p }) {
  if (effect >= MIN_EFFECT_PTS && p < P_VERDICT) return 'improved';
  if (effect <= -MIN_EFFECT_PTS && p < P_VERDICT) return 'declined';
  return 'no_meaningful_change';
}

/**
 * Confidence (item 10): High with p < P_HIGH, HIGH_TARGET_CELLS and
 * HIGH_TARGET_PROMPTS and no Stormy engine weather on the targets' engines
 * in the window; Medium with p < P_VERDICT, MEDIUM_TARGET_CELLS and
 * MEDIUM_TARGET_PROMPTS; Low otherwise. `stormy` is false until engine
 * weather (feature 1 item 7) exists: none is known.
 */
export function confidenceOf({ p, targetCells, targetPrompts, stormy = false }) {
  if (
    p < P_HIGH &&
    targetCells >= HIGH_TARGET_CELLS &&
    targetPrompts >= HIGH_TARGET_PROMPTS &&
    !stormy
  ) {
    return 'high';
  }
  if (
    p < P_VERDICT &&
    targetCells >= MEDIUM_TARGET_CELLS &&
    targetPrompts >= MEDIUM_TARGET_PROMPTS
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * Whether a day 90 result held the verdict before it (day 30's, else day
 * 14's when day 30 has none: not measured, or Not measurable): "held" when
 * it is the same Improved or Declined, "faded" when it isn't; null when
 * there was no such verdict to hold. A day 90 that can't be measured has
 * none (checkpointEntry).
 */
export function lastingOf(entries, d90Outcome) {
  const before = [...entries]
    .reverse()
    .find(
      (entry) =>
        (entry.checkpoint === 'd30' || entry.checkpoint === 'd14') &&
        VERDICTS.includes(entry.outcome),
    );
  if (!before || (before.outcome !== 'improved' && before.outcome !== 'declined')) return null;
  return d90Outcome === before.outcome ? 'held' : 'faded';
}

/**
 * A checkpoint's entry in checkpoints_json from what measureCells (or the
 * job's earlier checks) said: day 7 is Pending with a direction only, from
 * day 14 a verdict with its confidence, or Not measurable with the reason:
 * the one measureCells gave, or too_few_prompts with fewer than
 * VERDICT_TARGET_PROMPTS target prompts (one prompt's swing isn't a
 * change's effect, however many engines it is on).
 * Each keeps the primary metric's before, after and controls, so an earlier
 * checkpoint's row can be shown beside the latest.
 */
export function checkpointEntry({ cp, window, result, earlier, measuredAt }) {
  const primary = result.metrics?.[0] ?? null;
  const base = {
    checkpoint: cp.key,
    window,
    metric: primary?.metric ?? null,
    before: primary?.before ?? null,
    after: primary?.after ?? null,
    control_before: primary?.control_before ?? null,
    control_after: primary?.control_after ?? null,
    effect: primary?.effect ?? null,
    p_value: primary?.p_value ?? null,
    interval_low: primary?.interval_low ?? null,
    interval_high: primary?.interval_high ?? null,
    direction: primary?.direction ?? null,
    target_cells: result.targetCells ?? 0,
    target_prompts: result.judged?.targetPrompts ?? 0,
    control_cells: primary?.control_cells ?? result.control?.cells.length ?? 0,
    // No engine weather yet (feature 1 item 7): Stormy days can't be checked.
    weather_checked: false,
    measured_at: measuredAt,
  };
  if (cp.key === 'd7') {
    return {
      ...base,
      outcome: 'pending',
      confidence: null,
      not_measurable_reason: result.reason ?? null,
    };
  }
  const reason =
    result.reason ??
    (result.judged.targetPrompts < VERDICT_TARGET_PROMPTS ? 'too_few_prompts' : null);
  if (reason) {
    // No verdict, so no effect, p-value, interval or direction (K4); and a
    // day 90 that can't be measured says nothing of whether it held.
    const entry = {
      ...base,
      direction: null,
      effect: null,
      p_value: null,
      interval_low: null,
      interval_high: null,
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: reason,
    };
    return cp.key === 'd90' ? { ...entry, lasting: null } : entry;
  }
  const outcome = verdictOf(result.judged);
  const entry = {
    ...base,
    outcome,
    confidence: confidenceOf(result.judged),
    not_measurable_reason: null,
  };
  return cp.key === 'd90' ? { ...entry, lasting: lastingOf(earlier, outcome) } : entry;
}

// ─── An agent run's outcome ─────────────────────────────────────────────────

const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

/**
 * An agent run's outcome from what it shipped (CHAT-21 §I item 43): most
 * runs ship one change, and take its outcome. With several: Pending while
 * none has a verdict (Not measurable when none can have one), Improved when
 * one improved and none declined, Declined the other way round, else No
 * meaningful change; the lowest confidence of the verdicts read.
 *
 * @param {Array<{ outcome: string, confidence: string|null }>} measurements
 * @returns {{ outcome: string, confidence: string|null } | null}
 */
export function runOutcome(measurements) {
  if (measurements.length === 0) return null;
  const verdicts = measurements.filter((m) => VERDICTS.includes(m.outcome));
  if (verdicts.length === 0) {
    const none = measurements.every((m) => m.outcome === 'not_measurable');
    return { outcome: none ? 'not_measurable' : 'pending', confidence: null };
  }
  const improved = verdicts.some((m) => m.outcome === 'improved');
  const declined = verdicts.some((m) => m.outcome === 'declined');
  const outcome =
    improved && !declined
      ? 'improved'
      : declined && !improved
        ? 'declined'
        : 'no_meaningful_change';
  const confidence = verdicts
    .map((m) => m.confidence)
    .filter((c) => CONFIDENCE_ORDER.includes(c))
    .sort((a, b) => CONFIDENCE_ORDER.indexOf(a) - CONFIDENCE_ORDER.indexOf(b))[0];
  return { outcome, confidence: confidence ?? 'low' };
}
