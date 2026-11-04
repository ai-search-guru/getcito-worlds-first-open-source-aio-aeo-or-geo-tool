import type { CauseKind, Confidence, WhyMetric, WhyResult } from './explain';

/**
 * A Why analysis as the browser gets it (CHAT-22 §1 item 4, mockup #f-why):
 * the numbers the card shows, in the app's words, and never an id: a cause's
 * row names its prompt and pages, and its answer is fetched by the run's
 * route and places (`runs/{run}/why/{n}/{cause}/{row}`), which the server
 * reads back from the analysis it kept. Pure; client-safe.
 */

export interface ChatWhyRow {
  prompt: string;
  before: string | null;
  now: string | null;
  date: string | null;
  /** The row has an answer the drawer can open. */
  answer: boolean;
}

export interface ChatWhyCause {
  kind: CauseKind;
  /** 0–100 among what moved the change's way; null when it offset it or the change is noise. */
  share: number | null;
  /** Its part of the change, in the metric's unit, signed. */
  points: number;
  offset: boolean;
  confidence: Confidence;
  cells: number;
  urls: string[];
  rows: ChatWhyRow[];
}

export interface ChatWhy {
  /** Its place among the run's analyses, from 1: the drawer's route asks by it. */
  n: number;
  metric: WhyMetric;
  unit: 'pts' | 'positions';
  periodA: { from: string; to: string };
  periodB: { from: string; to: string };
  valueA: number | null;
  valueB: number | null;
  delta: number | null;
  se: number | null;
  noise: WhyResult['noise_verdict'];
  direction: WhyResult['direction'];
  changeDay: string | null;
  causes: ChatWhyCause[];
  remainder: { kind: 'normal_swing' | 'unexplained'; points: number; share: number | null };
  excludedCells: number;
  stableCells: number;
  partial: boolean;
  /** Engines and runs compared, for the headline and the sample. */
  engines: string[];
  runs: { a: number; b: number; cells: number };
}

const cleanUrl = (url: string) => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

const NO_PERIOD = { from: '', to: '' };

/**
 * The analysis a run kept, as its card shows it. A row kept by an older
 * version may lack a part: it reads as none, never as an error.
 */
export function whyView(
  n: number,
  result: WhyResult,
  scope: { engines?: unknown; runs_compared?: unknown } = {},
): ChatWhy {
  const runs = (scope?.runs_compared ?? {}) as { a?: number; b?: number; cells?: number };
  const unexplained = result.unexplained ?? { kind: 'unexplained', contribution: 0, share: null };
  return {
    n,
    metric: result.metric,
    unit: result.unit,
    periodA: result.period_a ?? NO_PERIOD,
    periodB: result.period_b ?? NO_PERIOD,
    valueA: result.value_a,
    valueB: result.value_b,
    delta: result.delta,
    se: result.se,
    noise: result.noise_verdict,
    direction: result.direction,
    changeDay: result.change_point?.date ?? null,
    causes: (result.causes ?? []).map((cause) => ({
      kind: cause.kind,
      share: cause.share,
      points: cause.contribution,
      offset: cause.offset,
      confidence: cause.confidence,
      cells: cause.cells,
      urls: (cause.urls ?? []).map(cleanUrl),
      rows: (cause.rows ?? []).map((row) => ({
        prompt: row.prompt,
        before: row.before ? cleanUrl(row.before) : null,
        now: row.now ? cleanUrl(row.now) : null,
        date: row.date,
        answer: !!row.answer,
      })),
    })),
    remainder: {
      kind: unexplained.kind,
      points: unexplained.contribution ?? 0,
      share: unexplained.share ?? null,
    },
    excludedCells: result.excluded_cells ?? 0,
    stableCells: result.stable_cells ?? 0,
    partial: result.evidence_partial === true,
    engines: Array.isArray(scope?.engines) ? (scope.engines as string[]) : [],
    runs: { a: runs.a ?? 0, b: runs.b ?? 0, cells: runs.cells ?? 0 },
  };
}
