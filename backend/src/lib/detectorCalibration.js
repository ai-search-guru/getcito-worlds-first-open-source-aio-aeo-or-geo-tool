/**
 * Detector thresholds against what their actions did (learning C6).
 *
 * The Action Center's detectors (config/actionEngine.js) were set as first
 * settings, conservative, "not calibrations". This reads, for one brand, the
 * actions they opened that are over (completed or dismissed): per signal
 * kind, how the actions turned out (improved, mixed, no meaningful change,
 * declined), how many were dismissed and why, and the same by the signal's
 * strength when the action opened, in quarters.
 *
 * Strength is read in the unit of the kind's threshold (KIND_DEFINITIONS):
 * a topic's coverage for `topic_uncovered`, the relative fall for
 * `topic_drop`, the competitor's multiple for `competitor_leads`. Where the
 * weakest quarter mostly ends dismissed as not relevant or wrong data, or
 * improves at most half as often as the stronger actions, it suggests a
 * threshold at that quarter's edge, in that unit. A kind with no definition
 * gets its distribution only, never a suggestion. A suggestion is a starting
 * point for a maintainer, never applied.
 *
 * It reads rows exported for one brand (scripts/export-detector-outcomes.sql)
 * and gives back aggregates only: nothing of an action (its id, its brand)
 * is in what it returns. Nothing here reads a database or the network.
 */

import { ENGINE_THRESHOLDS } from '../config/actionEngine.js';

/** Fewer actions than this for a kind, and nothing is said of it. */
export const MIN_ACTIONS = 20;
/** Fewer actions than this on either side of the comparison, and it isn't made. */
const MIN_BUCKET = 5;
/** Below this share improved, over enough measured actions, a detector rarely leads anywhere. */
const QUIET_IMPROVED = 0.1;

/** The outcomes that say how an action turned out (the rest are unmeasured). */
export const MEASURED = ['improved', 'mixed', 'no_meaningful_change', 'declined'];
export const DISMISS_REASONS = ['not_relevant', 'already_done', 'wrong_data', 'not_now'];
/** The reasons that say the detector shouldn't have fired; `already_done`
 *  and `not_now` say nothing about the threshold. */
export const REJECT_REASONS = ['not_relevant', 'wrong_data'];

const num = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// ─── Strength per kind ──────────────────────────────────────────────────────

/*
 * How each strength is read from a baseline signal's `currentValue` and
 * `changeValue`. Where one needs the value before, it is current − change:
 * the detectors it's used for store their change as current minus previous.
 */
const before = (current, change) => (current === null || change === null ? null : current - change);
const VALUE = { formula: 'current', strength: (current) => current };
const PERCENT = {
  formula: 'current ÷ 100',
  strength: (current) => (current === null ? null : current / 100),
};
const RISE = { formula: 'change', strength: (_, change) => change };
const GAP = { formula: '−change', strength: (_, change) => (change === null ? null : -change) };
const GAP_PERCENT = {
  formula: '−change ÷ 100',
  strength: (_, change) => (change === null ? null : -change / 100),
};
const FALL = {
  formula: '−change ÷ (current − change)',
  strength: (current, change) => {
    const previous = before(current, change);
    return previous > 0 ? -change / previous : null;
  },
};
const GROWTH = {
  formula: 'change ÷ (current − change)',
  strength: (current, change) => {
    const previous = before(current, change);
    return previous > 0 ? change / previous : null;
  },
};
const MULTIPLE = {
  formula: 'current ÷ (current − change)',
  strength: (current, change) => {
    const previous = before(current, change);
    return previous > 0 ? current / previous : null;
  },
};
const SHARE_OF_CURRENT = {
  formula: 'change ÷ current',
  strength: (current, change) => (current > 0 && change !== null ? change / current : null),
};

const CONFIG = 'config/actionEngine.js';

/** A threshold in config/actionEngine.js, by its path there, at its value now. */
const config = (path) => {
  const [group, key] = path.split('.');
  return { name: path, file: CONFIG, value: ENGINE_THRESHOLDS[group][key] };
};

