import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { mayUseBrand } from '@/lib/mcp/data';
import type { Citation } from '@/types';
import { pageKey } from '@/lib/content/sources';
import {
  explainChange,
  movedCells,
  type CellCounts,
  type CellEvidence,
  type DayCounts,
  type EvidenceRef,
  type WhyCell,
  type WhyMetric,
  type WhyResult,
} from '@/lib/chat/why/explain';
import { explainScoreChange, movedScoreCells } from '@/lib/chat/why/score';

/**
 * Why did it move (CHAT-22 §1): explain_change's reads for Chat. The brand
 * is checked to be the caller's workspace's first, as every MCP data
 * function checks it; then the cells' counts come from chat_why_cells
 * (00423, scheduled tracking's rollups, service role) and, for the cells
 * that moved most, what their answers cited and named (prompt_results'
 * citations and competitor names, never the answers' text) and the Site
 * Audit signals of the brand's cited pages. No model, no engine query
 * (Addendum 2 G). The analysis is lib/chat/why/explain.ts.
 */

/** Days a period has by default: the last 7 complete days against the 7 before (§1 item 3). */
const PERIOD_DAYS = 7;
/** Days the later period needs, at least: fewer can't tell a move from a day's swing. */
const MIN_PERIOD_DAYS = 3;
/** Days of the daily series the change point reads (§1 item 5.2). */
const SERIES_DAYS = 30;
/** A period, or the series, at most (00423's own limit). */
export const MAX_PERIOD_DAYS = 92;
/** Cells whose answers are read for evidence: those that moved most. */
const EVIDENCE_CELLS = 25;
/** Prompts read together for evidence: a batch, one page (max_rows 1000) a period. */
const EVIDENCE_BATCH = 5;
const EVIDENCE_PAGE = 1000;
/** Cited own pages whose Site Audits are compared, at most. */
const AUDITED_PAGES = 20;
/** How far back an audit before the periods counts. */
const AUDIT_LOOKBACK_DAYS = 90;
/**
 * The Site Audit signals that decide whether an AI engine can reach and read
 * a page (rubric.json): a change in one is a "site change" (§1 item 5.4).
 */
export const SITE_SIGNALS = [
  'ai-bot-access',
  'canonical',
  'https',
  'json-ld-presence',
  'json-ld-validity',
  'faq-schema',
];
/** ChatGPT Shopping's model isn't comparable to an answer (#155): left out, as Insights leaves it. */
export const LEFT_OUT_PLATFORMS = new Set(['chatgpt-shopping']);

export interface ExplainChangeParams {
  brandId: string;
  metric: WhyMetric;
  /** A model slug, or comma-separated slugs. */
  model?: string;
  region?: string;
  topicId?: string;
  /** The two periods, a before b: all four days, or none. */
  periods?: { a: { from?: string; to?: string }; b: { from?: string; to?: string } };
  /** A day the person named: 7 days before it against it and the 6 after. */
  around?: string;
}

/** Periods that can't be compared, in words for the model to say back. */
export interface ExplainChangeRefusal {
  ok: false;
  code: 'invalid_input';
  message: string;
}

export interface ExplainChangeOutput {
  analysis: WhyResult;
  /** What it covered, in names (CHAT-03: never ids). */
  scope: { brand: string; engines: string[]; region: string | null; topic: string | null };
  /** The tracking runs compared (Addendum 2 G: the answer names them), and the cells. */
  runs_compared: { a: number; b: number; cells: number };
  /** False while some days read predate the rollups' newer columns (counted as 0). */
  complete: boolean;
  data_as_of: string | null;
}

export class ExplainChangeInputError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const dayOf = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((dayOf(to) - dayOf(from)) / DAY_MS);
/** A real calendar day as YYYY-MM-DD: "2026-02-30" and "2026-13-45" aren't. */
const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(dayOf(value)) &&
  isoDay(dayOf(value)) === value;

/**
 * The two periods and the series: the person's, or around the day they named,
 * or the last 7 complete days against the 7 before. Throws
 * ExplainChangeInputError for days that aren't, periods that overlap, run
 * backwards, are long, reach past yesterday, or a later one under 3 days.
 */
