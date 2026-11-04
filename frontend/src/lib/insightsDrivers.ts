import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import { LOW_SAMPLE_ANSWERS } from '@/lib/insightsSummary';

/**
 * "Why it changed" (VIS-009), as in the v2 mockup: the platforms, topics and
 * prompts that moved the Visibility change most, each with its own score
 * before → after and its effect on the overall score, and the prompts added
 * this period. Built from insights_change_drivers[_daily] (00135), over the
 * same prompts as the change on the card.
 */

/** Visibility components of one slice in one window. */
interface Sums {
  answers: number;
  mentionAnswers: number;
  citationAnswers: number;
  sumInvPosition: number;
  positionCount: number;
}

interface ComponentRow {
  win: 'cur' | 'prev';
  sums: Sums;
}

export interface ChangeDriversPayload {
  prompts: (ComponentRow & { promptId: string })[];
  engines: (ComponentRow & { modelUsed: string | null; platform: string | null })[];
  promptInfo: { id: string; text: string; topicId: string | null; topicName: string | null }[];
  newPrompts: { count: number; firstAdded: string | null; lastAdded: string | null };
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const sumsOf = (r: Record<string, unknown>): Sums => ({
  answers: num(r.answers),
  mentionAnswers: num(r.mention_answers),
  citationAnswers: num(r.citation_answers),
  sumInvPosition: num(r.sum_inv_position),
  positionCount: num(r.position_count),
});

/** The RPC payload, or null when it can't be used: missing, or rollups not yet backfilled. */
export function parseChangeDrivers(raw: unknown): ChangeDriversPayload | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.complete !== true) return null;
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const win = (v: unknown): 'cur' | 'prev' => (v === 'prev' ? 'prev' : 'cur');
  const added = (r.new_prompts ?? {}) as Record<string, unknown>;
  return {
    prompts: rows(r.prompts).map((p) => ({
      promptId: String(p.prompt_id),
      win: win(p.win),
      sums: sumsOf(p),
    })),
    engines: rows(r.engines).map((e) => ({
      modelUsed: str(e.model_used),
      platform: str(e.platform),
      win: win(e.win),
      sums: sumsOf(e),
    })),
    promptInfo: rows(r.prompt_info).map((p) => ({
      id: String(p.id),
      text: String(p.text ?? ''),
      topicId: str(p.topic_id),
      topicName: str(p.topic_name),
    })),
    newPrompts: {
      count: num(added.count),
      firstAdded: str(added.first_added),
      lastAdded: str(added.last_added),
    },
  };
}

export type DriverKind = 'platform' | 'topic' | 'prompt';

export interface Driver {
  kind: DriverKind;
  id: string;
  /** Platform, topic or prompt text; null for prompts without a topic or a deleted prompt. */
  name: string | null;
  /** The slice's own Visibility in each window, as the breakdown panel scores it. */
  prev: number;
  cur: number;
  /** The slice's answers in each window: its scores' sample sizes (VIS-005). */
  answers: { prev: number; cur: number };
  /** Points the overall score moved because of this slice. */
  impact: number;
}

export interface WhyChanged {
  /** 'lowSample': too few compared answers in a window to explain the change. */
  status: 'ok' | 'lowSample';
  /** Answers compared in each window. */
  answers: { cur: number; prev: number };
  /** "Compare: Same prompts": new prompts are left out of the change. */
  samePrompts: boolean;
  gains: Driver[];
  drops: Driver[];
  newPrompts: ChangeDriversPayload['newPrompts'];
}

const empty = (): Sums => ({
  answers: 0,
  mentionAnswers: 0,
  citationAnswers: 0,
  sumInvPosition: 0,
  positionCount: 0,
});