function define(measure, read, stronger, unit, threshold) {
  return Object.freeze({
    measure,
    formula: read.formula,
    strength: read.strength,
    stronger,
    unit,
    threshold: Object.freeze(threshold),
  });
}

/**
 * What a kind's strength is, in its threshold's unit: the value read from
 * the baseline, whether higher or lower is stronger (past the threshold),
 * the unit, and the threshold that decides it. Read from the detectors:
 * lib/pulse/metrics.js and lib/signals/record.js for the original kinds,
 * lib/signals/library/classify.js and detect.js for the library's. A kind
 * whose stored value isn't what its threshold judges (a count of pages
 * found, say) has no definition.
 */
export const KIND_DEFINITIONS = Object.freeze({
  // Original detectors (detection.*).
  sharp_drop: define(
    'relative fall of visibility',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('detection.visibilityDropRatio'),
  ),
  visibility_slipping: define(
    'relative fall of visibility',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('detection.slippingMinRatio'),
  ),
  platform_gap: define(
    'gap between the best and worst platform',
    GAP,
    'higher',
    'points',
    config('detection.platformGapPoints'),
  ),
  competitor_citation_gap: define(
    "competitor's lead in cited answers",
    GAP,
    'higher',
    'cited answers',
    config('detection.citationGapMinAbsolute'),
  ),
  competitor_surge: define(
    "competitor's rise",
    RISE,
    'higher',
    'points',
    config('detection.competitorSurgePoints'),
  ),
  prompt_gain: define("prompt's rise", RISE, 'higher', 'points', config('detection.moverMinGain')),
  page_opportunity: define(
    "page's sessions",
    VALUE,
    'higher',
    'sessions',
    config('detection.pageMinSessions'),
  ),
  uncited_mentions: define(
    'prompts mentioned but never cited',
    VALUE,
    'higher',
    'prompts',
    config('detection.uncitedMinPrompts'),
  ),

  // Prompts (library.*; classify.js groupPrompts).
  ...Object.fromEntries(
    [
      'prompt_visibility_gap',
      'high_demand_gap',
      'uncovered_demand',
      'prompt_unmapped',
      'content_underperforming',
    ].map((kind) => [
      kind,
      define('prompts in the group', VALUE, 'higher', 'prompts', config('library.promptGroupMin')),
    ]),
  ),
  ...Object.fromEntries(
    [
      ['lost_mentions', 2],
      ['high_value_prompt_lost', 1],
      ['citation_at_risk', 2],
    ].map(([kind, value]) => [
      kind,
      define('prompts in the group', VALUE, 'higher', 'prompts', {
        name: `groupPrompts minimum.${kind}`,
        file: 'lib/signals/library/classify.js',
        value,
      }),
    ]),
  ),

  // Topics: coverage is stored in percent, its thresholds are shares.
  topic_uncovered: define(
    'coverage',
    PERCENT,
    'lower',
    'share of tracked prompts (0–1)',
    config('library.topicUncoveredCoverage'),
  ),
  topic_gap: define(
    'coverage',
    PERCENT,
    'lower',
    'share of tracked prompts (0–1)',
    config('library.topicPartialCoverage'),
  ),
  topic_slipping: define(
    'relative fall of coverage',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.slipRatio'),
  ),
  topic_drop: define(
    'relative fall of coverage',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.dropRatio'),
  ),

  // Platforms and regions.
  platform_slipping: define(
    'relative fall of the mention rate',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.slipRatio'),
  ),
  platform_drop: define(
    'relative fall of the mention rate',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.dropRatio'),
  ),
  country_gap: define(
    'gap between the best and worst region',
    GAP_PERCENT,
    'higher',
    'mention rate (0–1)',
    config('library.countryGapPoints'),
  ),

  // Competitors.
  competitor_leads: define(
    "competitor's mentions per brand mention",
    MULTIPLE,
    'higher',
    'multiple',
    config('library.competitorLeadMultiple'),
  ),
  competitor_momentum: define(
    "competitor's mention growth",
    GROWTH,
    'higher',
    'share of the mentions before (0–1)',
    config('library.competitorMomentumRatio'),
  ),
  competitor_topic_lead: define(
    'tracked prompts in the topic',
    VALUE,
    'higher',
    'prompts',
    config('library.topicMinPrompts'),
  ),
  competitor_uncovered_topic: define(
    'tracked prompts in the topic',
    VALUE,
    'higher',
    'prompts',
    config('library.topicMinPrompts'),
  ),

  // Citation sources: current is the answers citing it, change those citing
  // it with only a competitor.
  competitor_winning_source: define(
    'share of its answers with only a competitor',
    SHARE_OF_CURRENT,
    'higher',
    'share of answers (0–1)',
    config('library.competitorSourceShare'),
  ),
  ...Object.fromEntries(
    ['competitor_cited_source', 'third_party_presence_gap', 'third_party_citation_gap'].map(
      (kind) => [
        kind,
        define(
          'answers citing the source',
          VALUE,
          'higher',
          'answers',
          config('library.sourceMinResults'),
        ),
      ],
    ),
  ),
  authority_citation_gap: define(
    'answers citing the source',
    VALUE,
    'higher',
    'answers',
    config('library.authorityMinResults'),
  ),

  // Fan-outs.
  fanout_gap: define(
    'queries in the group',
    VALUE,
    'higher',
    'queries',
    config('library.fanoutGroupMin'),
  ),
  competitor_fanout_gap: define(
    'queries in the group',
    VALUE,
    'higher',
    'queries',
    config('library.fanoutGroupMin'),
  ),

  // AI traffic: the site's sessions or visits, before and now.
  ai_traffic_drop: define(
    'relative fall of AI sessions',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.aiTrafficDropRatio'),
  ),
  ai_visits_weekly_drop: define(
    'relative fall of AI visits',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.aiVisitsWeeklyDropRatio'),
  ),
  cross_channel_risk: define(
    'relative fall of AI sessions',
    FALL,
    'higher',
    'share of the level before (0–1)',
    config('library.aiTrafficSlipRatio'),
  ),
  visibility_traffic_loss: define(
    'relative fall of AI sessions',
    FALL,
    'higher',
    'share of the level before (0–1)',
    { name: 'crossChannel trafficFall', file: 'lib/signals/library/detect.js', value: 0.2 },
  ),
});

