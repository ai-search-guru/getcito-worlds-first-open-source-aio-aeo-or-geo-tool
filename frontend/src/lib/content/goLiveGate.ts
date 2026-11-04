import { API_BASE_URL } from '@/config/api';
import { getContentDraftPackageFor } from '@/lib/mcp/contentPackage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readContentAuthors } from './authorsRead';
import { pagePrices, type BrandFact, type BrandFactsRead } from './brandFacts';
import { catalogMatchFor } from './catalogMatch';
import { CLAIM_KINDS, type ClaimBlock } from './claims';
import { keptInputs, NO_INPUTS } from './draftInputs';
import { brandSiteType } from './draftPageType';
import { openSpotPlaces, pageDoc } from './docText';
import { isPageType } from './drafts';
import type { PageRead } from './pageRead';
import { qualityAverage, qualityPhase } from './quality';
import { trustBlocks, unplacedSites, type LinkCheck, type TrustBlock } from './qualityChecks';
import { qualityState, type QualityReads, type QualityState } from './qualityInputs';
import { profileFor } from './qualityProfiles';
import { sentencesOf } from './readability';
import {
  activeRules,
  checkRule,
  draftLanguage,
  draftRulesSchema,
  effectiveRules,
  NO_DRAFT_RULES,
  pageTextLength,
  readPage,
  ruleSet,
  savedRuleSetSchema,
  type SavedRuleSet,
} from './rules';
import { withContentDom } from './serverDom';
import type { SiteTrust } from './siteTrust';
import { SOURCES_DAYS } from './sources';

/**
 * The quality gate a page passes to go live on its own (AUTONOMOUS-GO-LIVE
 * §6.2, PR 2b-2): the page as it will go out, with the same scores the
 * Content Editor shows (lib/content/qualityInputs.ts qualityState, from the
 * same reads), on the server, for an agent run with no one's session.
 *
 * In order, the first that fails holds the page for a click:
 *   1. quality_off: Content Quality isn't on;
 *   2. placeholders / fields: the page as Send to CMS would send it
 *      (bulkCmsItems' problem);
 *   3. suggestions: suggestions on the draft still wait for review;
 *   4. quality_unread: a read the scores need couldn't be made (its AI read
 *      failed or reached the run's cap or the month's budget, the claims or
 *      the sources' kinds weren't all read, a database read failed): what
 *      can't be counted never passes;
 *   5. facts: a price, trial or founding year that differs from an approved
 *      brand fact; facts_unchecked: no approved facts, and the page states
 *      one of those;
 *   6. qualityLow: E-E-A-T, Trust or Readability under 60; quality: their
 *      average under 75. A score with nothing to judge on the page is left
 *      out, as the editor's Quality average leaves it.
 * The AI reads the editor makes as the page is saved are made here when the
 * draft has none kept for its text: the agent run's own steps (the server's
 * /api/internal/chat/go-live/quality-reads, on the run's cap and the
 * month's budget). Link checks are network reads, no AI. Server only.
 */

/** Each score's lowest, and their average's (spec §6.2: no score in Needs work, near Strong). */
export const GATE_MIN_EACH = 60;
export const GATE_MIN_AVERAGE = 75;

export type GateHold =
  | 'quality_off'
  | 'placeholders'
  | 'fields'
  | 'suggestions'
  | 'quality_unread'
  | 'facts'
  | 'facts_unchecked'
  | 'qualityLow'
  | 'quality';

/** What the gate couldn't read, as the hold names it. */
export type GateRead =
  | 'draft'
  | 'authors'
  | 'inputs'
  | 'sources'
  | 'rules'
  | 'confirmations'
  | 'images'
  | 'catalog'
  | 'links'
  | 'claims'
  | 'page'
  | 'classes'
  | 'facts'
  | 'siteTrust'
  | 'spots'
  | 'scores';

type GateCheck = 'eeat' | 'trust' | 'readability';

/** The scores a page passed with: null for one with nothing to judge on it. */
export type GateScores = {
  eeat: number | null;
  trust: number | null;
  readability: number | null;
  average: number;
};