const add = (a: Sums, b: Sums, k = 1): Sums => ({
  answers: a.answers + b.answers * k,
  mentionAnswers: a.mentionAnswers + b.mentionAnswers * k,
  citationAnswers: a.citationAnswers + b.citationAnswers * k,
  sumInvPosition: a.sumInvPosition + b.sumInvPosition * k,
  positionCount: a.positionCount + b.positionCount * k,
});

/** The card's formula over a slice; 0 for a slice without answers. */
const score = (s: Sums) =>
  computeAiVisibilityScore({
    answers: s.answers,
    mentionAnswers: s.mentionAnswers,
    citationAnswers: s.citationAnswers,
    positionFactor: s.positionCount > 0 ? s.sumInvPosition / s.positionCount : null,
  }) ?? 0;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What moved the change. A slice's effect is how much higher the overall
 * score is than it would be had the slice kept last period's rates at this
 * period's volume: big slices weigh more, and a handful of answers can't top
 * the list. Slices answered in only one window aren't compared. Up to
 * `limit` gains and drops, largest first; an effect under 0.1 points is
 * left out. Too few compared answers in either window explain nothing.
 */
export function whyChanged(
  payload: ChangeDriversPayload,
  platformOf: (modelUsed: string | null, platform: string | null) => string,
  { samePrompts, limit = 3 }: { samePrompts: boolean; limit?: number },
): WhyChanged {
  const total = { cur: empty(), prev: empty() };
  for (const e of payload.engines) total[e.win] = add(total[e.win], e.sums);
  const answers = { cur: total.cur.answers, prev: total.prev.answers };
  const base = { answers, samePrompts, newPrompts: payload.newPrompts };
  if (answers.cur < LOW_SAMPLE_ANSWERS || answers.prev < LOW_SAMPLE_ANSWERS) {
    return { ...base, status: 'lowSample', gains: [], drops: [] };
  }

  const slices = new Map<
    string,
    { kind: DriverKind; id: string; name: string | null; cur: Sums; prev: Sums }
  >();
  const fold = (
    kind: DriverKind,
    id: string,
    name: string | null,
    win: 'cur' | 'prev',
    s: Sums,
  ) => {
    const key = `${kind}:${id}`;
    const slice = slices.get(key) ?? { kind, id, name, cur: empty(), prev: empty() };
    slice[win] = add(slice[win], s);
    slices.set(key, slice);
  };

  for (const e of payload.engines) {
    const name = platformOf(e.modelUsed, e.platform);
    fold('platform', name, name, e.win, e.sums);
  }
  const info = new Map(payload.promptInfo.map((p) => [p.id, p]));
  for (const p of payload.prompts) {
    const prompt = info.get(p.promptId);
    fold('prompt', p.promptId, prompt?.text ?? null, p.win, p.sums);
    // A deleted prompt's topic is unknown: it isn't put under "Uncategorized".
    if (prompt) fold('topic', prompt.topicId ?? '', prompt.topicName, p.win, p.sums);
  }

  const overall = score(total.cur);
  const drivers: Driver[] = [];
  for (const s of slices.values()) {
    if (s.cur.answers === 0 || s.prev.answers === 0) continue;
    // This period, with the slice at last period's rates.
    const without = add(add(total.cur, s.cur, -1), s.prev, s.cur.answers / s.prev.answers);
    const impact = round1(overall - score(without));
    if (impact === 0) continue;
    drivers.push({
      kind: s.kind,
      id: s.id,
      name: s.name,
      prev: round1(score(s.prev)),
      cur: round1(score(s.cur)),
      answers: { prev: s.prev.answers, cur: s.cur.answers },
      impact,
    });
  }

  const byImpact = (a: Driver, b: Driver) => Math.abs(b.impact) - Math.abs(a.impact);
  return {
    ...base,
    status: 'ok',
    gains: drivers
      .filter((d) => d.impact > 0)
      .sort(byImpact)
      .slice(0, limit),
    drops: drivers
      .filter((d) => d.impact < 0)
      .sort(byImpact)
      .slice(0, limit),
  };
}