/**
 * A baseline signal's strength: by its kind's definition, else (with no
 * definition) the size of its change, else of its value, and the column used.
 */
export function strengthOf(kind, current, change) {
  const definition = KIND_DEFINITIONS[kind];
  if (definition) return { strength: num(definition.strength(current, change)), from: null };
  if (change !== null) return { strength: Math.abs(change), from: 'changeValue' };
  if (current !== null) return { strength: Math.abs(current), from: 'currentValue' };
  return { strength: null, from: null };
}

/** Higher is stronger once this multiplies a strength. */
const signOf = (kind) => (KIND_DEFINITIONS[kind]?.stronger === 'lower' ? -1 : 1);

// ─── Rows ───────────────────────────────────────────────────────────────────

/**
 * The export's JSON lines, as rows; a line that isn't one is counted, never
 * kept. A row is one action and one signal of its baseline. The export's
 * last line counts the closed actions with no baseline of their signals,
 * left out (`withoutBaseline`; null when the export had no such line).
 *
 * @returns {{ rows: Array<{ action: string, kind: string, current: number | null,
 *   change: number | null, strength: number | null, strengthFrom: string | null,
 *   status: string, outcome: string | null, dismissReason: string | null }>,
 *   skipped: number, withoutBaseline: number | null }}
 */