export type GateResult =
  | { pass: true; scores: GateScores }
  | { pass: false; hold: 'quality_off' | 'placeholders' | 'fields' | 'suggestions' }
  | { pass: false; hold: 'quality_unread'; read: GateRead; why: string }
  | { pass: false; hold: 'facts'; page: string; fact: string }
  | { pass: false; hold: 'facts_unchecked' }
  | { pass: false; hold: 'qualityLow'; check: GateCheck; score: number }
  | { pass: false; hold: 'quality'; score: number };

/** A read the gate couldn't make: it holds the page with its name and why. */
class Unread extends Error {
  constructor(
    readonly read: GateRead,
    readonly why: string,
  ) {
    super(`${read}: ${why}`);
  }
}

// ─── The verdict ─────────────────────────────────────────────────────────────

/** A trial's length or a founding year the page states about the brand, read wide (the safe side). */
const TRIAL =
  /\b\d+[\s-]*(?:day|days|week|weeks|month|months)\b[^.!?]{0,20}\btrial\b|\btrial\b[^.!?]{0,20}\b\d+[\s-]*(?:day|days|week|weeks)\b/i;
const FOUNDED = /\b(?:founded|established|started|since)\b[^.!?]{0,40}\b(?:1[89]\d{2}|20\d{2})\b/i;

/** Whether the page states a price, a trial or a founding year (facts_unchecked's test). */
export function statesBrandFacts(sentences: string[]): boolean {
  return sentences.some(
    (sentence) =>
      pagePrices(sentence).some((price) => price.amount > 0) ||
      TRIAL.test(sentence) ||
      FOUNDED.test(sentence),
  );
}

/**
 * The verdict, from what the reads gave (pure): facts, then the scores. The
 * page's own checks (placeholders, fields, suggestions) are made before.
 */
export function gateVerdict({
  state,
  facts,
  sentences,
}: {
  state: QualityState;
  facts: BrandFact[];
  sentences: string[];
}): GateResult {
  const mismatch = state.factCheck?.mismatches[0];
  if (mismatch) return { pass: false, hold: 'facts', page: mismatch.page, fact: mismatch.fact };
  const approved = facts.some((fact) => fact.status === 'approved' && !fact.gone);
  if (!approved && statesBrandFacts(sentences)) return { pass: false, hold: 'facts_unchecked' };

  // A score with nothing to judge on the page (no check applies) is left
  // out, as the editor's Quality average leaves it: every read it needs was
  // made before this. None at all can't pass.
  const scores = (
    [
      ['eeat', state.eeatScore?.score ?? null],
      ['trust', state.trustScore?.score ?? null],
      ['readability', state.readable?.score ?? null],
    ] as const
  ).filter((entry): entry is readonly [GateCheck, number] => entry[1] !== null);
  if (scores.length === 0) {
    return { pass: false, hold: 'quality_unread', read: 'scores', why: 'none' };
  }
  const [lowest, low] = scores.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (low < GATE_MIN_EACH) return { pass: false, hold: 'qualityLow', check: lowest, score: low };
  const average = qualityAverage(scores.map(([, score]) => score)) ?? 0;
  if (average < GATE_MIN_AVERAGE) return { pass: false, hold: 'quality', score: average };
  const by = Object.fromEntries(scores) as Partial<Record<GateCheck, number>>;
  return {
    pass: true,
    scores: {
      eeat: by.eeat ?? null,
      trust: by.trust ?? null,
      readability: by.readability ?? null,
      average,
    },
  };
}

// ─── The reads ───────────────────────────────────────────────────────────────

/** A read the server's endpoint answers: its value, or why it couldn't be made. */
type Answer<T> = { ok: true; value: T } | { ok: false; code: string };

interface ServerReads {
  links: Answer<{ links: LinkCheck[]; skipped: string[] }>;
  claims: Answer<{ paragraphs: ClaimBlock[]; pending: number; limited: boolean }>;
  page: Answer<PageRead & { pending: boolean; limited: boolean; paused: boolean }>;
  classes: Answer<{ classes: { site: string; kind: string }[]; limited: boolean }>;
  facts: Answer<Partial<BrandFactsRead>>;
  siteTrust: Answer<(SiteTrust & { complete?: boolean }) | null>;
}