export function whyPeriods(
  params: Pick<ExplainChangeParams, 'periods' | 'around'>,
  now = Date.now(),
): { a: { from: string; to: string }; b: { from: string; to: string }; seriesFrom: string } {
  const yesterday = dayOf(isoDay(now)) - DAY_MS;
  let a: { from: string; to: string };
  let b: { from: string; to: string };
  if (params.periods) {
    const { a: pa, b: pb } = params.periods;
    if (!pa.from || !pa.to || !pb.from || !pb.to) {
      throw new ExplainChangeInputError('Give both periods, each with its first and last day.');
    }
    a = { from: pa.from.slice(0, 10), to: pa.to.slice(0, 10) };
    b = { from: pb.from.slice(0, 10), to: pb.to.slice(0, 10) };
  } else if (params.around) {
    if (!isDay(params.around)) throw new ExplainChangeInputError('That day isn’t a date.');
    const day = dayOf(params.around);
    a = { from: isoDay(day - PERIOD_DAYS * DAY_MS), to: isoDay(day - DAY_MS) };
    b = { from: isoDay(day), to: isoDay(Math.min(day + (PERIOD_DAYS - 1) * DAY_MS, yesterday)) };
  } else {
    b = { from: isoDay(yesterday - (PERIOD_DAYS - 1) * DAY_MS), to: isoDay(yesterday) };
    a = {
      from: isoDay(yesterday - (2 * PERIOD_DAYS - 1) * DAY_MS),
      to: isoDay(yesterday - PERIOD_DAYS * DAY_MS),
    };
  }
  if (![a.from, a.to, b.from, b.to].every(isDay)) {
    throw new ExplainChangeInputError('A day isn’t a date.');
  }
  // First, so a day the person named today or later says why (around: b would end before it starts).
  if (dayOf(b.from) > yesterday || dayOf(b.to) > yesterday) {
    throw new ExplainChangeInputError(
      'The later period can’t go past yesterday: today isn’t tracked yet.',
    );
  }
  if (a.from > a.to || b.from > b.to) {
    throw new ExplainChangeInputError('A period ends before it starts.');
  }
  if (a.to >= b.from) {
    throw new ExplainChangeInputError('The earlier period has to end before the later one starts.');
  }
  if (daysBetween(a.from, a.to) > MAX_PERIOD_DAYS || daysBetween(b.from, b.to) > MAX_PERIOD_DAYS) {
    throw new ExplainChangeInputError(`A period is ${MAX_PERIOD_DAYS} days at most.`);
  }
  if (daysBetween(b.from, b.to) + 1 < MIN_PERIOD_DAYS) {
    throw new ExplainChangeInputError(
      `The later period needs at least ${MIN_PERIOD_DAYS} days of tracking to tell a change from a day's swing.`,
    );
  }
  const seriesFrom = isoDay(dayOf(b.to) - (SERIES_DAYS - 1) * DAY_MS);
  return { a, b, seriesFrom };
}

interface RpcCell {
  prompt_id: string;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  period: 'a' | 'b';
  runs: number;
  visible_runs: number;
  answers: number;
  mention_answers: number;
  citation_answers: number;
  brand_mentions: number;
  sum_position: number;
  sum_inv_position: number;
  position_count: number;
  competitor_mentions: number;
  last_at: string | null;
}

type RpcDay = Omit<
  RpcCell,
  'prompt_id' | 'platform' | 'model_used' | 'region' | 'period' | 'last_at'
> & { day: string; visible_prompts: number; active_prompts: number };

const n = (value: unknown) => Number(value) || 0;

const countsOf = (
  row: Omit<RpcCell, 'prompt_id' | 'platform' | 'model_used' | 'region' | 'period' | 'last_at'>,
): CellCounts => ({
  runs: n(row.runs),
  visibleRuns: n(row.visible_runs),
  answers: n(row.answers),
  mentionAnswers: n(row.mention_answers),
  citationAnswers: n(row.citation_answers),
  brandMentions: n(row.brand_mentions),
  competitorMentions: n(row.competitor_mentions),
  sumPosition: n(row.sum_position),
  sumInvPosition: n(row.sum_inv_position),
  positionCount: n(row.position_count),
});