export function parseRows(text) {
  const rows = [];
  let skipped = 0;
  let withoutBaseline = null;
  for (const line of String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const left = num(row?.withoutBaseline);
    if (row && row.action === undefined && left !== null) {
      withoutBaseline = (withoutBaseline ?? 0) + left;
      continue;
    }
    if (!row || typeof row.action !== 'string' || typeof row.kind !== 'string' || !row.kind) {
      skipped += 1;
      continue;
    }
    const current = num(row.current);
    const change = num(row.change);
    const { strength, from } = strengthOf(row.kind, current, change);
    rows.push({
      action: row.action,
      kind: row.kind,
      current,
      change,
      strength,
      strengthFrom: from,
      status: typeof row.status === 'string' ? row.status : '',
      outcome: typeof row.outcome === 'string' ? row.outcome : null,
      dismissReason: typeof row.dismissReason === 'string' ? row.dismissReason : null,
    });
  }
  return { rows, skipped, withoutBaseline };
}

/** One row per action and signal kind: its strongest signal of that kind. */
export function actionsByKind(rows) {
  const kinds = new Map();
  const score = (row) => (row.strength === null ? -Infinity : row.strength * signOf(row.kind));
  for (const row of rows) {
    const byAction = kinds.get(row.kind) ?? new Map();
    const known = byAction.get(row.action);
    if (!known || score(row) > score(known)) byAction.set(row.action, row);
    kinds.set(row.kind, byAction);
  }
  return new Map([...kinds].map(([kind, byAction]) => [kind, [...byAction.values()]]));
}

// ─── The report ─────────────────────────────────────────────────────────────

/** The value at a share of sorted values (nearest rank). */
function quantile(sorted, share) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

/** How a set of actions turned out: results are a completed action's, as on the Scorecard. */
function tally(actions) {
  const measured = actions.filter((a) => a.status === 'completed' && MEASURED.includes(a.outcome));
  const improved = measured.filter((a) => a.outcome === 'improved').length;
  const dismissed = actions.filter((a) => a.status === 'dismissed');
  const rejected = dismissed.filter((a) => REJECT_REASONS.includes(a.dismissReason)).length;
  return {
    actions: actions.length,
    measured: measured.length,
    improved,
    dismissed: dismissed.length,
    rejected,
    improvedRate: measured.length ? improved / measured.length : null,
    dismissRate: actions.length ? dismissed.length / actions.length : null,
    rejectRate: actions.length ? rejected / actions.length : null,
  };
}

/** A definition as the report gives it back: everything but the function. */
function describe({ strength: _, ...definition }) {
  return definition;
}

/**
 * The report, per kind with enough actions: its outcomes, dismissals and
 * their reasons, its strength quarters (weakest first; actions with no
 * strength are outside them), its weakest quarter against every action
 * stronger than that quarter's edge (`rest`), and a verdict:
 *  - `raise`: the weakest quarter was dismissed as not relevant or wrong
 *    data at least half the time, more often than the rest (`rejected`), or,
 *    with 5 measured on each side, improved at most half as often
 *    (`improves_less`); `suggestion` is that quarter's edge, in the unit of
 *    the kind's threshold;
 *  - `keep`: the weakest quarter does about as well as the rest;
 *  - `unclear`: under 5 actions on either side: strength doesn't spread
 *    enough to compare;
 *  - `no_definition`: the kind's strength has no threshold to compare with;
 *    its distribution only.
 * `quiet` is apart from the verdict: under 10% of its measured actions
 * improved. A kind with fewer actions is listed as insufficient, with its count.
 */
