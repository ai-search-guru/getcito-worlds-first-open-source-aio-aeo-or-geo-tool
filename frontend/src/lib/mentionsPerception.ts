import { LOW_SAMPLE_MENTIONS, relativeChange } from '@/lib/mentionsOverview';

/**
 * The Mentions & Sentiment Perception tab's figures (MS-09), as
 * mentions_perception (00161) returns them for a window and the one before
 * it: the terms AI uses next to the brand, the attributes that tell it and
 * its competitors apart, and the competitors named beside it. Terms come
 * from the answers by rule (spec §9, V1: no LLM): they describe what is said
 * next to a brand, so a sentence naming two brands lends its words to both.
 */

export interface PerceptionEntity {
  /** 'brand', or a competitor's id. */
  entity: string;
  name: string;
  isBrand: boolean;
  /** Answers naming it in the window, and in the window before. */
  mentions: number;
  previousMentions: number;
}

export interface PerceptionTerm {
  term: string;
  /** Answers naming the brand with the term next to it. */
  answers: number;
  previousAnswers: number;
}

export interface PerceptionAttribute {
  term: string;
  /** Per entity, in the entities' order: answers naming it with the term next to it. */
  values: { entity: string; answers: number }[];
}

export interface PerceptionCoMention {
  competitorId: string;
  name: string;
  /** Answers naming the competitor and the brand, now and before. */
  coMentions: number;
  previousCoMentions: number;
}

export interface MentionsPerception {
  window: { from: string; to: string; days: number };
  /** The brand first, then up to four competitors by mentions. */
  entities: PerceptionEntity[];
  brandTerms: PerceptionTerm[];
  attributes: PerceptionAttribute[];
  coMentions: PerceptionCoMention[];
}

type Raw = Record<string, unknown>;
const num = (r: Raw | undefined, key: string): number => Number(r?.[key] ?? 0) || 0;
const rows = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);

/** The function's jsonb as the page's shape; null when there is nothing to read. */
export function parseMentionsPerception(raw: unknown): MentionsPerception | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const w = (r.window ?? {}) as Raw;
  return {
    window: { from: String(w.from ?? ''), to: String(w.to ?? ''), days: num(w, 'days') },
    entities: rows(r.entities).map((e) => ({
      entity: String(e.entity ?? ''),
      name: String(e.name ?? ''),
      isBrand: e.is_brand === true,
      mentions: num(e, 'mentions'),
      previousMentions: num(e, 'prev_mentions'),
    })),
    brandTerms: rows(r.brand_terms).map((t) => ({
      term: String(t.term ?? ''),
      answers: num(t, 'answers'),
      previousAnswers: num(t, 'prev_answers'),
    })),
    attributes: rows(r.attributes).map((a) => ({
      term: String(a.term ?? ''),
      values: rows(a.values).map((v) => ({
        entity: String(v.entity ?? ''),
        answers: num(v, 'answers'),
      })),
    })),
    coMentions: rows(r.co_mentions).map((c) => ({
      competitorId: String(c.competitor_id ?? ''),
      name: String(c.name ?? ''),
      coMentions: num(c, 'co_mentions'),
      previousCoMentions: num(c, 'prev_co_mentions'),
    })),
  };
}

/** A count as a percentage of the mentions it is taken over; null with none. */
export function shareOf(answers: number, mentions: number): number | null {
  // Multiplied first, so whole percentages stay whole.
  return mentions > 0 ? (answers * 100) / mentions : null;
}

/** A term's or co-mention's change against the window before, in percent. */
export function changeOf(now: number, before: number): number | null {
  return relativeChange(now, before);
}

/**
 * Each attribute's share of each entity's mentions, in the entities' order:
 * the heat map's cells and the radar's points. Null where an entity has no
 * mentions to take a share over.
 */
export function attributeShares(
  p: Pick<MentionsPerception, 'entities' | 'attributes'>,
): { term: string; shares: (number | null)[] }[] {
  return p.attributes.map((a) => ({
    term: a.term,
    shares: p.entities.map((e) =>
      shareOf(a.values.find((v) => v.entity === e.entity)?.answers ?? 0, e.mentions),
    ),
  }));
}

/** A competitor leads an attribute by at least this many points for it to be a gap. */
export const GAP_POINTS = 20;

export interface PerceptionGap {
  term: string;
  competitor: string;
  competitorShare: number;
  brandShare: number;
  /** The brand's place among the entities on this attribute; null when AI never uses it for the brand. */
  brandRank: number | null;
}

/**
 * The biggest gap (spec §9): the attribute where a competitor is most
 * strongly associated and the brand least, by the widest margin, at least
 * GAP_POINTS. Null when no competitor leads anything by that much. Shares
 * taken over fewer than LOW_SAMPLE_MENTIONS mentions are left out, as the
 * Overview does: one answer would otherwise read as 100%.
 */
export function biggestGap(
  p: Pick<MentionsPerception, 'entities' | 'attributes'>,
): PerceptionGap | null {
  const brandIndex = p.entities.findIndex((e) => e.isBrand);
  if (brandIndex < 0 || p.entities[brandIndex].mentions < LOW_SAMPLE_MENTIONS) return null;
  let best: PerceptionGap | null = null;
  let bestMargin = GAP_POINTS;
  for (const row of attributeShares(p)) {
    const brandShare = row.shares[brandIndex] ?? 0;
    for (let i = 0; i < row.shares.length; i++) {
      const share = row.shares[i];
      if (i === brandIndex || share === null || share - brandShare < bestMargin) continue;
      if (p.entities[i].mentions < LOW_SAMPLE_MENTIONS) continue;
      bestMargin = share - brandShare;
      const placed = row.shares.filter((s): s is number => s !== null && s > 0);
      best = {
        term: row.term,
        competitor: p.entities[i].name,
        competitorShare: share,
        brandShare,
        brandRank: brandShare > 0 ? placed.filter((s) => s > brandShare).length + 1 : null,
      };
    }
  }
  return best;
}