const addCounts = (x: CellCounts | null, y: CellCounts): CellCounts =>
  x
    ? {
        runs: x.runs + y.runs,
        visibleRuns: x.visibleRuns + y.visibleRuns,
        answers: x.answers + y.answers,
        mentionAnswers: x.mentionAnswers + y.mentionAnswers,
        citationAnswers: x.citationAnswers + y.citationAnswers,
        brandMentions: x.brandMentions + y.brandMentions,
        competitorMentions: x.competitorMentions + y.competitorMentions,
        sumPosition: x.sumPosition + y.sumPosition,
        sumInvPosition: x.sumInvPosition + y.sumInvPosition,
        positionCount: x.positionCount + y.positionCount,
      }
    : y;

/**
 * A cell's key: for visibility the prompt (its engines together, as Insights
 * counts a visible prompt), else the prompt on one engine at one location.
 */
const keyFor = (
  metric: WhyMetric,
  row: Pick<RpcCell, 'prompt_id' | 'platform' | 'model_used' | 'region'>,
) =>
  metric === 'visibility'
    ? row.prompt_id
    : [row.prompt_id, row.platform ?? '', row.model_used ?? '', row.region ?? ''].join('|');

/** A site's name as compared: lower case, without "www.". */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};
const onSite = (host: string | null, sites: string[]) =>
  !!host && sites.some((site) => host === site || host.endsWith(`.${site}`));
const siteOf = (domain: string | null | undefined) =>
  domain ? hostOf(domain.includes('://') ? domain : `https://${domain.trim()}`) : null;

/** A cell, with the engines and locations its answers come from. */
type Cell = WhyCell & { platforms: Set<string>; models: Set<string>; regions: Set<string> };