export function calibrate(rows, { min = MIN_ACTIONS } = {}) {
  const kinds = [];
  const insufficient = [];
  for (const [kind, actions] of [...actionsByKind(rows)].sort(([a], [b]) => a.localeCompare(b))) {
    if (actions.length < min) {
      insufficient.push({ kind, actions: actions.length });
      continue;
    }
    const definition = KIND_DEFINITIONS[kind] ?? null;
    const sign = signOf(kind);
    const completed = actions.filter((a) => a.status === 'completed');
    const outcomes = Object.fromEntries(
      [...MEASURED, 'not_measurable', 'pending_measurement'].map((o) => [
        o,
        completed.filter((a) => a.outcome === o).length,
      ]),
    );
    const dismissReasons = Object.fromEntries(
      DISMISS_REASONS.map((r) => [r, actions.filter((a) => a.dismissReason === r).length]),
    );

    // Scores run weakest to strongest whichever way the kind's strength goes.
    const scores = actions
      .filter((a) => a.strength !== null)
      .map((a) => a.strength * sign)
      .sort((a, b) => a - b);
    const cuts = scores.length ? [0.25, 0.5, 0.75].map((share) => quantile(scores, share)) : [];
    const quarterOf = (action) => {
      if (action.strength === null) return -1;
      const quarter = cuts.findIndex((cut) => action.strength * sign <= cut);
      return quarter === -1 ? 3 : quarter;
    };
    const buckets = cuts.length
      ? [0, 1, 2, 3].map((q) => ({
          // Back in the strength's own unit; `|| 0` keeps -0 out.
          edge: (q < 3 ? cuts[q] : scores[scores.length - 1]) * sign || 0,
          ...tally(actions.filter((a) => quarterOf(a) === q)),
        }))
      : [];
    const weakest = buckets[0] ?? null;
    const rest = weakest ? tally(actions.filter((a) => quarterOf(a) > 0)) : null;

    const reasons = [];
    const comparable = Boolean(
      weakest && weakest.actions >= MIN_BUCKET && rest.actions >= MIN_BUCKET,
    );
    if (definition && comparable) {
      if (weakest.rejectRate >= 0.5 && weakest.rejectRate > rest.rejectRate) {
        reasons.push('rejected');
      }
      if (
        weakest.measured >= MIN_BUCKET &&
        rest.measured >= MIN_BUCKET &&
        rest.improvedRate > 0 &&
        weakest.improvedRate <= rest.improvedRate / 2
      ) {
        reasons.push('improves_less');
      }
    }
    const verdict = !definition
      ? 'no_definition'
      : !comparable
        ? 'unclear'
        : reasons.length
          ? 'raise'
          : 'keep';

    const overall = tally(actions);
    const strengthFrom = definition
      ? null
      : {
          changeValue: actions.filter((a) => a.strengthFrom === 'changeValue').length,
          currentValue: actions.filter((a) => a.strengthFrom === 'currentValue').length,
        };
    kinds.push({
      kind,
      definition: definition ? describe(definition) : null,
      strengthFrom,
      ...overall,
      unrated: actions.length - scores.length,
      outcomes,
      dismissReasons,
      buckets,
      rest,
      verdict,
      reasons,
      suggestion: verdict === 'raise' ? weakest.edge : null,
      quiet: overall.measured >= min && (overall.improvedRate ?? 0) < QUIET_IMPROVED,
    });
  }
  return { kinds, insufficient };
}

const pct = (rate) => (rate === null ? '–' : `${Math.round(rate * 100)}%`);
const fmt = (value) => String(Math.round(value * 1000) / 1000);

const REASON_TEXT = {
  rejected: 'was mostly dismissed as not relevant or wrong data',
  improves_less: 'improves less often than the rest',
};

function strengthLine(k) {
  const d = k.definition;
  if (!d) {
    const used = Object.entries(k.strengthFrom)
      .filter(([, count]) => count > 0)
      .map(([column, count]) => `${column} for ${count}`);
    return (
      'No threshold definition for this kind: strength is the size of changeValue, else of ' +
      `currentValue${used.length ? ` (${used.join(', ')})` : ''}. No suggestion is made.`
    );
  }
  const shared = Object.entries(KIND_DEFINITIONS)
    .filter(([kind, other]) => kind !== k.kind && other.threshold.name === d.threshold.name)
    .map(([kind]) => kind);
  return (
    `Strength: ${d.measure} = ${d.formula}, in ${d.unit}; ${d.stronger} is stronger. ` +
    `Threshold: ${d.threshold.name} in ${d.threshold.file}, now ${fmt(d.threshold.value)}.` +
    (shared.length ? ` Also used by ${shared.join(', ')}.` : '')
  );
}