/** The value of a read the gate needs, or Unread with why. */
function needed<T>(read: GateRead, answer: Answer<T>): T {
  if (!answer.ok) throw new Unread(read, answer.code);
  return answer.value;
}

/** The server's reads for the gate (CRON_SECRET), the run's own steps where new ones are made. */
async function serverReads(input: GateInput, sites: string[]): Promise<ServerReads> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Unread('links', 'no_secret');
  const res = await fetch(`${API_BASE_URL}/api/internal/chat/go-live/quality-reads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      orgId: input.organizationId,
      agentRunId: input.agentRunId,
      runId: input.runId,
      actingUserId: input.actingUserId,
      draftId: input.draftId,
      sites,
    }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as (ServerReads & { code?: string }) | null;
  if (!res.ok || !body) throw new Unread('links', body?.code ?? `http_${res.status}`);
  return body;
}

export interface GateInput {
  organizationId: string;
  draftId: string;
  agentRunId: string;
  runId: string;
  /** The person the run acts as (its owner, or who clicked Run now). */
  actingUserId: string;
  actingRole: 'admin' | 'manager';
}

/** One database read the gate needs; a failure holds the page. */
async function dbRead<T>(
  read: GateRead,
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await run();
  if (error) throw new Unread(read, error.message.slice(0, 200));
  return data;
}

/** The page type's own page rules, as the Rules tab reads them (only `met` scores). */
function typeRulesOf(
  html: string,
  draftRules: unknown,
  mine: Partial<Record<string, SavedRuleSet>>,
  pageType: string | null,
  language: string | null,
  sources: { brandDomains: string[]; competitorDomains: string[] },
  catalog: QualityReads['catalog'],
): QualityReads['typeRules'] {
  const choices = draftRulesSchema.safeParse(draftRules).data ?? NO_DRAFT_RULES;
  const draftType = isPageType(pageType) ? pageType : null;
  const setType = choices.set ?? draftType;
  const effective = effectiveRules(choices, setType ? mine[setType] : undefined);
  const rules = activeRules(
    ruleSet(setType, { language, length: effective.importLength, shopping: false }),
    effective,
  );
  const page = readPage(html, pageTextLength(html));
  const ctx = {
    brandDomains: sources.brandDomains,
    competitorDomains: sources.competitorDomains,
    fanouts: [],
    language,
    catalog: catalog ?? null,
    shopping: null,
  };
  return rules.flatMap((rule) => {
    if (rule.group !== 'type' || rule.check !== 'page' || !rule.on) return [];
    const status = checkRule(rule, page, ctx);
    return status.state === 'info'
      ? []
      : [{ name: rule.key, met: status.state === 'ok', detail: '' }];
  });
}

/**
 * Whether a page an agent wants to take live on its own passes the gate, and
 * if not, why. Never throws for a read that fails: it holds the page.
 */
export async function goLiveGate(input: GateInput): Promise<GateResult> {
  const phase = qualityPhase();
  if (phase < 1) return { pass: false, hold: 'quality_off' };
  try {
    return await gate(input, phase);
  } catch (err) {
    if (err instanceof Unread) {
      return { pass: false, hold: 'quality_unread', read: err.read, why: err.why };
    }
    console.error('[go-live] the quality gate failed:', err);
    return { pass: false, hold: 'quality_unread', read: 'draft', why: 'failed' };
  }
}

async function gate(input: GateInput, phase: number): Promise<GateResult> {
  // The page as Send to CMS sends it: placeholders and fields first (its DOM too).
  const packaged = await getContentDraftPackageFor(
    {
      userId: input.actingUserId,
      email: null,
      organizationId: input.organizationId,
      role: input.actingRole,
      apiKeyId: '',
    },
    input.draftId,
  );
  if ('error' in packaged) {
    if (packaged.error === 'not_found') throw new Unread('draft', 'not_found');
    return { pass: false, hold: packaged.problem === 'placeholders' ? 'placeholders' : 'fields' };
  }

  const draft = await dbRead('draft', () =>
    supabaseAdmin
      .from('content_drafts')
      .select(
        'id, brand_id, title, body_html, page_type, author_id, author_real_at, author_profile_at, rules, kept_sources, brands!inner(organization_id, name, language, site_type, industry, shopping_mode_enabled)',
      )
      .eq('id', input.draftId)
      .eq('brands.organization_id', input.organizationId)
      .maybeSingle(),
  );
  if (!draft) throw new Unread('draft', 'not_found');
  const brand = (Array.isArray(draft.brands) ? draft.brands[0] : draft.brands) as {
    name: string;
    language: string | null;
    site_type: string | null;
    industry: string | null;
    shopping_mode_enabled: boolean | null;
  };

  const open = await dbRead('draft', () =>
    supabaseAdmin
      .from('content_draft_suggestions')
      .select('id')
      .eq('draft_id', input.draftId)
      .eq('status', 'open')
      .limit(1),
  );
  if ((open ?? []).length > 0) return { pass: false, hold: 'suggestions' };

  await withContentDom();
  const html = draft.body_html ?? '';
  const blocks: TrustBlock[] = trustBlocks(html);
  const language = draftLanguage(draft.rules) ?? brand.language;
  const sourcesOn = phase >= 2;

  const [authors, inputsRow, sources, mineRows, confirms, own] = await Promise.all([
    readContentAuthors(supabaseAdmin, input.organizationId, {
      me: { id: input.actingUserId, role: input.actingRole },
    }).catch((err: Error) => {
      throw new Unread('authors', err.message.slice(0, 200));
    }),
    sourcesOn
      ? dbRead('inputs', () =>
          supabaseAdmin
            .from('content_draft_inputs')
            .select('experience, data, getcito_data, quotes')
            .eq('draft_id', input.draftId)
            .maybeSingle(),
        )
      : null,
    dbRead('sources', () =>
      supabaseAdmin.rpc('content_draft_sources', {
        p_draft_id: input.draftId,
        p_days: SOURCES_DAYS,
      }),
    ),
    dbRead('rules', () =>
      supabaseAdmin
        .from('content_rule_sets')
        .select('page_type, overrides, text_rules')
        .eq('organization_id', input.organizationId)
        .eq(
          'site_type',
          brandSiteType({ ...brand, shopping_mode_enabled: brand.shopping_mode_enabled === true }),
        ),
    ),
    phase >= 3
      ? dbRead('confirmations', () =>
          supabaseAdmin
            .from('content_draft_confirmations')
            .select('kind, key')
            .eq('draft_id', input.draftId),
        )
      : [],
    sourcesOn
      ? dbRead('images', () =>
          supabaseAdmin
            .from('content_draft_own_images')
            .select('src')
            .eq('draft_id', input.draftId),
        )
      : [],
  ]);
  const sourcesData = (sources ?? {}) as { brandDomains?: string[]; competitorDomains?: string[] };
  const brandDomains = sourcesData.brandDomains ?? [];
  const competitorDomains = sourcesData.competitorDomains ?? [];
  const keptSources: string[] = draft.kept_sources ?? [];
  const pageType = draft.page_type ?? null;

  // The sites the rules can't place, for the model's read of their kinds.
  const sites = sourcesOn
    ? unplacedSites(blocks, brandDomains, {
        competitorDomains,
        pageType,
        kept: new Set(keptSources),
      })
    : [];
  const reads = await serverReads(input, sites);
  const linkList = needed('links', reads.links);
  const linkChecks = new Map(linkList.links.map((link) => [link.href, link]));

  let claimBlocks: ClaimBlock[] | null = null;
  let pageRead: PageRead | null = null;
  let aiKinds: QualityReads['aiKinds'] = new Map();
  let facts: BrandFact[] = [];
  if (sourcesOn) {
    const claims = needed('claims', reads.claims);
    if (claims.pending > 0 || claims.limited) throw new Unread('claims', 'not_all_read');
    const kinds: readonly string[] = CLAIM_KINDS;
    claimBlocks = claims.paragraphs.map((block) => ({
      text: block.text,
      claims: block.claims.filter((claim) => kinds.includes(claim.kind)),
    }));
    const page = needed('page', reads.page);
    if (page.pending || page.limited || page.paused) {
      throw new Unread('page', page.paused ? 'ai_budget' : page.limited ? 'limited' : 'pending');
    }
    pageRead = {
      spots: page.spots,
      proofs: page.proofs,
      regulated: page.regulated,
      checks: page.checks,
    };
    const classes = needed('classes', reads.classes);
    if (classes.limited) throw new Unread('classes', 'limited');
    aiKinds = new Map(
      classes.classes.map((c) => [c.site, c.kind]),
    ) as unknown as QualityReads['aiKinds'];
    facts = needed('facts', reads.facts).facts ?? [];
  }
  const siteTrust = needed('siteTrust', reads.siteTrust);

  // The visual proof spots still open, in the editor's own document.
  let openSpots = 0;
  if (pageRead?.spots.length) {
    try {
      openSpots = openSpotPlaces(pageDoc(html), pageRead.spots).length;
    } catch (err) {
      throw new Unread('spots', (err as Error).message.slice(0, 200));
    }
  }

  // A product page's product in the brand's feed, as the editor reads it (its feedOn).
  const catalog =
    profileFor(pageType, phase) === 'product'
      ? await catalogMatchFor(supabaseAdmin, input.draftId, draft.title).catch((err: Error) => {
          throw new Unread('catalog', err.message.slice(0, 200));
        })
      : null;

  const mine: Partial<Record<string, SavedRuleSet>> = {};
  for (const row of mineRows ?? []) {
    const set = savedRuleSetSchema.safeParse({
      overrides: row.overrides,
      textRules: row.text_rules,
    });
    if (set.success && isPageType(row.page_type)) mine[row.page_type] = set.data;
  }
  const author = authors.authors.find((a) => a.id === draft.author_id) ?? null;
  const caseConfirms = new Set(
    (confirms ?? []).filter((r) => r.kind === 'customer_case').map((r) => r.key),
  );
  const introConfirms = new Set(
    (confirms ?? []).filter((r) => r.kind === 'intro_fact').map((r) => r.key),
  );

  const state = qualityState({
    html,
    blocks,
    language,
    brandName: authors.brands.find((b) => b.id === draft.brand_id)?.name ?? brand.name,
    pageType,
    phase,
    authorsRead: true,
    author,
    authorConfirmed: { real: !!draft.author_real_at, profile: !!draft.author_profile_at },
    inputs: sourcesOn
      ? inputsRow
        ? keptInputs({
            experience: inputsRow.experience,
            data: inputsRow.data,
            getcitoData: inputsRow.getcito_data,
            quotes: inputsRow.quotes,
          })
        : NO_INPUTS
      : null,
    inputsPending: false,
    linkChecks,
    brandDomains,
    competitorDomains,
    siteTrust: siteTrust
      ? {
          checks: siteTrust.checks,
          score: siteTrust.score,
          checkedAt: siteTrust.checkedAt,
          ...(typeof siteTrust.complete === 'boolean' && { complete: siteTrust.complete }),
        }
      : null,
    siteTrustRead: true,
    brandFacts: sourcesOn ? facts : null,
    keptSources,
    aiKinds,
    claimBlocks,
    pageRead: { read: pageRead, paused: false, limited: false, settled: true, changing: false },
    typeRules: typeRulesOf(
      html,
      draft.rules,
      mine,
      pageType,
      language,
      { brandDomains, competitorDomains },
      catalog,
    ),
    caseConfirms,
    introConfirms,
    casesRead: true,
    ownImages: sourcesOn ? new Set((own ?? []).map((row) => row.src)) : null,
    openSpots,
    catalog,
    now: Date.now(),
  });
  return gateVerdict({
    state,
    facts,
    sentences: blocks.flatMap((b) => sentencesOf(b.text)),
  });
}