/** explain_change for the caller's brand; null when it isn't their workspace's, or one they may not use. */
export async function explainChangeFor(
  auth: McpAuthContext,
  params: ExplainChangeParams,
  now = Date.now(),
): Promise<ExplainChangeOutput | ExplainChangeRefusal | null> {
  if (!auth.organizationId) return null;
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  let periods: ReturnType<typeof whyPeriods>;
  try {
    periods = whyPeriods(params, now);
  } catch (err) {
    if (!(err instanceof ExplainChangeInputError)) throw err;
    return { ok: false, code: 'invalid_input', message: err.message };
  }
  const models = params.model
    ? params.model
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean)
    : [];
  const { data, error } = await supabaseAdmin.rpc('chat_why_cells', {
    p_brand_id: params.brandId,
    p_a_from: periods.a.from,
    p_a_to: periods.a.to,
    p_b_from: periods.b.from,
    p_b_to: periods.b.to,
    p_series_from: periods.seriesFrom,
    p_models: models.length > 0 ? models : null,
    p_region: params.region ?? null,
    p_topic_id: params.topicId ?? null,
  });
  if (error) throw new Error(`Could not read the tracking counts: ${error.message}`);
  const read = (data ?? {}) as { cells?: RpcCell[]; daily?: RpcDay[]; complete?: boolean };
  const rows = (read.cells ?? []).filter((row) => !LEFT_OUT_PLATFORMS.has(row.platform ?? ''));

  const engineOf = (row: RpcCell) => row.model_used ?? row.platform ?? 'unknown';
  const engines = new Set(rows.map(engineOf));
  const dataAsOf = rows.reduce<string | null>(
    (latest, row) => (row.last_at && (!latest || row.last_at > latest) ? row.last_at : latest),
    null,
  );
  // The engines tracked in each period: the periods are compared on those in both.
  const enginesIn = { a: new Set<string>(), b: new Set<string>() };
  for (const row of rows) if (n(row.runs) > 0) enginesIn[row.period].add(engineOf(row));
  const inBothPeriods = (engine: string) => enginesIn.a.has(engine) && enginesIn.b.has(engine);

  const cellsOf = (from: RpcCell[]) => {
    const out = new Map<string, Cell>();
    for (const row of from) {
      const key = keyFor(params.metric, row);
      const cell = out.get(key) ?? {
        key,
        promptId: row.prompt_id,
        engine: params.metric === 'visibility' ? 'all' : engineOf(row),
        a: null,
        b: null,
        platforms: new Set<string>(),
        models: new Set<string>(),
        regions: new Set<string>(),
      };
      cell[row.period] = addCounts(cell[row.period], countsOf(row));
      if (row.platform) cell.platforms.add(row.platform);
      if (row.model_used) cell.models.add(row.model_used);
      if (row.region) cell.regions.add(row.region);
      out.set(key, cell);
    }
    return out;
  };
  const cells = cellsOf(rows);
  const list = [...cells.values()];
  // What the periods are compared on: visibility's prompts recounted on the
  // engines in both periods, the others' cells of those engines.
  const same =
    params.metric === 'visibility'
      ? cellsOf(rows.filter((row) => inBothPeriods(engineOf(row))))
      : new Map([...cells].filter(([, cell]) => inBothPeriods(cell.engine)));
  const sameList = [...same.values()];
  const moved =
    params.metric === 'visibility_score'
      ? movedScoreCells(sameList, EVIDENCE_CELLS)
      : movedCells(params.metric, sameList, EVIDENCE_CELLS);

  const [competitors, brandDomains, topic] = await Promise.all([
    supabaseAdmin.from('competitors').select('domain').eq('brand_id', params.brandId),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', params.brandId),
    params.topicId
      ? supabaseAdmin
          .from('topics')
          .select('name')
          .eq('id', params.topicId)
          .eq('brand_id', params.brandId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  // The brand's own sites are its brand_domains: brands has no domain column.
  const ownSites = ((brandDomains.data ?? []) as { domain: string }[])
    .map((d) => d.domain)
    .map(siteOf)
    .filter((site): site is string => !!site);
  const competitorSites = ((competitors.data ?? []) as { domain: string | null }[])
    .map((c) => siteOf(c.domain))
    .filter((site): site is string => !!site);

  const evidence = await readEvidence({
    brandId: params.brandId,
    metric: params.metric,
    cells: moved.map((key) => same.get(key)!).filter(Boolean),
    periods,
    ownSites,
    competitorSites,
  });

  const why = {
    metric: params.metric,
    periodA: periods.a,
    periodB: periods.b,
    cells: list.map(({ key, promptId, engine, a, b }) => ({ key, promptId, engine, a, b })),
    engines: { a: [...enginesIn.a], b: [...enginesIn.b] },
    sameEngineCells: sameList.map(({ key, promptId, engine, a, b }) => ({
      key,
      promptId,
      engine,
      a,
      b,
    })),
    daily: (read.daily ?? []).map((day) => ({
      day: day.day,
      counts: {
        ...countsOf(day),
        visiblePrompts: n(day.visible_prompts),
        activePrompts: n(day.active_prompts),
      } satisfies DayCounts,
    })),
    evidence,
  };
  // The Insights score blends three rates (why/score.ts); the others are one each.
  const analysis =
    params.metric === 'visibility_score' ? explainScoreChange(why) : explainChange(why);
  return {
    analysis,
    scope: {
      brand: brand.name as string,
      engines: [...engines].sort(),
      region: params.region ?? null,
      topic: (topic.data as { name?: string } | null)?.name ?? null,
    },
    runs_compared: {
      a: list.reduce((sum, cell) => sum + (cell.a?.runs ?? 0), 0),
      b: list.reduce((sum, cell) => sum + (cell.b?.runs ?? 0), 0),
      cells: list.length,
    },
    complete: read.complete !== false,
    data_as_of: dataAsOf,
  };
}

interface AnswerRow {
  id: string;
  prompt_id: string;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  created_at: string;
  citations: Citation[] | null;
  competitor_mentions: { name: string; mention_count: number }[] | null;
}

const emptyEvidence = (): CellEvidence => ({
  ownCitedA: [],
  ownCitedB: [],
  competitorCitedA: [],
  competitorCitedB: [],
  competitorRateA: 0,
  competitorRateB: 0,
  siteChanges: [],
  answersA: [],
  answersB: [],
});

/**
 * One period's answers of some prompts, on their cells' engines and
 * locations: the newest first, one page; `full` false when the page was cut.
 */
async function readAnswers(
  brandId: string,
  batch: Cell[],
  period: { from: string; to: string },
): Promise<{ rows: AnswerRow[]; full: boolean }> {
  const set = (pick: (cell: Cell) => Set<string>) => [
    ...new Set(batch.flatMap((cell) => [...pick(cell)])),
  ];
  let query = supabaseAdmin
    .from('prompt_results')
    .select(
      'id, prompt_id, platform, model_used, region, created_at, citations, competitor_mentions',
    )
    .eq('brand_id', brandId)
    .in('prompt_id', [...new Set(batch.map((cell) => cell.promptId))])
    .gte('created_at', `${period.from}T00:00:00Z`)
    .lt('created_at', new Date(dayOf(period.to) + DAY_MS).toISOString());
  const platforms = set((cell) => cell.platforms);
  const models = set((cell) => cell.models);
  const regions = set((cell) => cell.regions);
  if (platforms.length > 0) query = query.in('platform', platforms);
  if (models.length > 0) query = query.in('model_used', models);
  if (regions.length > 0) query = query.in('region', regions);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(0, EVIDENCE_PAGE - 1);
  if (error) throw new Error(`Could not read the answers: ${error.message}`);
  const rows = (data ?? []) as AnswerRow[];
  return { rows, full: rows.length < EVIDENCE_PAGE };
}

/**
 * What the moved cells' answers cited and named, and their own pages' Site
 * Audit changes. Each period is read on its own, a few prompts at a time,
 * newest first; a batch cut short marks its cells partial: no cause is drawn
 * from answers that weren't all read.
 */
async function readEvidence(input: {
  brandId: string;
  metric: WhyMetric;
  cells: Cell[];
  periods: ReturnType<typeof whyPeriods>;
  ownSites: string[];
  competitorSites: string[];
}): Promise<Map<string, CellEvidence>> {
  const out = new Map<string, CellEvidence>();
  if (input.cells.length === 0) return out;
  // The prompts' texts, for the causes' rows.
  const { data: texts, error: textError } = await supabaseAdmin
    .from('prompts')
    .select('id, text')
    .in('id', [...new Set(input.cells.map((cell) => cell.promptId))]);
  if (textError) throw new Error(`Could not read the prompts: ${textError.message}`);
  const textOf = new Map(
    ((texts ?? []) as { id: string; text: string }[]).map((row) => [row.id, row.text]),
  );
  for (const cell of input.cells) {
    out.set(cell.key, { ...emptyEvidence(), prompt: textOf.get(cell.promptId) });
  }

  // The cells, by prompt, in batches of a few prompts.
  const prompts = [...new Set(input.cells.map((cell) => cell.promptId))];
  const named = new Map<string, { a: number; b: number; totalA: number; totalB: number }>();
  const ownCited = new Map<string, string>();
  for (let i = 0; i < prompts.length; i += EVIDENCE_BATCH) {
    const inBatch = new Set(prompts.slice(i, i + EVIDENCE_BATCH));
    const batch = input.cells.filter((cell) => inBatch.has(cell.promptId));
    for (const period of ['a', 'b'] as const) {
      const { rows, full } = await readAnswers(input.brandId, batch, input.periods[period]);
      if (!full) {
        for (const cell of batch) out.get(cell.key)!.partial = true;
      }
      for (const row of rows) {
        const key = keyFor(input.metric, row);
        const evidence = out.get(key);
        if (!evidence) continue;
        const count = named.get(key) ?? { a: 0, b: 0, totalA: 0, totalB: 0 };
        if (period === 'a') count.totalA += 1;
        else count.totalB += 1;
        if ((row.competitor_mentions ?? []).some((c) => (c.mention_count ?? 0) > 0))
          count[period] += 1;
        named.set(key, count);
        const ref: EvidenceRef = {
          type: 'answer',
          id: row.id,
          date: row.created_at.slice(0, 10),
          period,
        };
        (period === 'a' ? evidence.answersA : evidence.answersB).push(ref);
        for (const citation of row.citations ?? []) {
          const url = typeof citation?.url === 'string' ? citation.url : null;
          const host = url ? hostOf(url) : null;
          if (!url || !host) continue;
          const own = period === 'a' ? evidence.ownCitedA : evidence.ownCitedB;
          const theirs = period === 'a' ? evidence.competitorCitedA : evidence.competitorCitedB;
          const page = pageKey(url) ?? url;
          if (onSite(host, input.ownSites)) {
            if (!own.includes(page)) own.push(page);
            if (!ownCited.has(page)) ownCited.set(page, url);
          } else if (onSite(host, input.competitorSites) && !theirs.includes(page)) {
            theirs.push(page);
          }
        }
      }
    }
  }
  for (const [key, count] of named) {
    const evidence = out.get(key)!;
    evidence.competitorRateA = count.totalA > 0 ? count.a / count.totalA : 0;
    evidence.competitorRateB = count.totalB > 0 ? count.b / count.totalB : 0;
  }

  // One audit pair per page, the pages told apart before the cut.
  const changes = await readSiteChanges(
    input.brandId,
    [...ownCited.values()].slice(0, AUDITED_PAGES),
    input.periods,
  );
  for (const evidence of out.values()) {
    const cited = new Set([...evidence.ownCitedA, ...evidence.ownCitedB]);
    evidence.siteChanges = changes
      .filter((change) => cited.has(change.page))
      .map((change) => ({
        url: change.url,
        direction: change.direction,
        signals: change.signals,
        ref: change.ref,
      }));
  }
  return out;
}

const STATUS_RANK: Record<string, number> = { pass: 0, na: 0, warn: 1, fail: 2 };

/**
 * The brand's cited pages whose AI-reach signals moved between the periods:
 * their latest completed Site Audit by the end of period a against the latest
 * by the end of period b, signal by signal (SITE_SIGNALS). Read newest first,
 * from AUDIT_LOOKBACK_DAYS before period a.
 */
async function readSiteChanges(
  brandId: string,
  urls: string[],
  periods: ReturnType<typeof whyPeriods>,
): Promise<(CellEvidence['siteChanges'][number] & { page: string })[]> {
  if (urls.length === 0) return [];
  const pages = new Map(urls.map((url) => [pageKey(url) ?? url, url]));
  const { data: audits, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, final_url, completed_at')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .gte(
      'completed_at',
      new Date(dayOf(periods.a.from) - AUDIT_LOOKBACK_DAYS * DAY_MS).toISOString(),
    )
    .lt('completed_at', new Date(dayOf(periods.b.to) + DAY_MS).toISOString())
    .order('completed_at', { ascending: false });
  if (error) throw new Error(`Could not read the audits: ${error.message}`);
  const endA = new Date(dayOf(periods.a.to) + DAY_MS).toISOString();
  const pairs = new Map<
    string,
    { before?: { id: string; at: string }; after?: { id: string; at: string } }
  >();
  for (const audit of (audits ?? []) as {
    id: string;
    url: string;
    final_url: string | null;
    completed_at: string;
  }[]) {
    const page = pageKey(audit.final_url ?? audit.url) ?? pageKey(audit.url);
    if (!page || !pages.has(page)) continue;
    const pair = pairs.get(page) ?? {};
    // Newest first: the first seen on each side is the latest there.
    if (audit.completed_at < endA) pair.before ??= { id: audit.id, at: audit.completed_at };
    else pair.after ??= { id: audit.id, at: audit.completed_at };
    pairs.set(page, pair);
  }
  const compared = [...pairs.entries()].filter(([, pair]) => pair.before && pair.after);
  if (compared.length === 0) return [];
  const ids = compared.flatMap(([, pair]) => [pair.before!.id, pair.after!.id]);
  const { data: signals, error: signalError } = await supabaseAdmin
    .from('audit_signal_results')
    .select('audit_id, signal_key, status')
    .in('audit_id', ids)
    .in('signal_key', SITE_SIGNALS);
  if (signalError) throw new Error(`Could not read the audits' signals: ${signalError.message}`);
  const status = new Map<string, string>();
  for (const row of (signals ?? []) as { audit_id: string; signal_key: string; status: string }[]) {
    status.set(`${row.audit_id}|${row.signal_key}`, row.status);
  }
  const changes: (CellEvidence['siteChanges'][number] & { page: string })[] = [];
  for (const [page, pair] of compared) {
    const worse: string[] = [];
    const better: string[] = [];
    for (const key of SITE_SIGNALS) {
      const was = STATUS_RANK[status.get(`${pair.before!.id}|${key}`) ?? 'na'] ?? 0;
      const now = STATUS_RANK[status.get(`${pair.after!.id}|${key}`) ?? 'na'] ?? 0;
      if (now > was) worse.push(key);
      else if (now < was) better.push(key);
    }
    const change = (moved: string[], direction: 'worse' | 'better') => ({
      page,
      url: pages.get(page)!,
      direction,
      signals: moved,
      ref: {
        type: 'audit' as const,
        id: pair.after!.id,
        date: pair.after!.at.slice(0, 10),
        period: 'b' as const,
        url: pages.get(page)!,
      },
    });
    if (worse.length > 0) changes.push(change(worse, 'worse'));
    if (better.length > 0) changes.push(change(better, 'better'));
  }
  return changes;
}