function verdictLine(k) {
  const d = k.definition;
  switch (k.verdict) {
    case 'raise':
      return (
        `Suggestion: consider ${d.measure} ${d.stronger === 'lower' ? 'below' : 'above'} ` +
        `${fmt(k.suggestion)} (now ${fmt(d.threshold.value)}): its weakest quarter ` +
        `${k.reasons.map((r) => REASON_TEXT[r]).join(' and ')}.`
      );
    case 'keep':
      return 'Keep: its weakest quarter does about as well as the rest.';
    case 'unclear':
      return "Unclear: strength doesn't spread enough to compare its weakest quarter with the rest.";
    default:
      return null;
  }
}

/** The report as Markdown, for a maintainer to read. */
export function renderReport(
  { kinds, insufficient },
  { skipped = 0, min = MIN_ACTIONS, withoutBaseline = null } = {},
) {
  const lines = [
    '# Detector thresholds against outcomes (one brand)',
    '',
    "Each action is read by its signals' strength when it opened, as its baseline recorded it.",
    '',
  ];
  if (kinds.length === 0) {
    lines.push(`No signal kind has ${min} or more closed actions yet.`, '');
  }
  for (const k of kinds) {
    lines.push(`## ${k.kind}`, '');
    lines.push(
      `${k.actions} closed actions · ${k.measured} measured · improved ${pct(k.improvedRate)} · dismissed ${pct(k.dismissRate)}`,
      '',
      strengthLine(k),
      '',
    );
    if (k.buckets.length) {
      const edge = k.definition?.stronger === 'lower' ? 'down to' : 'up to';
      lines.push(
        `| Strength ${edge} | Actions | Measured | Improved | Dismissed | Not relevant or wrong data |`,
        '| --- | --- | --- | --- | --- | --- |',
      );
      for (const b of k.buckets) {
        lines.push(
          `| ${fmt(b.edge)} | ${b.actions} | ${b.measured} | ${pct(b.improvedRate)} | ${pct(b.dismissRate)} | ${pct(b.rejectRate)} |`,
        );
      }
      const w = k.buckets[0];
      lines.push(
        '',
        `Weakest quarter against the rest (${w.actions} vs ${k.rest.actions} actions): ` +
          `improved ${pct(w.improvedRate)} vs ${pct(k.rest.improvedRate)} ` +
          `(of ${w.measured} vs ${k.rest.measured} measured), ` +
          `not relevant or wrong data ${pct(w.rejectRate)} vs ${pct(k.rest.rejectRate)}.`,
      );
    } else {
      lines.push('No action has a strength to put in quarters.');
    }
    if (k.unrated > 0) {
      lines.push('', `${k.unrated} action(s) had no strength and are outside the quarters.`);
    }
    const reasons = Object.entries(k.dismissReasons)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${reason} ${count}`);
    if (reasons.length) lines.push('', `Dismissed because: ${reasons.join(', ')}`);
    const verdict = verdictLine(k);
    if (verdict) lines.push('', verdict);
    if (k.quiet) {
      lines.push(
        '',
        'Note: under 10% of its measured actions improved; check what the detector asks for.',
      );
    }
    lines.push('');
  }
  if (insufficient.length) {
    lines.push(
      `Too few closed actions to say (under ${min}): ` +
        insufficient.map((k) => `${k.kind} (${k.actions})`).join(', '),
      '',
    );
  }
  if (withoutBaseline !== null) {
    lines.push(
      `${withoutBaseline} closed action(s) with linked signals had no baseline of them and were left out.`,
      '',
    );
  }
  if (skipped) lines.push(`${skipped} line(s) of the export weren't rows and were skipped.`, '');
  return lines.join('\n');
}
