'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { readAssignees } from '@/lib/action-center/assignees';
import {
  DRAFT_PAGES_PER_CALL,
  DRAFT_STATUSES,
  DRAFT_CHAT,
  LIBRARY_TABS,
  PAGE_TYPES,
  agentRunOf,
  agentStateOf,
  draftConversationOf,
  draftOriginOf,
  libraryTabCounts,
  type ContentDraft,
  type ContentDraftListItem,
  type ContentOverlap,
  type DraftMethod,
  type DraftStart,
  type DraftStartOptions,
  type DraftStatus,
  type ImportedPage,
  type LibraryTab,
  type PageImportError,
  type PageType,
  missingSchemaLeftOut,
  PAGE_IMPORT_ERRORS,
} from '@/lib/content/drafts';
import { escapeHtml } from '@/lib/content/attachments';
import { IMPACT_PERIODS, type ContentImpact, type ContentResults } from '@/lib/content/impact';
import type { ContentConversions } from '@/lib/content/conversions';
import { MAX_TITLE_LENGTH, type SaveDraftResult } from '@/lib/content/editor';
import { BRAND_SITE, brandSiteType, followRestoredPageType } from '@/lib/content/draftPageType';
import { detectPageType } from '@/lib/content/pageTypes';
import { sanitizeDraftHtml } from '@/lib/content/sanitizeDraftHtml';
import type { CatalogMatch } from '@/lib/content/feedMatch';
import { catalogMatchFor } from '@/lib/content/catalogMatch';
import type { LinkCheck } from '@/lib/content/qualityChecks';
import { CLAIM_KINDS, type ClaimBlock } from '@/lib/content/claims';
import {
  PROOF_KINDS,
  type PageChecks,
  type PageQuote,
  type PageRead,
} from '@/lib/content/pageRead';
import { MAX_SOURCE_SITES, type AiSourceClass } from '@/lib/content/sourceClass';
import { draftShopping } from '@/lib/content/shoppingCheck';
import {
  NO_DRAFT_RULES,
  draftLanguage,
  draftRulesFit,
  draftRulesSchema,
  ruleSetFits,
  savedRuleSetSchema,
  startingRules,
  type DraftRulesInput,
  type LastRewrite,
  type SavedRuleSet,
} from '@/lib/content/rules';
import {
  MAX_BRIEF_BYTES,
  briefFromOpportunity,
  draftBriefSchema,
  type DraftBrief,
  type RebuildSources,
} from '@/lib/content/brief';
import { jsonbBytes } from '@/lib/content/draftInputs';
import type { ContentBrief } from '@/types';
import {
  CITED_DAYS,
  MAX_PASSAGES,
  quotedPassages,
  type CitedAnswer,
  type CitedPassage,
} from '@/lib/content/citedPassages';
import {
  MAX_DECIDE,
  SUGGESTION_STATUSES,
  suggestionLinks,
  suggestionSources,
  type DraftSuggestion,
  type SuggestionStatus,
} from '@/lib/content/suggestions';
import {
  HISTORY_DAYS,
  HISTORY_LIMIT,
  isVersionOrigin,
  type DraftHandOff,
  type DraftVersion,
  type RestoredDraft,
} from '@/lib/content/history';
import { RUN_STALE_MS } from '@/lib/content/agentRuns';
import { HANDOFF_KEYS } from '@/lib/content/handOff';
import type { AgentRule, AgentWriteRequest } from '@/lib/content/agentWrite';
import {
  actionPages,
  completeDraftTasks,
  draftMethodForTask,
  findActionDraft,
  reopenDraftTasks,
  setDraftTasksStatus,
  unpublishDraftWork,
  type ActionDraft,
} from '@/lib/content/actionDrafts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  DRAFT_SOURCE_KINDS,
  SOURCES_DAYS,
  normalizeQuery,
  type DraftSourceChoice,
  type DraftSourceKind,
  type DraftSourcesData,
} from '@/lib/content/sources';
import {
  MAX_DRAFT_PROMPTS,
  changeDraft,
  draftChangeRefused,
  insertDraft,
  isDraftId,
  keepVersion,
  promptsFor,
  saveDraft,
  startInput,
  type UpdateContentDraftResult,
} from '@/lib/content/draftWrites';
import { assertWritable } from '@/lib/subscriptionGuard';
import { isManager } from '@/lib/sessionRole';
import { refreshYears } from '@/lib/content/currentYear';

/**
 * Content drafts (Content Editor, CE-002), read through the signed-in member's
 * session: RLS (00204) keeps them to the brand's organization.
 */

/** How many drafts the Library lists, the latest changed first. */
const LIBRARY_LIMIT = 500;

/** The Library: the latest drafts, and how many each tab holds in all. */
export interface ContentLibrary {
  drafts: ContentDraftListItem[];
  counts: Record<LibraryTab, number>;
}

/**
 * Each tab's drafts counted on their own, for a brand past the Library's
 * cap: the listed rows would undercount them.
 */
async function countLibraryTabs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<Record<LibraryTab, number>> {
  const counted = await Promise.all(
    LIBRARY_TABS.map(async (tab) => {
      let query = supabase
        .from('content_drafts')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId);
      if (tab === 'archived') query = query.not('archived_at', 'is', null);
      else query = query.is('archived_at', null);
      if (tab !== 'all' && tab !== 'archived') query = query.eq('status', tab);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return [tab, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counted) as Record<LibraryTab, number>;
}

/** Ids one `in` filter takes: 100 UUIDs keep a request's address well under the edge's limit. */
const IN_CHUNK = 100;

/**
 * The last shopping check of each of these drafts (00352), by draft id: one
 * row a draft, so a chunk of ids is one request. Read apart from the drafts,
 * so the Library still lists them when the checks can't be read (00352 not
 * applied yet, or a read that fails): none is then kept, and a draft with a
 * shopping path shows as not checked yet.
 */
async function readShoppingChecks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  draftIds: string[],
): Promise<Map<string, unknown>> {
  const checks = new Map<string, unknown>();
  const chunks: string[][] = [];
  for (let i = 0; i < draftIds.length; i += IN_CHUNK) chunks.push(draftIds.slice(i, i + IN_CHUNK));
  try {
    const reads = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from('content_shopping_checks')
          .select(
            'draft_id, read_from, checked_at, categories, categories_linked, products, products_linked, bad',
          )
          .in('draft_id', chunk),
      ),
    );
    if (reads.some((read) => read.error)) return new Map();
    for (const read of reads) for (const row of read.data ?? []) checks.set(row.draft_id, row);
  } catch {
    return new Map();
  }
  return checks;
}

/**
 * The brand's drafts for the Library, the latest LIBRARY_LIMIT, with who
 * started each, and each tab's count of all its drafts.
 */
export async function getContentDrafts(brandId: string): Promise<ContentLibrary> {
  const supabase = await createClient();
  const [userRes, draftsRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('content_drafts')
      .select(
        `id, title, page_type, method, status, author, created_by, agent_state, agent_state_at, created_at, updated_at, archived_at, shopping_built:shopping_path->>builtAt, origin, ${DRAFT_CHAT}` as const,
      )
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .limit(LIBRARY_LIMIT),
  ]);
  if (draftsRes.error) throw new Error(draftsRes.error.message);
  const rows = draftsRes.data ?? [];
  const me = userRes.data.user?.id ?? null;

  const [people, checks] = await Promise.all([
    // A profile is readable only by its owner, so other members are named
    // through the same reader as Action Center's assignees.
    readAssignees(
      supabase,
      brandId,
      rows.flatMap((row) => (row.created_by ? [row.created_by] : [])),
    ),
    readShoppingChecks(
      supabase,
      rows.flatMap((row) => (row.shopping_built ? [row.id] : [])),
    ),
  ]);

  const drafts = rows.map((row): ContentDraftListItem => ({
    id: row.id,
    title: row.title,
    pageType: row.page_type,
    method: row.method as DraftMethod,
    status: draftStatus(row.status),
    author: row.author === 'agent' ? 'agent' : 'user',
    createdBy: row.created_by ? (people.get(row.created_by) ?? null) : null,
    isMine: me !== null && row.created_by === me,
    agentState: agentStateOf(row.agent_state, row.agent_state_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    shopping: draftShopping(row.shopping_built, checks.get(row.id) ?? null),
    origin: draftOriginOf(row.origin),
    conversation: draftConversationOf(row.conversation),
  }));
  // Under the cap the rows are every draft; at it, each tab is counted on its own.
  const counts =
    rows.length < LIBRARY_LIMIT
      ? libraryTabCounts(drafts)
      : await countLibraryTabs(supabase, brandId);
  return { drafts, counts };
}

function draftStatus(value: string): DraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(value) ? (value as DraftStatus) : 'draft';
}

const draftId = z.guid();
/** A kept source: an http(s) address, as the page has it. */
const keptSource = z
  .string()
  .max(2048)
  .regex(/^https?:\/\//i);

/** One draft for the editor (CE-004), or null when it isn't the member's to read. */
/** The draft as the editor reads it; before 00448, without schema_left_out. */
const DRAFT_COLUMNS_BEFORE_00448 =
  `id, brand_id, title, page_type, page_type_source, method, status, body_html, author, author_id, reviewer_id, source_url, published_url, rules, kept_sources, author_real_at, author_profile_at, action_id, agent_state, agent_state_at, agent_run, updated_at, archived_at, quality_handoff, ${BRAND_SITE}, actions(action_no), ${DRAFT_CHAT}` as const;
const DRAFT_COLUMNS = `${DRAFT_COLUMNS_BEFORE_00448}, schema_left_out` as const;

export async function getContentDraft(id: string): Promise<ContentDraft | null> {
  if (!draftId.safeParse(id).success) return null;
  const supabase = await createClient();
  const read = await supabase
    .from('content_drafts')
    .select(DRAFT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  // The web ahead of 00448: the draft without it, as not left out.
  const { data, error } = missingSchemaLeftOut(read.error)
    ? await supabase
        .from('content_drafts')
        .select(DRAFT_COLUMNS_BEFORE_00448)
        .eq('id', id)
        .maybeSingle()
    : read;
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    brandId: data.brand_id,
    title: data.title,
    pageType: data.page_type,
    pageTypeSource: data.page_type_source === 'user' ? 'user' : 'detected',
    siteType: brandSiteType(data.brands),
    sourceUrl: data.source_url,
    publishedUrl: data.published_url ?? null,
    method: data.method as DraftMethod,
    status: draftStatus(data.status),
    bodyHtml: data.body_html,
    author: data.author === 'agent' ? 'agent' : 'user',
    authorId: data.author_id,
    reviewerId: data.reviewer_id,
    rules: draftRulesSchema.safeParse(data.rules).data ?? NO_DRAFT_RULES,
    keptSources: data.kept_sources ?? [],
    authorConfirmed: { real: !!data.author_real_at, profile: !!data.author_profile_at },
    action:
      data.action_id && data.actions
        ? { id: data.action_id, number: data.actions.action_no }
        : null,
    conversation: draftConversationOf(data.conversation),
    agentState: agentStateOf(data.agent_state, data.agent_state_at),
    agentSince: data.agent_state_at,
    agentRun: agentRunOf(data.agent_run),
    updatedAt: data.updated_at,
    archivedAt: data.archived_at,
    qualityHandoff: data.quality_handoff === true,
    schemaLeftOut: 'schema_left_out' in data && data.schema_left_out === true,
  };
}

/** A draft's page, for the Library's Export. */
export interface DraftPage {
  id: string;
  title: string;
  bodyHtml: string;
  sourceUrl: string | null;
  /** Who the page is by (CE-038), for Send to CMS. */
  authorId: string | null;
  /** The qualified reviewer chosen for a regulated page (CE-049). */
  reviewerId: string | null;
  /**
   * The person confirmed their site names the page's author (00271): with
   * none picked, Send to CMS names no team, the CMS keeps its own.
   */
  authorConfirmed: boolean;
  /** The language the draft's own Language rule names, or null: the brand's. */
  language: string | null;
  /** Its page type, for the Article schema it goes out with (00448). */
  pageType: string | null;
  /** A new page (method create): its schema gives the published date too. */
  isNew: boolean;
  /** The person left out the Article schema GetCito adds (00448). */
  schemaLeftOut: boolean;
}

/**
 * A call's pages stop at about this many characters, well inside a
 * serverless response's 4.5 MB: fifty pages can each be up to 500 KB.
 */
const PAGES_RESPONSE_BUDGET = 3_000_000;

/** What one Export call returns: the pages, and the ids it left for the next. */
export interface DraftPagesRead {
  pages: DraftPage[];
  /** Ids not read for the response's size, in order; empty when all were. */
  rest: string[];
}

/**
 * The Library's Export (CE-002): the stored page of each draft given, of the
 * brand, in the order given. At most DRAFT_PAGES_PER_CALL a call, and pages
 * up to PAGES_RESPONSE_BUDGET, since every page comes back in the response:
 * the Library reads a longer list in calls, starting each with `rest`. Always
 * at least one page, so a list moves on. A draft gone meanwhile is left out.
 */
export async function getContentDraftPages(
  brandId: string,
  ids: string[],
): Promise<DraftPagesRead> {
  const parsed = z.array(z.guid()).max(DRAFT_PAGES_PER_CALL).safeParse(ids);
  if (!draftId.safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const columns =
    'id, title, body_html, source_url, author_id, reviewer_id, author_real_at, rules, page_type, method';
  const read = await supabase
    .from('content_drafts')
    .select(`${columns}, schema_left_out` as const)
    .eq('brand_id', brandId)
    .in('id', parsed.data);
  // The web ahead of 00448: the pages without it, as not left out.
  const { data, error } = missingSchemaLeftOut(read.error)
    ? await supabase
        .from('content_drafts')
        .select(columns)
        .eq('brand_id', brandId)
        .in('id', parsed.data)
    : read;
  if (error) throw new Error(error.message);
  const byId = new Map<string, DraftPage>(
    (data ?? []).map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        bodyHtml: row.body_html,
        sourceUrl: row.source_url,
        authorId: row.author_id,
        reviewerId: row.reviewer_id ?? null,
        authorConfirmed: row.author_real_at !== null,
        language: draftLanguage(row.rules),
        pageType: row.page_type,
        isNew: row.method === 'create',
        schemaLeftOut: 'schema_left_out' in row && row.schema_left_out === true,
      },
    ]),
  );
  const pages: DraftPage[] = [];
  let size = 0;
  for (const [i, id] of parsed.data.entries()) {
    const page = byId.get(id);
    if (!page) continue;
    const pageSize = page.bodyHtml.length + page.title.length + (page.sourceUrl?.length ?? 0);
    if (pages.length > 0 && size + pageSize > PAGES_RESPONSE_BUDGET) {
      return { pages, rest: parsed.data.slice(i) };
    }
    pages.push(page);
    size += pageSize;
  }
  return { pages, rest: [] };
}

/** Opportunities still open to write for, the highest scored first. */
const OPEN_OPPORTUNITY_STATUSES = ['new', 'reviewed', 'sent', 'in_progress'];

/** How many of each New content lists to pick from. */
const START_LIMIT = 500;
/** A prompt the brand was named in or cited for over these days is seen. */
const SEEN_DAYS = 30;

const startPromptsSchema = z.object({
  prompts: z.array(z.object({ id: z.string(), text: z.string(), seen: z.boolean() })),
  seen: z.number(),
});

/**
 * The brand's active prompts, each marked seen when an answer of the last
 * 30 days named the brand or cited its pages (content_start_prompts, 00230),
 * those not seen first. Before that migration, every prompt, none seen.
 */
async function readStartPrompts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<{ prompts: DraftStartOptions['prompts']; seen: number }> {
  const read = await supabase.rpc('content_start_prompts', {
    p_brand_id: brandId,
    p_days: SEEN_DAYS,
    p_limit: START_LIMIT,
  });
  if (read.error?.code !== 'PGRST202') {
    if (read.error) throw new Error(read.error.message);
    // Null: not the member's brand. Any other shape is drift between the
    // function and this schema, which throws (New content says it couldn't
    // load) rather than empty the picker.
    if (read.data === null) return { prompts: [], seen: 0 };
    return startPromptsSchema.parse(read.data);
  }
  const { data, error } = await supabase
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .eq('is_active', true)
    .order('text')
    .limit(START_LIMIT);
  if (error) throw new Error(error.message);
  return { prompts: (data ?? []).map((p) => ({ id: p.id, text: p.text, seen: false })), seen: 0 };
}

/**
 * What New content (CE-003) offers to start a new page from: the brand's
 * open Content Opportunities, its active tracked prompts (each marked seen
 * when the brand already shows in its answers) and its topics.
 */
export async function getContentStartOptions(brandId: string): Promise<DraftStartOptions> {
  const supabase = await createClient();
  const [opportunities, prompts, topics] = await Promise.all([
    supabase
      .from('content_opportunities')
      .select('id, title, decision, brief, assetType:source_data->assets->0->>type')
      .eq('brand_id', brandId)
      .in('status', OPEN_OPPORTUNITY_STATUSES)
      .order('opportunity_score', { ascending: false, nullsFirst: false })
      .limit(START_LIMIT),
    readStartPrompts(supabase, brandId),
    // Each topic's active prompts counted in the database: the prompt list
    // above stops at START_LIMIT, and would undercount a big brand's topics.
    supabase
      .from('topics')
      .select('id, name, prompts(count)')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .eq('prompts.is_active', true)
      .order('name'),
  ]);
  const failed = opportunities.error ?? topics.error;
  if (failed) throw new Error(failed.message);

  return {
    opportunities: (opportunities.data ?? []).map((o) => {
      const suggested = (o.brief as { suggestedTitle?: unknown } | null)?.suggestedTitle;
      return {
        id: o.id,
        title: refreshYears(o.title),
        decision: o.decision,
        pageTitle: typeof suggested === 'string' && suggested.trim() ? suggested.trim() : null,
        assetType: typeof o.assetType === 'string' ? o.assetType : null,
      };
    }),
    prompts: prompts.prompts,
    promptsSeen: prompts.seen,
    // A topic with no active prompt has nothing for a page to answer.
    topics: (topics.data ?? [])
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        promptCount: Number(
          (topic.prompts as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
        ),
      }))
      .filter((topic) => topic.promptCount > 0),
  };
}

/**
 * The draft being written for a tracked prompt (Tracked Prompts' Create
 * content): the latest one not yet published whose prompts include it, from
 * the prompt itself, its topic or an opportunity. Opened instead of starting
 * a second page. Null when there is none, or the member can't read it.
 */
export async function getDraftForPrompt(brandId: string, promptId: string): Promise<string | null> {
  if (!draftId.safeParse(brandId).success || !draftId.safeParse(promptId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('id')
    .eq('brand_id', brandId)
    .contains('prompt_ids', [promptId])
    .in('status', ['draft', 'in_review', 'ready'])
    // An archived draft isn't the one to open (00233).
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/** How many opportunities one Open draft lookup covers: a page of the list. */
const MAX_DRAFT_LOOKUPS = 200;

/**
 * The draft being written for each opportunity (Generate Content's Open
 * draft): the latest one not yet published started from it, by opportunity
 * id. Opportunities with none, or that the member can't read, are left out.
 */
export async function getOpportunityDrafts(
  brandId: string,
  opportunityIds: string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(opportunityIds)]
    .filter((id) => draftId.safeParse(id).success)
    .slice(0, MAX_DRAFT_LOOKUPS);
  if (!draftId.safeParse(brandId).success || !ids.length) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('id, opportunity_id')
    .eq('brand_id', brandId)
    .in('opportunity_id', ids)
    .in('status', ['draft', 'in_review', 'ready'])
    // Archived is set aside (00233): the row offers Send to Editor again.
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const drafts: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.opportunity_id && !(row.opportunity_id in drafts)) {
      drafts[row.opportunity_id] = row.id;
    }
  }
  return drafts;
}

/**
 * A page of the brand's, read for Optimize content › Page URL and for
 * Start's "Optimize this page instead" (CE-003): its main content, title and
 * schema, through the API's guarded fetch, which reads only the brand's own
 * domains and never a private address. A page that can't be read comes back
 * as the reason, not a throw: production hides a server action's errors.
 */
export async function importContentPage(
  brandId: string,
  url: string,
): Promise<{ page: ImportedPage } | { error: PageImportError; status?: number }> {
  if (!draftId.safeParse(brandId).success || !url.trim() || url.length > 2048) {
    return { error: 'invalid_url' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-pages/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, url: url.trim() }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = body.code as PageImportError;
      return {
        error: (PAGE_IMPORT_ERRORS as readonly string[]).includes(code) ? code : 'failed',
        ...(typeof body.status === 'number' && { status: body.status }),
      };
    }
    return {
      page: {
        url: String(body.url),
        title: String(body.title ?? ''),
        html: String(body.html ?? ''),
      },
    };
  } catch (err) {
    console.error('Failed to import a page:', err);
    return { error: 'failed' };
  }
}

/**
 * The saved draft's links, read by the API for Trust (Quality spec §2.2):
 * whether each answers and how old its page is, each read at most once a
 * day; `skipped` are the links it never reads (one-time or account links).
 * The API reads the links from the draft as saved, never from here. The
 * reason comes back, not a throw: production hides a server action's errors.
 */
export async function checkDraftLinks(
  id: string,
): Promise<{ links: LinkCheck[]; skipped: string[] } | { error: 'invalid' | 'failed' }> {
  if (!draftId.safeParse(id).success) return { error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-pages/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ draftId: id }),
    });
    if (!res.ok) return { error: 'failed' };
    const body = (await res.json()) as { links?: LinkCheck[]; skipped?: string[] };
    return { links: body.links ?? [], skipped: body.skipped ?? [] };
  } catch (err) {
    console.error('Failed to check the draft links:', err);
    return { error: 'failed' };
  }
}

/**
 * The kinds of sites the editor's rules can't place (Quality CE-046, part
 * b), as the API's model reads them (POST /api/content-pages/source-
 * classes): only sites the draft links as saved, 20 at a time, each read
 * kept for every workspace. 'ai_budget' when the workspace's AI budget is
 * spent; 'off' before Quality's phase 2 is live on the API.
 */
export async function classifyDraftSources(
  id: string,
  sites: string[],
): Promise<
  | { classes: { site: string; kind: AiSourceClass }[]; limited: boolean }
  | { error: 'invalid' | 'failed' | 'ai_budget' | 'off' }
> {
  if (!draftId.safeParse(id).success || !sites.length || sites.length > MAX_SOURCE_SITES) {
    return { error: 'invalid' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-pages/source-classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ draftId: id, sites }),
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return { error: body.code === 'ai_budget' ? 'ai_budget' : 'failed' };
    }
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return { error: body.code === 'off' ? 'off' : 'failed' };
    }
    if (!res.ok) return { error: 'failed' };
    const body = (await res.json()) as {
      classes?: { site: string; kind: AiSourceClass }[];
      limited?: boolean;
    };
    return { classes: body.classes ?? [], limited: body.limited ?? false };
  } catch (err) {
    console.error('Failed to read the draft sources:', err);
    return { error: 'failed' };
  }
}

/**
 * Quality's claims in the draft's own words (CE-045): the API reads the
 * draft as saved, each block the model hasn't read yet, and leaves the one
 * the person is writing in (`writingIn`, its text as Trust reads it; null
 * when they aren't). Returned, not thrown: 'ai_budget'
 * when the workspace's AI budget is spent; 'off' before Quality's phase 2
 * is live on the API.
 */
export async function checkDraftClaims(
  id: string,
  writingIn: string | null,
): Promise<
  | { blocks: ClaimBlock[]; pending: number; limited: boolean }
  | { error: 'invalid' | 'failed' | 'ai_budget' | 'off' }
> {
  if (!draftId.safeParse(id).success) return { error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-pages/claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      // A block too long to send as one is read all the same.
      body: JSON.stringify({
        draftId: id,
        skip: (typeof writingIn === 'string' ? writingIn.slice(0, 20000) : '') || undefined,
      }),
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return { error: body.code === 'ai_budget' ? 'ai_budget' : 'failed' };
    }
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return { error: body.code === 'off' ? 'off' : 'failed' };
    }
    if (!res.ok) return { error: 'failed' };
    const body = (await res.json()) as {
      paragraphs?: ClaimBlock[];
      pending?: number;
      limited?: boolean;
    };
    const kinds: readonly string[] = CLAIM_KINDS;
    return {
      blocks: (body.paragraphs ?? []).map((block) => ({
        text: block.text,
        claims: block.claims.filter((claim) => kinds.includes(claim.kind)),
      })),
      pending: body.pending ?? 0,
      limited: body.limited ?? false,
    };
  } catch (err) {
    console.error('Failed to read the draft claims:', err);
    return { error: 'failed' };
  }
}

/**
 * "Team" in Start (CE-015): the draft sent to the Action Center as an action
 * for someone on the team to write (the API's fromContentDraft.js), or the
 * one still open if it was sent already. Returned, not thrown: production
 * hides a server action's errors.
 */
export async function sendContentDraftToActionCenter(
  brandId: string,
  id: string,
): Promise<{ actionId: string; actionNo: number; created: boolean } | { error: string }> {
  if (!draftId.safeParse(brandId).success || !draftId.safeParse(id).success) {
    return { error: 'invalid' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/action-center/content-drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, draftId: id }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { error: String(body.details || body.error || `Server error: ${res.status}`) };
    }
    return {
      actionId: String(body.actionId),
      actionNo: Number(body.actionNo),
      created: Boolean(body.created),
    };
  } catch (err) {
    console.error('Failed to send a draft to the Action Center:', err);
    return { error: 'failed' };
  }
}

/** The drafts linked to an action (CE-022), for its writing tasks: open one, or start it. */
async function readActionDrafts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  actionId: string,
): Promise<ActionDraft[]> {
  const { data, error } = await supabase
    .from('content_drafts')
    .select('id, method, source_url, status')
    .eq('brand_id', brandId)
    .eq('action_id', actionId)
    // Archived is set aside, as on the Plan and in MCP: the drawer doesn't
    // list it, and a task's Start writes a new draft rather than reopen it.
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    method: row.method === 'create' ? 'create' : 'optimize',
    sourceUrl: row.source_url,
    status: draftStatus(row.status),
  }));
}

/** The drafts written for an action's tasks, for the Action Center drawer. */
export async function getActionDrafts(brandId: string, actionId: string): Promise<ActionDraft[]> {
  if (!draftId.safeParse(brandId).success || !draftId.safeParse(actionId).success) return [];
  return readActionDrafts(await createClient(), brandId, actionId);
}

const actionStartInput = z.object({
  brandId: z.guid(),
  actionId: z.guid(),
  taskId: z.guid(),
  page: z.string().max(2048).nullable(),
  // The action's own title, for one whose payload names none.
  title: z.string().max(5_000),
});

/**
 * "Create content" or "Optimize page" on an action's writing task (CE-022,
 * spec §15): the draft for that work, linked to the action, or the one
 * already written for it. A new draft takes what the action knows: its
 * title, the page it names (brought in from the live site, as Start does),
 * its prompts and its opportunity; the page type is detected and follows the
 * page. The task moves to In progress.
 *
 * The action and task are read through the member's session, so only their
 * organization's can start one; the draft is then written by the server, as
 * its action_id is server-set (00208), with the member as its author. Two
 * starts at once find the same draft (00218). Returned, not thrown:
 * production hides a server action's errors.
 */
export async function startDraftFromAction(
  brandId: string,
  actionId: string,
  taskId: string,
  options: { page: string | null; title: string },
): Promise<
  | { draftId: string; created: boolean; importFailed: boolean }
  | { error: 'invalid' | 'not_found' | 'failed' }
> {
  await assertWritable({ brandId });
  const parsed = actionStartInput.safeParse({ brandId, actionId, taskId, ...options });
  if (!parsed.success) return { error: 'invalid' };
  const { page } = parsed.data;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: 'failed' };

    const [actionRes, taskRes] = await Promise.all([
      supabase
        .from('actions')
        .select('id, payload')
        .eq('brand_id', brandId)
        .eq('id', actionId)
        // A deleted action (00168) starts no work.
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('action_tasks')
        .select('id, task_key, status')
        .eq('action_id', actionId)
        .eq('id', taskId)
        .maybeSingle(),
    ]);
    if (actionRes.error) throw new Error(actionRes.error.message);
    if (taskRes.error) throw new Error(taskRes.error.message);
    if (!actionRes.data || !taskRes.data) return { error: 'not_found' };
    const payload = (actionRes.data.payload ?? {}) as Record<string, unknown>;
    const method = draftMethodForTask(taskRes.data.task_key);
    // A page is one the action names, and only an existing page's work has one.
    if (
      !method ||
      (page !== null && (method === 'create' || !actionPages(payload).includes(page)))
    ) {
      return { error: 'invalid' };
    }

    const linked = await readActionDrafts(supabase, brandId, actionId);
    const existing = findActionDraft(linked, method, page);
    if (existing) return { draftId: existing.id, created: false, importFailed: false };

    let title = typeof payload.title === 'string' ? payload.title.trim() : '';
    let bodyHtml: string | undefined;
    let importFailed = false;
    if (page) {
      const imported = await importContentPage(brandId, page);
      if ('page' in imported) {
        bodyHtml = imported.page.html;
        title ||= imported.page.title.trim();
      } else {
        importFailed = true;
      }
    }
    title = (title || parsed.data.title.trim()).slice(0, MAX_TITLE_LENGTH).trim();
    const body =
      bodyHtml !== undefined
        ? sanitizeDraftHtml(bodyHtml)
        : title
          ? `<h1>${escapeHtml(title)}</h1>`
          : '';
    const rules = startingRules(method, bodyHtml !== undefined ? body : undefined);

    const wantedPrompts = Array.isArray(payload.promptIds)
      ? payload.promptIds
          .filter((id): id is string => typeof id === 'string' && draftId.safeParse(id).success)
          .slice(0, MAX_DRAFT_PROMPTS)
      : [];
    const opportunity =
      typeof payload.opportunityId === 'string' && draftId.safeParse(payload.opportunityId).success
        ? payload.opportunityId
        : null;
    // Only what the member's brand still has: a deleted prompt or opportunity drops out.
    const [brandRes, promptsRes, opportunityRes] = await Promise.all([
      supabase
        .from('brands')
        .select('site_type, industry, shopping_mode_enabled')
        .eq('id', brandId)
        .maybeSingle(),
      wantedPrompts.length
        ? supabase
            .from('prompts')
            .select('id, prompt_sets!inner(brand_id)')
            .eq('prompt_sets.brand_id', brandId)
            .in('id', wantedPrompts)
        : Promise.resolve({ data: [] as { id: string }[], error: null }),
      opportunity
        ? supabase
            .from('content_opportunities')
            .select('id')
            .eq('brand_id', brandId)
            .eq('id', opportunity)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (brandRes.error) throw new Error(brandRes.error.message);
    if (promptsRes.error) throw new Error(promptsRes.error.message);
    if (opportunityRes.error) throw new Error(opportunityRes.error.message);

    const { data: inserted, error } = await supabaseAdmin
      .from('content_drafts')
      .insert({
        brand_id: brandId,
        created_by: user.id,
        author: 'user',
        method,
        title,
        // The page's address is the strongest sign of its type, as in Start.
        page_type: detectPageType({ title, html: body, url: page }, brandSiteType(brandRes.data)),
        page_type_source: 'detected',
        body_html: body,
        opportunity_id: opportunityRes.data?.id ?? null,
        source_url: page,
        prompt_ids: [...new Set((promptsRes.data ?? []).map((p) => p.id))],
        action_id: actionId,
        // A page brought in to optimize aims at its own length, not a new page's.
        ...(rules.importLength ? { rules } : {}),
        // Made from an Action Center task (00463, W4-10).
        origin: 'action_center',
      })
      .select('id')
      .single();
    if (error) {
      // Started twice at once: the other start wrote it.
      if (error.code === '23505') {
        const winner = findActionDraft(
          await readActionDrafts(supabase, brandId, actionId),
          method,
          page,
        );
        if (winner) return { draftId: winner.id, created: false, importFailed: false };
      }
      throw new Error(error.message);
    }

    // A page brought in from its address starts History as the live page.
    if (bodyHtml !== undefined) await keepVersion(supabase, inserted.id, 'import');
    if (taskRes.data.status === 'todo') {
      // The draft is started either way; the task's status can be set in the drawer.
      await setDraftTasksStatus(
        supabase,
        { id: inserted.id, brandId, actionId },
        [taskId],
        'in_progress',
        user.id,
      ).catch((err) => console.error("Failed to start the action's task:", err));
    }
    return { draftId: inserted.id, created: true, importFailed };
  } catch (err) {
    console.error('Failed to start a draft from an action:', err);
    return { error: 'failed' };
  }
}

/**
 * The Impact tab (CE-016): what the page a draft optimizes earns over the
 * last `days` against the `days` before (content_page_impact, 00209). Null
 * when the member can't read the brand.
 */
export async function getContentImpact(
  brandId: string,
  page: string,
  days: number,
): Promise<ContentImpact | null> {
  if (!impactArgsValid(brandId, page, days)) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_page_impact', {
    p_brand_id: brandId,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return (data as ContentImpact | null) ?? null;
}

/**
 * The Impact tab's results from AI visits (CE-016): the page's AI visits per
 * AI source over the last `days`, with Google Analytics' key events,
 * purchases and revenue from them (content_page_results, 00210). Null when
 * the member can't read the brand.
 */
export async function getContentResults(
  brandId: string,
  page: string,
  days: number,
): Promise<ContentResults | null> {
  if (!impactArgsValid(brandId, page, days)) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_page_results', {
    p_brand_id: brandId,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return (data as ContentResults | null) ?? null;
}

/**
 * Conversions of AI journeys through the page (CE-017, 00287), for the Live
 * page tab's period: from the AI Traffic snippet with conversions on.
 */
export async function getContentConversions(
  brandId: string,
  page: string,
  days: number,
): Promise<ContentConversions | null> {
  if (!impactArgsValid(brandId, page, days)) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_page_conversions', {
    p_brand_id: brandId,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return (data as ContentConversions | null) ?? null;
}

/** A brand id, a period the tab offers and a web page's address. */
function impactArgsValid(brandId: string, page: string, days: number): boolean {
  return (
    draftId.safeParse(brandId).success &&
    (IMPACT_PERIODS as readonly number[]).includes(days) &&
    /^https?:\/\//i.test(page)
  );
}

const overlapSource = startInput.shape.source;

/**
 * Start's overlap check (CE-015): the brand's own pages AI cites for the
 * prompts a page started from this source would answer (00207), with prompts
 * in common, citations and Google position. Nothing to check for content
 * brought to optimize: it is the page itself.
 */
export async function getContentOverlap(
  brandId: string,
  source: DraftStart['source'],
): Promise<ContentOverlap> {
  const parsed = overlapSource.safeParse(source);
  if (!draftId.safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { promptIds } = await promptsFor(supabase, brandId, parsed.data);
  const prompts = [...new Set(promptIds)];
  if (!prompts.length) return { totalPrompts: 0, pages: [] };
  const { data, error } = await supabase.rpc('content_page_overlap', {
    p_brand_id: brandId,
    p_prompt_ids: prompts,
  });
  if (error) throw new Error(error.message);
  return {
    totalPrompts: prompts.length,
    pages: (data ?? []).map((row) => ({
      url: row.page,
      title: row.title,
      promptsInCommon: row.prompts_in_common,
      citations: Number(row.citations),
      gscPosition: row.gsc_position === null ? null : Number(row.gsc_position),
    })),
  };
}

/**
 * A draft started from New content and Start (CE-003, CE-015), by the
 * signed-in member (insertDraft: its type, what it is for, its first text).
 */
export async function createContentDraft(brandId: string, start: DraftStart): Promise<string> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  return insertDraft(supabase, brandId, user.id, start);
}

/**
 * The editor's autosave, by the signed-in member: written only over the
 * version the editor last saw (saveDraft says how a write in between is met).
 */
export async function saveContentDraft(
  id: string,
  input: {
    title: string;
    bodyHtml: string;
    base: { updatedAt: string; bodyHash: string; unconfirmedHash?: string };
  },
): Promise<SaveDraftResult> {
  await assertWritable();
  return saveDraft(await createClient(), id, input);
}

/**
 * A change to a draft's title or page from Chat: update_draft (CHAT-20 §9
 * row 55), by the signed-in member (changeDraft: History keeps the page
 * before, then it is saved as the editor saves). Admins and Managers, checked
 * here (DECISIONS T: an Analyst's Chat creates drafts, and changes none).
 * Errors come back as values (#427).
 */
export async function updateContentDraft(
  id: string,
  change: { title?: string; bodyHtml?: string },
): Promise<UpdateContentDraftResult> {
  try {
    await assertWritable();
    if (!isDraftId(id)) return draftChangeRefused('invalid');
    const supabase = await createClient();
    if (!(await isManager(supabase))) return draftChangeRefused('forbidden_role');
    return await changeDraft(supabase, id, change);
  } catch (err) {
    console.error('Failed to change the draft from Chat:', err);
    return draftChangeRefused('failed');
  }
}

const pageTypeInput = z.enum(PAGE_TYPES);

/**
 * A page type the person picked (CE-023): from now on the draft keeps it,
 * whatever the page says. Throws 'not_found' when no row changed.
 */
export async function setContentDraftPageType(id: string, pageType: PageType): Promise<void> {
  await assertWritable();
  if (!draftId.safeParse(id).success || !pageTypeInput.safeParse(pageType).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ page_type: pageType, page_type_source: 'user' })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
}

/** 00257's refusal of an author from another organization (a check violation). */
const OTHER_ORGANIZATION = '23514';

/**
 * The person a page is by (CE-038), or null for the organization byline:
 * page metadata, never its text. The database takes only an author of the
 * brand's organization (00257). A save over it isn't a conflict: the page
 * is the same.
 */
export async function setContentDraftAuthor(id: string, authorId: string | null): Promise<void> {
  await assertWritable();
  if (
    !draftId.safeParse(id).success ||
    (authorId !== null && !z.guid().safeParse(authorId).success)
  ) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ author_id: authorId })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error?.code === OTHER_ORGANIZATION) throw new Error('invalid');
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
}

/**
 * Sets the qualified person who reviewed a regulated page (Quality CE-049,
 * 00273), one of Authors, or none. The database checks they are the brand's
 * organization's.
 */
export async function setContentDraftReviewer(
  id: string,
  reviewerId: string | null,
): Promise<void> {
  await assertWritable();
  if (
    !draftId.safeParse(id).success ||
    (reviewerId !== null && !z.guid().safeParse(reviewerId).success)
  ) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ reviewer_id: reviewerId })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error?.code === OTHER_ORGANIZATION) throw new Error('invalid');
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
}

/**
 * Confirms, or takes back, what the person says of the author their site
 * names (00271): a real person (`real`), their profile with a bio and links
 * (`profile`). Who and when are stamped by the database, from the session.
 */
export async function confirmDraftAuthor(
  id: string,
  what: 'real' | 'profile',
  on: boolean,
): Promise<void> {
  await assertWritable();
  if (
    !draftId.safeParse(id).success ||
    (what !== 'real' && what !== 'profile') ||
    typeof on !== 'boolean'
  ) {
    throw new Error('invalid');
  }
  const at = on ? new Date().toISOString() : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update(what === 'real' ? { author_real_at: at } : { author_profile_at: at })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
}

/**
 * Leaves out, or adds back, the Article schema GetCito adds to the page it
 * sends to a CMS and exports (customer priorities item 7, 00448): for a CMS
 * that writes its own. Never throws; false when it couldn't be saved.
 */
export async function setDraftSchemaLeftOut(id: string, leftOut: boolean): Promise<boolean> {
  if (!draftId.safeParse(id).success || typeof leftOut !== 'boolean') return false;
  try {
    await assertWritable();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('content_drafts')
      .update({ schema_left_out: leftOut })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    // Not saved, the web ahead of 00448 too (missingSchemaLeftOut): the editor puts it back.
    if (error || !data) {
      if (error) console.error('[content-drafts] could not keep the schema choice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[content-drafts] could not keep the schema choice:', err);
    return false;
  }
}

/**
 * Keeps a weak source or a competitor's on the page (Quality CE-046): the
 * person trusts it, so it no longer lowers Trust. Returns the draft's kept
 * sources after; 'full' when the page keeps 50 already.
 */
export async function keepDraftSource(id: string, url: string): Promise<string[]> {
  await assertWritable();
  if (!draftId.safeParse(id).success || !keptSource.safeParse(url).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_draft_keep_source', {
    p_draft_id: id,
    p_url: url,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  if (!data.includes(url)) throw new Error('full');
  return data;
}

/** The statuses the Library's row menu sets directly; Ready goes through markContentDraftReady. */
const ROW_STATUSES = ['draft', 'in_review', 'published'] as const;

/**
 * Set a draft's status from the Library's row menu (any member, as the
 * editor's own status changes). Ready keeps a History version and completes
 * the draft's task, so it goes through markContentDraftReady instead. A
 * ready or published draft moved back to Draft or In review opens again the
 * task Ready completed, as the editor's Ready does when clicked; a published
 * one also opens again the Publish task a page's publish completed, and
 * leaves what its action is measured on (unpublishDraftWork).
 */
export async function setContentDraftStatus(
  id: string,
  status: (typeof ROW_STATUSES)[number],
): Promise<void> {
  await assertWritable();
  if (!draftId.safeParse(id).success || !(ROW_STATUSES as readonly string[]).includes(status)) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data: before, error: readError } = await supabase
    .from('content_drafts')
    .select('status, brand_id, method, action_id')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!before) throw new Error('not_found');
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  const wasDone = before.status === 'ready' || before.status === 'published';
  if (wasDone && status !== 'published') await reopenTasksOf(supabase, id, before);
  if (before.status === 'published' && status !== 'published') {
    await unpublishOf(supabase, id, before);
  }
}

/**
 * A published draft taken back, in its action (unpublishDraftWork). The
 * draft's status has changed either way: a failure is logged, and a task
 * left done can be changed in the drawer.
 */
async function unpublishOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  draft: { brand_id: string; action_id: string | null },
): Promise<void> {
  if (!draft.action_id) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await unpublishDraftWork(
      supabase,
      { id, brandId: draft.brand_id, actionId: draft.action_id },
      user?.id ?? null,
    );
  } catch (err) {
    console.error('Failed to take the page back in its action:', err);
  }
}

/**
 * Send a draft to the Library's archive, or restore it (admins and
 * managers; 00233's trigger refuses anyone else). It keeps its status.
 */
export async function archiveContentDraft(id: string, archived: boolean): Promise<void> {
  await assertWritable();
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) {
    // Restoring one while a newer draft does the same task's work (the
    // one-per-work key, 00233): that one goes to the archive first.
    if (error.code === '23505') throw new Error('newer_draft');
    throw new Error(error.code === '42501' ? 'forbidden' : error.message);
  }
  if (!data) throw new Error('not_found');
}

/**
 * Delete a draft for good (admins and managers; content_drafts' delete
 * policy, 00233). Its versions, sources and suggestions go with it.
 */
export async function deleteContentDraft(id: string): Promise<void> {
  await assertWritable();
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.from('content_drafts').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  // No row: not the member's to delete, or gone already.
  if (!data?.length) throw new Error('forbidden');
}

const readyAnyway = z.object({
  trust: z.number().int().min(0).max(100),
  // The check the warning named (claimsSourced…) and how many it counted.
  reason: z
    .string()
    .regex(/^[A-Za-z]{1,40}$/)
    .nullable(),
  count: z.number().int().min(0).nullable(),
});

/**
 * Mark ready: a draft, or an agent's draft in review, is ready to publish.
 * GetCito never publishes it; the person does (CE-013 records the URL).
 * Returns the status the draft has after, so a draft already ready or
 * published keeps its own, and how many of its action's tasks it completed
 * (CE-022; completeDraftTasks). Marked ready past Before you publish's
 * warning (CE-041), it is logged with the Trust the page had and the check
 * the warning named (00260 content_draft_ready_log).
 */
export async function markContentDraftReady(
  id: string,
  anyway?: { trust: number; reason: string | null; count: number | null },
): Promise<{ status: DraftStatus; tasksDone: number }> {
  await assertWritable();
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const logged = anyway === undefined ? null : readyAnyway.safeParse(anyway);
  if (logged && !logged.success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ status: 'ready' })
    .eq('id', id)
    .in('status', ['draft', 'in_review'])
    .select('status, brand_id, method, action_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    await keepVersion(supabase, id, 'ready');
    if (logged) {
      // The draft is ready either way; a log that didn't go in is reported.
      const { error: logError } = await supabase.from('content_draft_ready_log').insert({
        draft_id: id,
        trust: logged.data.trust,
        reason: logged.data.reason,
        reason_count: logged.data.count,
      });
      if (logError) console.error('Failed to log Mark ready anyway:', logError.message);
    }
    let tasksDone = 0;
    if (data.action_id) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // The draft is ready either way; a task left open can be ticked in the drawer.
      try {
        tasksDone = await completeDraftTasks(
          supabase,
          {
            id,
            brandId: data.brand_id,
            actionId: data.action_id,
            method: data.method === 'create' ? 'create' : 'optimize',
          },
          user?.id ?? null,
        );
      } catch (err) {
        console.error("Failed to complete the action's task:", err);
      }
    }
    return { status: draftStatus(data.status), tasksDone };
  }
  const current = await getContentDraft(id);
  if (!current) throw new Error('not_found');
  return { status: current.status, tasksDone: 0 };
}

/**
 * Ready, clicked in the editor's header (Next step spec §3b): the page goes
 * back to review, only while it is still ready. One published from the
 * Library meanwhile keeps its status. Returns the status the draft has after,
 * and how many of its action's tasks, completed by Ready, it opened again
 * (reopenDraftTasks).
 */
export async function unmarkContentDraftReady(
  id: string,
): Promise<{ status: DraftStatus; tasksReopened: number }> {
  await assertWritable();
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ status: 'in_review' })
    .eq('id', id)
    .eq('status', 'ready')
    .select('status, brand_id, method, action_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    return {
      status: draftStatus(data.status),
      tasksReopened: await reopenTasksOf(supabase, id, data),
    };
  }
  const current = await getContentDraft(id);
  if (!current) throw new Error('not_found');
  return { status: current.status, tasksReopened: 0 };
}

/**
 * The tasks a draft's Ready completed in its action, open again once the
 * draft isn't ready or published any more (reopenDraftTasks). The draft's
 * status has changed either way: a failure is logged, and a task left done
 * can be changed in the drawer.
 */
async function reopenTasksOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  draft: { brand_id: string; method: string; action_id: string | null },
): Promise<number> {
  if (!draft.action_id) return 0;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return await reopenDraftTasks(
      supabase,
      {
        id,
        brandId: draft.brand_id,
        actionId: draft.action_id,
        method: draft.method === 'create' ? 'create' : 'optimize',
      },
      user?.id ?? null,
    );
  } catch (err) {
    console.error("Failed to reopen the action's task:", err);
    return 0;
  }
}

/** History (CE-018): the draft's versions of the last 90 days, the latest first. */
export async function getDraftVersions(id: string): Promise<DraftVersion[]> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('content_draft_versions')
    .select('id, origin, title, created_at')
    .eq('draft_id', id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) =>
    isVersionOrigin(row.origin)
      ? [{ id: row.id, origin: row.origin, title: row.title, createdAt: row.created_at }]
      : [],
  );
}

/**
 * When the draft's page was last restored from History (00289: set each time
 * a restore changes the page), or null. The agent's batch from before it was
 * for the page before: the editor opens its card closed.
 */
export async function getLastRestoreAt(id: string): Promise<string | null> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('restored_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.restored_at ?? null;
}

/**
 * History's hand-offs (Quality CE-051): the draft's runs of Hand off (00275,
 * its members may read them) in the last 90 days, the latest first, each
 * with who started it, how it ended and how many checks it was given.
 */
export async function getDraftHandoffs(id: string): Promise<DraftHandOff[]> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('content_agent_runs')
    .select('id, origin, outcome, steps, started_at, stopped_at')
    .eq('draft_id', id)
    .eq('kind', 'handoff')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const steps = Array.isArray(row.steps)
      ? (row.steps as { key?: unknown; count?: unknown }[])
      : [];
    const count = (key: string) => {
      const n = steps.find((step) => step?.key === key)?.count;
      return Number.isInteger(n) ? (n as number) : null;
    };
    // Stopped before its outcome was written; or left by a server that
    // stopped, past the longest run (RUN_STALE_MS): not under way.
    const outcome =
      row.outcome === 'done' || row.outcome === 'stopped' || row.outcome === 'failed'
        ? row.outcome
        : row.stopped_at
          ? 'stopped'
          : Date.now() - Date.parse(row.started_at) > RUN_STALE_MS
            ? 'failed'
            : null;
    return {
      id: row.id,
      origin: row.origin === 'auto' ? 'auto' : 'person',
      outcome,
      checks: count('read_checks'),
      changes: outcome === 'done' ? count('write_changes') : null,
      startedAt: row.started_at,
    };
  });
}

/**
 * Restores a version (CE-018): the draft as it is now is kept in History
 * first, so nothing is lost, then takes the version's title and body
 * (00215 content_draft_restore). A draft whose type follows its page gets
 * the restored page's type, as a save would give it, so the Library shows
 * it. Throws 'not_found' when the version is unknown, past its 90 days, or
 * another organization's.
 */
export async function restoreDraftVersion(id: string, versionId: string): Promise<RestoredDraft> {
  await assertWritable();
  if (!draftId.safeParse(id).success || !draftId.safeParse(versionId).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_draft_restore', {
    p_version_id: versionId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  const restored = data as unknown as RestoredDraft;
  const updatedAt = await followRestoredPageType(supabase, id, restored);
  return {
    title: restored.title,
    bodyHtml: restored.bodyHtml,
    updatedAt,
    ...(typeof restored.restored === 'boolean' ? { restored: restored.restored } : {}),
  };
}

/**
 * History keeps the page before an agent's suggestions change it (CE-018):
 * the editor saves what is waiting, then calls this before the first one it
 * accepts. A failure is logged, not thrown: the suggestion can be undone.
 */
export async function keepAgentBeforeVersion(id: string): Promise<void> {
  await assertWritable();
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  await keepVersion(supabase, id, 'agent_before');
}

/**
 * The draft's last page rewrite, whatever became of it, as the API kept it
 * (00285): the characters it came to, the Length it was written to and what
 * it kept, and the page it wrote, for the editor to count as its toolbar
 * does (the API's count runs a little over). A Length it missed isn't
 * offered again (rules.ts RewriteReach). One row, read on opening and
 * whenever the rewrite shown changes. Null without one, or for one made
 * before 00285 (after_chars marks those).
 */
export async function getLastPageRewrite(
  id: string,
): Promise<(LastRewrite & { html: string }) | null> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_draft_suggestions')
    .select('after_text, after_chars, length_target, kept_chars')
    .eq('draft_id', id)
    .eq('kind', 'page')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.after_chars === null || data.kept_chars === null) return null;
  return {
    chars: data.after_chars,
    target: data.length_target,
    kept: data.kept_chars,
    html: data.after_text,
  };
}

/**
 * An agent's suggestions on the draft (CE-018, 00217): its latest batch, in
 * the order the agent left them, with the Action Center action it came from.
 */
export async function getDraftSuggestions(id: string): Promise<DraftSuggestion[]> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  // The latest batch first, one row and no text: a past rewrite's two whole
  // pages are never read again (this runs on every open, and while Fix waits).
  const { data: latest, error: latestError } = await supabase
    .from('content_draft_suggestions')
    .select('batch_id')
    .eq('draft_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);
  if (!latest) return [];
  const { data, error } = await supabase
    .from('content_draft_suggestions')
    .select(
      'id, batch_id, action_id, kind, block_text, before_text, before_html, after_text, after_links, reason, rule_keys, position, status, created_at, sources, source_marks, actions(action_no)',
    )
    .eq('draft_id', id)
    .eq('batch_id', latest.batch_id)
    .limit(MAX_DECIDE);
  if (error) throw new Error(error.message);
  const statuses: readonly string[] = SUGGESTION_STATUSES;
  return (data ?? [])
    .filter((row) => statuses.includes(row.status))
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const action = (Array.isArray(row.actions) ? row.actions[0] : row.actions) as {
        action_no: number;
      } | null;
      // What it was written from (00248); an insert's marks are by its text,
      // within its HTML's length. A page names its sources, with no marks.
      const { sources, marks } = suggestionSources(
        row.sources,
        row.kind === 'page' ? null : row.source_marks,
        row.after_text,
      );
      return {
        id: row.id,
        batchId: row.batch_id,
        actionId: row.action_id,
        actionNo: action?.action_no ?? null,
        kind: row.kind === 'insert' || row.kind === 'page' ? row.kind : 'replace',
        blockText: row.block_text,
        beforeText: row.before_text,
        afterText: row.after_text,
        afterLinks:
          row.kind === 'replace' ? suggestionLinks(row.after_links, row.after_text) : null,
        beforeHtml: row.kind === 'page' ? row.before_html : null,
        reason: row.reason,
        ruleKeys: row.rule_keys ?? [],
        status: row.status as SuggestionStatus,
        createdAt: row.created_at,
        sources,
        sourceMarks: marks,
      };
    });
}

const decideInput = z.object({
  ids: z.array(z.guid()).min(1).max(MAX_DECIDE),
  status: z.enum(SUGGESTION_STATUSES),
});

/**
 * Accepts, rejects or sends back to review (open) a draft's suggestions,
 * recording who decided (00217 content_draft_decide_suggestions). Throws
 * 'not_found' when none changed.
 */
export async function decideDraftSuggestions(
  ids: string[],
  status: SuggestionStatus,
): Promise<number> {
  await assertWritable();
  const parsed = decideInput.safeParse({ ids, status });
  if (!parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_draft_decide_suggestions', {
    p_ids: parsed.data.ids,
    p_status: parsed.data.status,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  return data;
}

const citedInput = z.array(z.string().max(5_000)).max(MAX_PASSAGES);

/**
 * Locked passages (CE-018): which of the page's passages the AI answers that
 * cite it quote, over the last 30 days (00216 content_draft_cited_answers),
 * matched here so the answers stay on the server. Null when the member can't
 * read the draft; none for a draft without a page.
 */
export async function getCitedPassages(
  id: string,
  passages: string[],
): Promise<CitedPassage[] | null> {
  if (!draftId.safeParse(id).success || !citedInput.safeParse(passages).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('content_draft_cited_answers', {
    p_draft_id: id,
    p_days: CITED_DAYS,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  return quotedPassages(passages, data as unknown as CitedAnswer[]);
}

/**
 * The Sources tab (CE-008): the brand's data a draft draws on, over the last
 * 30 days (content_draft_sources, 00211), with the person's choices on it.
 * Null when the member can't read the draft.
 */
export async function getDraftSources(
  id: string,
): Promise<{ data: DraftSourcesData; choices: DraftSourceChoice[] } | null> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const [sourcesRes, choicesRes, trustedRes] = await Promise.all([
    supabase.rpc('content_draft_sources', { p_draft_id: id, p_days: SOURCES_DAYS }),
    supabase.from('content_draft_sources').select('kind, ref, included, added').eq('draft_id', id),
    // The sites the draft's brand trusts (00449). A database before it, or a
    // read that fails, trusts none: Trust reads the page as before.
    supabase.from('content_drafts').select('brands(trusted_sources)').eq('id', id).maybeSingle(),
  ]);
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);
  if (choicesRes.error) throw new Error(choicesRes.error.message);
  if (!sourcesRes.data) return null;
  const kinds: readonly string[] = DRAFT_SOURCE_KINDS;
  const trusted = trustedRes.error ? null : trustedRes.data?.brands?.trusted_sources;
  return {
    data: {
      ...(sourcesRes.data as unknown as DraftSourcesData),
      trustedDomains: Array.isArray(trusted) ? trusted : [],
    },
    choices: (choicesRes.data ?? [])
      .filter((row) => kinds.includes(row.kind))
      .map((row) => ({
        kind: row.kind as DraftSourceKind,
        ref: row.ref,
        included: row.included,
        added: row.added,
      })),
  };
}

const sourceChoice = z.object({
  kind: z.enum(DRAFT_SOURCE_KINDS),
  ref: z.string().min(1).max(2048),
  included: z.boolean(),
});

/** Keeps a source in the draft's sources, or leaves it out (CE-008). */
export async function setDraftSourceIncluded(
  id: string,
  choice: { kind: DraftSourceKind; ref: string; included: boolean },
): Promise<void> {
  await assertWritable();
  const parsed = sourceChoice.safeParse(choice);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { error } = await supabase.from('content_draft_sources').upsert(
    {
      draft_id: id,
      kind: parsed.data.kind,
      ref: parsed.data.ref,
      included: parsed.data.included,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'draft_id,kind,ref' },
  );
  if (error) throw new Error(error.message);
}

const addedSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), promptId: z.guid() }),
  z.object({
    kind: z.literal('cited_page'),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((url) => {
        try {
          return /^https?:$/.test(new URL(url).protocol);
        } catch {
          return false;
        }
      }),
  }),
  z.object({ kind: z.literal('gsc_query'), query: z.string().trim().min(1).max(2048) }),
]);

export type AddedDraftSource = z.infer<typeof addedSource>;

/**
 * + Add source (CE-008): a prompt joins the draft's prompts (its fan-outs
 * and cited pages follow); a page address or a Search Console query is kept
 * as added by hand. Throws 'not_found' when the draft isn't the member's.
 */
export async function addDraftSource(id: string, source: AddedDraftSource): Promise<void> {
  await assertWritable();
  const parsed = addedSource.safeParse(source);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const now = new Date().toISOString();

  if (parsed.data.kind === 'prompt') {
    await addDraftPrompts(id, [parsed.data.promptId]);
    return;
  }

  const ref =
    parsed.data.kind === 'cited_page' ? parsed.data.url : normalizeQuery(parsed.data.query);
  const { error } = await supabase
    .from('content_draft_sources')
    .upsert(
      { draft_id: id, kind: parsed.data.kind, ref, included: true, added: true, updated_at: now },
      { onConflict: 'draft_id,kind,ref' },
    );
  if (error) throw new Error(error.message);
}

const promptIdList = z.array(z.guid()).min(1).max(100);

/**
 * Prompts join the draft's prompts (Sources' + Add source, Impact's "Use
 * lost prompts"); one left out of the sources before is back in. Throws
 * 'not_found' when the draft isn't the member's.
 */
export async function addDraftPrompts(id: string, promptIds: string[]): Promise<void> {
  await assertWritable();
  const parsed = promptIdList.safeParse(promptIds);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('prompt_ids')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error('not_found');
  const current: string[] = draft.prompt_ids ?? [];
  const added = parsed.data.filter((promptId) => !current.includes(promptId));
  if (added.length) {
    // check_content_draft_links (00206) refuses a prompt of another brand.
    const { error: updateError } = await supabase
      .from('content_drafts')
      .update({ prompt_ids: [...current, ...added] })
      .eq('id', id);
    if (updateError) throw new Error(updateError.message);
  }
  const { error: choiceError } = await supabase
    .from('content_draft_sources')
    .update({ included: true, updated_at: new Date().toISOString() })
    .eq('draft_id', id)
    .eq('kind', 'prompt')
    .in('ref', parsed.data);
  if (choiceError) throw new Error(choiceError.message);
}

/**
 * The Brief tab (CE-007): the draft's brief, or, until it has one, the brief
 * of the opportunity it started from. Null when the member can't read the
 * draft.
 */
export async function getDraftBrief(id: string): Promise<{ brief: DraftBrief | null } | null> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('brief, opportunity_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) return null;
  const own = draftBriefSchema.safeParse(draft.brief);
  if (own.success) return { brief: own.data };
  // A brief of its own this editor can't read: said as a failed read, never
  // as the opportunity's or none, so Edit brief can't write over it.
  if (draft.brief != null) {
    console.error('The draft brief can’t be read:', own.error.issues.slice(0, 3));
    return null;
  }
  if (!draft.opportunity_id) return { brief: null };
  const { data: opportunity, error: oppError } = await supabase
    .from('content_opportunities')
    .select('brief')
    .eq('id', draft.opportunity_id)
    .maybeSingle();
  if (oppError) throw new Error(oppError.message);
  const brief = opportunity?.brief as ContentBrief | null | undefined;
  return { brief: brief?.outline ? briefFromOpportunity(brief) : null };
}

/** Edit brief (CE-007): the brief as the person wrote it. Throws 'not_found' when no row changed. */
export async function saveDraftBrief(id: string, brief: DraftBrief): Promise<DraftBrief> {
  await assertWritable();
  const parsed = draftBriefSchema.safeParse({ ...brief, origin: 'edit' });
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  // The column's 64 KB (00212): said, not a failed save.
  if (jsonbBytes(parsed.data) > MAX_BRIEF_BYTES) throw new Error('too_long');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ brief: parsed.data })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  return parsed.data;
}

const BRIEF_REBUILD_ERRORS = [
  'ai_budget',
  'no_subscription',
  'no_sources',
  /** Stopped from the editor (CE-027): the brief stays as it was. */
  'stopped',
  'failed',
] as const;
export type BriefRebuildError = (typeof BRIEF_REBUILD_ERRORS)[number];

/**
 * Rebuild outline (CE-007): the server writes the brief from the sources
 * kept, metered from the organization's AI usage (contentBrief.js).
 */
export async function rebuildDraftBrief(
  id: string,
  brandId: string,
  sources: RebuildSources,
  /** The rules in effect, as the agent reads them: the brief plans to them (brief rules, 2026). */
  rules?: AgentRule[],
): Promise<{ brief: DraftBrief } | { error: BriefRebuildError }> {
  if (!draftId.safeParse(id).success || !draftId.safeParse(brandId).success) {
    return { error: 'failed' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-drafts/${id}/brief`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, sources, ...(rules?.length ? { rules } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = body.code as BriefRebuildError;
      return {
        error: (BRIEF_REBUILD_ERRORS as readonly string[]).includes(code) ? code : 'failed',
      };
    }
    const brief = draftBriefSchema.safeParse(body.brief);
    return brief.success ? { brief: brief.data } : { error: 'failed' };
  } catch (err) {
    console.error('Failed to rebuild the brief:', err);
    return { error: 'failed' };
  }
}

const AGENT_FIX_ERRORS = [
  'ai_budget',
  'no_subscription',
  'empty',
  'open_suggestions',
  'published',
  /** Start or a rewrite holds the draft (another tab, another member). */
  'writing',
  /** Another fix or hand-off on the draft is under way (another tab, the editor's own). */
  'running',
  /** Stopped from the editor (CE-027): nothing it wrote is kept. */
  'stopped',
  'failed',
  /** No answer from the API (a timeout on the way): the agent may still finish. */
  'unconfirmed',
] as const;
export type AgentFixError = (typeof AGENT_FIX_ERRORS)[number];

/** What Fix open rules with agent sends: the rules still open, and the passages kept locked. */
export interface AgentFixRequest {
  rules: { key: string; name: string; detail: string }[];
  /** Rules in the person's own words, to follow as well. */
  textRules: string[];
  /** The locked passages, by passageKey. */
  locked: string[];
  /** The sources the Sources tab keeps, which the agent writes from (v1.1 CE-033). */
  sources?: RebuildSources;
  /** The page over a Length it isn't sent (rules.ts overLengthFor). */
  overLength?: { count: number; max: number };
}

/** Why a run left nothing to review (contentAgent.js emptyWhy). */
export type AgentEmptyWhy = 'none' | 'locked' | 'dropped';

const fixEmptyWhy = (why: unknown): { why?: AgentEmptyWhy } =>
  why === 'none' || why === 'locked' || why === 'dropped' ? { why } : {};

/**
 * Fix open rules with agent (CE-018): the Content Agent reads the draft as
 * saved and leaves suggestions on the rules sent, for review in the page,
 * metered from the organization's AI usage (contentAgent.js). count is how
 * many it left: none when it found nothing it could change.
 */
export async function fixDraftRules(
  id: string,
  brandId: string,
  request: AgentFixRequest,
): Promise<{ count: number; why?: AgentEmptyWhy } | { error: AgentFixError }> {
  if (!draftId.safeParse(id).success || !draftId.safeParse(brandId).success) {
    return { error: 'failed' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-drafts/${id}/suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        brandId,
        rules: request.rules.slice(0, 40).map((rule) => ({
          key: rule.key.slice(0, 60),
          name: rule.name.slice(0, 200),
          detail: rule.detail.slice(0, 500),
        })),
        textRules: request.textRules.slice(0, 50).map((text) => text.slice(0, 300)),
        locked: request.locked.slice(0, 500).map((key) => key.slice(0, 5000)),
        // Already within the server's limits (rebuildSources).
        ...(request.sources ? { sources: request.sources } : {}),
        ...(request.overLength ? { overLength: request.overLength } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // The API says why; a gateway's page (a timeout) says nothing of the run.
      if (typeof body.code !== 'string') return { error: 'unconfirmed' };
      const code = body.code as AgentFixError;
      return { error: (AGENT_FIX_ERRORS as readonly string[]).includes(code) ? code : 'failed' };
    }
    return { count: Number(body.count) || 0, ...fixEmptyWhy(body.why) };
  } catch (err) {
    console.error('Failed to run the Content Agent:', err);
    return { error: 'unconfirmed' };
  }
}

/** Why a hand-off didn't run: Fix's reasons, and an automatic one's (CE-051). */
const HANDOFF_ERRORS = [
  ...AGENT_FIX_ERRORS,
  /** An automatic hand-off on a draft its brand doesn't hand off. */
  'not_due',
  /** The draft had its automatic hand-off. */
  'already',
  /** The API has Quality's phase 2 off (its CONTENT_QUALITY_PHASE is behind the web's). */
  'off',
] as const;
export type HandOffError = (typeof HANDOFF_ERRORS)[number];

/** What Hand off sends (CE-051): the page's fixable checks, as Fix sends its rules' context. */
export interface HandOffRequest extends Omit<AgentFixRequest, 'rules'> {
  /** Each fixable check open on the page, by its suggestion key, with what it names there. */
  items: { key: string; detail: string }[];
  /** A person's Hand off, or the editor's on its own (Settings › Content). */
  origin: 'person' | 'auto';
}

/**
 * Hand it off to Content Agent (Quality spec §5, CE-051): the agent fixes
 * the page's open Quality checks in one run, as suggestions for review,
 * metered from the organization's AI usage (contentHandoff.js). count is
 * how many it left.
 */
export async function handOffDraft(
  id: string,
  brandId: string,
  request: HandOffRequest,
): Promise<{ count: number; why?: AgentEmptyWhy } | { error: HandOffError }> {
  if (!draftId.safeParse(id).success || !draftId.safeParse(brandId).success) {
    return { error: 'failed' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-drafts/${id}/handoff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        brandId,
        items: request.items.slice(0, HANDOFF_KEYS.size).map((item) => ({
          key: item.key.slice(0, 60),
          detail: item.detail.slice(0, 500),
        })),
        textRules: request.textRules.slice(0, 50).map((text) => text.slice(0, 300)),
        locked: request.locked.slice(0, 500).map((key) => key.slice(0, 5000)),
        ...(request.sources ? { sources: request.sources } : {}),
        ...(request.overLength ? { overLength: request.overLength } : {}),
        origin: request.origin,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (typeof body.code !== 'string') return { error: 'unconfirmed' };
      const code = body.code as HandOffError;
      return { error: (HANDOFF_ERRORS as readonly string[]).includes(code) ? code : 'failed' };
    }
    return { count: Number(body.count) || 0, ...fixEmptyWhy(body.why) };
  } catch (err) {
    console.error('Failed to hand the draft off:', err);
    return { error: 'unconfirmed' };
  }
}

const AGENT_WRITE_ERRORS = [
  'ai_budget',
  'no_subscription',
  'writing',
  'org_writing',
  'open_suggestions',
  // A Fix open rules or Quality's hand-off still under way on the draft (contentWriter.js).
  'running',
  'not_draft',
  // Rewrite the page to these rules: a page with no text, or one too long to send whole.
  'empty',
  'too_long',
  'failed',
] as const;
export type AgentWriteError = (typeof AGENT_WRITE_ERRORS)[number];

/**
 * Start's Agent (CE-015): the API's Content Agent does the draft in the
 * background (contentWriter.js) — a new page written whole, an existing
 * page's suggestions left — and the draft goes to In review. Returns once it
 * has started. Returned, not thrown: production hides a server action's
 * errors.
 */
export async function startAgentWriting(
  id: string,
  brandId: string,
  request: AgentWriteRequest,
): Promise<{ started: true } | { error: AgentWriteError }> {
  return startAgentRun('write', id, brandId, request);
}

/**
 * Rewrite the page to these rules: the API's Content Agent rewrites the whole
 * page in the background (contentWriter.js, rewrite) and leaves it as ONE
 * suggestion to compare and accept or reject. Returns once it has started;
 * 'empty' for a page with no text, 'too_long' for one too long to send whole.
 */
export async function startPageRewrite(
  id: string,
  brandId: string,
  request: AgentWriteRequest,
): Promise<{ started: true } | { error: AgentWriteError }> {
  return startAgentRun('rewrite', id, brandId, request);
}

async function startAgentRun(
  path: 'write' | 'rewrite',
  id: string,
  brandId: string,
  request: AgentWriteRequest,
): Promise<{ started: true } | { error: AgentWriteError }> {
  if (!draftId.safeParse(id).success || !draftId.safeParse(brandId).success) {
    return { error: 'failed' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-drafts/${id}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, ...request }),
    });
    if (res.ok) return { started: true };
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    const code = body.code as AgentWriteError;
    return { error: AGENT_WRITE_ERRORS.includes(code) ? code : 'failed' };
  } catch (err) {
    console.error(`Failed to start the Content Agent (${path}):`, err);
    return { error: 'failed' };
  }
}

/**
 * The Rules tab (CE-009): a rule turned on or off, or given a value, for
 * this draft ("Rule updated for this draft"). Throws 'not_found' when no
 * row changed.
 */
export async function saveDraftRules(id: string, rules: DraftRulesInput): Promise<void> {
  await assertWritable();
  const parsed = draftRulesSchema.safeParse(rules);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  if (!draftRulesFit(parsed.data)) throw new Error('too_large');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ rules: parsed.data })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
}

/**
 * The workspace's My rules (CE-009, 00214) for the brand's kind of site
 * (00227), by page type: what a new draft of the type starts from. Sets that
 * don't read as rules are left out.
 */
export async function getMyRuleSets(
  brandId: string,
): Promise<Partial<Record<PageType, SavedRuleSet>>> {
  if (!draftId.safeParse(brandId).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('organization_id, site_type, industry, shopping_mode_enabled')
    .eq('id', brandId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand?.organization_id) return {};
  const { data, error } = await supabase
    .from('content_rule_sets')
    .select('page_type, overrides, text_rules')
    .eq('organization_id', brand.organization_id)
    .eq('site_type', brandSiteType(brand));
  if (error) throw new Error(error.message);
  const sets: Partial<Record<PageType, SavedRuleSet>> = {};
  for (const row of data ?? []) {
    const set = savedRuleSetSchema.safeParse({
      overrides: row.overrides,
      textRules: row.text_rules,
    });
    if (pageTypeInput.safeParse(row.page_type).success && set.success) {
      sets[row.page_type as PageType] = set.data;
    }
  }
  return sets;
}

/**
 * Save as my rules (CE-009): a draft's rule choices become the workspace's
 * set for the page type on the brand's kind of site (00227), for every draft
 * of it that starts after.
 */
export async function saveMyRuleSet(
  brandId: string,
  pageType: PageType,
  set: SavedRuleSet,
): Promise<void> {
  await assertWritable({ brandId });
  const parsed = savedRuleSetSchema.safeParse(set);
  if (
    !draftId.safeParse(brandId).success ||
    !pageTypeInput.safeParse(pageType).success ||
    !parsed.success
  ) {
    throw new Error('invalid');
  }
  if (!ruleSetFits(parsed.data)) throw new Error('too_large');
  const supabase = await createClient();
  const [userRes, brandRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('brands')
      .select('organization_id, site_type, industry, shopping_mode_enabled')
      .eq('id', brandId)
      .maybeSingle(),
  ]);
  if (brandRes.error) throw new Error(brandRes.error.message);
  const userId = userRes.data.user?.id;
  const organizationId = brandRes.data?.organization_id;
  if (!userId || !organizationId) throw new Error('not_found');
  const { error } = await supabase.from('content_rule_sets').upsert(
    {
      organization_id: organizationId,
      site_type: brandSiteType(brandRes.data),
      page_type: pageType,
      overrides: parsed.data.overrides,
      text_rules: parsed.data.textRules,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,site_type,page_type' },
  );
  if (error) throw new Error(error.message);
}

/** The page read's checks as the API gives them (CE-050), each found one with its words; else null. */
function pageChecksOf(value: unknown): PageChecks | null {
  if (!value || typeof value !== 'object') return null;
  const checks = value as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const quote = (v: unknown): PageQuote | null => {
    const find = v as Partial<PageQuote> | null;
    return find && text(find.quote) && text(find.block)
      ? { quote: find.quote, block: find.block }
      : null;
  };
  const first = checks.answerFirst as { answers?: unknown; block?: unknown } | null;
  return {
    answerFirst:
      first && typeof first.answers === 'boolean' && text(first.block)
        ? { answers: first.answers, block: first.block }
        : null,
    recommends: quote(checks.recommends),
    disclosure: quote(checks.disclosure),
    balance: quote(checks.balance),
    how: quote(checks.how),
    cut: checks.cut === true,
    pageType: typeof checks.pageType === 'string' ? checks.pageType : null,
  };
}

/**
 * Quality's page read for proof (CE-049): the draft's visual proof spots
 * and proof asks, read by the API from the page as saved, with its page
 * type and the brand's business type; once a minute at most (`pending`:
 * the kept read stands, ask again), `limited` once the draft's page reads
 * for the day are made, `paused` when the AI budget is spent. Returned, not
 * thrown: 'off' before Quality's phase 2 is live on the API.
 */
export async function readDraftPage(
  id: string,
): Promise<
  | (PageRead & { pending: boolean; limited: boolean; paused: boolean })
  | { error: 'invalid' | 'failed' | 'off' }
> {
  if (!draftId.safeParse(id).success) return { error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-pages/page-read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ draftId: id }),
    });
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return { error: body.code === 'off' ? 'off' : 'failed' };
    }
    if (!res.ok) return { error: 'failed' };
    const body = (await res.json()) as Partial<Omit<PageRead, 'checks'>> & {
      checks?: unknown;
      pending?: boolean;
      limited?: boolean;
      paused?: boolean;
    };
    const kinds: readonly string[] = PROOF_KINDS;
    const text = (value: unknown) => typeof value === 'string' && value.length > 0;
    return {
      spots: (body.spots ?? []).filter(
        (s) => text(s.passage) && text(s.block) && text(s.image) && text(s.alt),
      ),
      proofs: (body.proofs ?? []).filter(
        (p) => text(p.claim) && text(p.block) && kinds.includes(p.kind),
      ),
      regulated:
        body.regulated === 'health' || body.regulated === 'finance' || body.regulated === 'legal'
          ? body.regulated
          : null,
      checks: pageChecksOf(body.checks),
      pending: body.pending ?? false,
      limited: body.limited ?? false,
      paused: body.paused ?? false,
    };
  } catch (err) {
    console.error('Failed to read the draft page:', err);
    return { error: 'failed' };
  }
}

/** The cap trigger's check violation: the draft keeps 50 confirmed images (00270). */
const OWN_IMAGES_FULL = '23514';

/** An image's address as the page and the database keep it (00270: 8–2048 characters, http(s)). */
const ownImageSrc = z
  .string()
  .min(8)
  .max(2048)
  .regex(/^https?:\/\//);

/**
 * The page's images a member confirmed are their own, not stock (Quality
 * CE-049, 00270): E-E-A-T's visual proof. Fails soft: none, when they
 * can't be read.
 */
export async function getOwnImages(id: string): Promise<string[]> {
  if (!draftId.safeParse(id).success) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('content_draft_own_images')
      .select('src')
      .eq('draft_id', id);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.src);
  } catch (err) {
    console.error('Failed to read the own images:', err);
    return [];
  }
}

/**
 * Confirms an image on the page is the member's own (00270): their
 * statement, kept with who made it, as themself and now. Confirmed already
 * is fine; 'full' when the draft keeps 50.
 */
export async function confirmOwnImage(id: string, src: string): Promise<'ok' | 'full'> {
  await assertWritable();
  if (!draftId.safeParse(id).success || !ownImageSrc.safeParse(src).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('not_found');
  const { error } = await supabase
    .from('content_draft_own_images')
    // When: the database's now (its default), the time its policy checks against.
    .upsert(
      { draft_id: id, src, confirmed_by: user.id },
      { onConflict: 'draft_id,src', ignoreDuplicates: true },
    );
  if (error?.code === OWN_IMAGES_FULL) return 'full';
  if (error) throw new Error(error.message);
  return 'ok';
}

/** What a member can confirm on a draft that only they know (Quality CE-052, 00280). */
export type ConfirmationKind = 'customer_case' | 'intro_fact';
const confirmationKind = z.enum(['customer_case', 'intro_fact']);
const confirmationKey = z.string().min(1).max(400);

/**
 * The draft's confirmations (00280): what a member said only they could (a
 * customer case may be published; a category intro's facts are right), by
 * kind and key. Fails soft: none, when they can't be read.
 */
export async function getDraftConfirmations(
  id: string,
): Promise<{ kind: ConfirmationKind; key: string }[]> {
  if (!draftId.safeParse(id).success) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('content_draft_confirmations')
      .select('kind, key')
      .eq('draft_id', id);
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((row) =>
      confirmationKind.safeParse(row.kind).success
        ? [{ kind: row.kind as ConfirmationKind, key: row.key }]
        : [],
    );
  } catch (err) {
    console.error('Failed to read the confirmations:', err);
    return [];
  }
}

/**
 * Confirms one (00280): the member's statement, kept with who made it, as
 * themself and now. Confirmed already is fine; 'full' when the draft keeps 50.
 */
export async function confirmDraftItem(
  id: string,
  kind: ConfirmationKind,
  key: string,
): Promise<'ok' | 'full'> {
  await assertWritable();
  if (
    !draftId.safeParse(id).success ||
    !confirmationKind.safeParse(kind).success ||
    !confirmationKey.safeParse(key).success
  ) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('not_found');
  const { error } = await supabase
    .from('content_draft_confirmations')
    // When: the database's now (its default), the time its policy checks against.
    .upsert(
      { draft_id: id, kind, key, confirmed_by: user.id },
      { onConflict: 'draft_id,kind,key', ignoreDuplicates: true },
    );
  if (error?.code === OWN_IMAGES_FULL) return 'full';
  if (error) throw new Error(error.message);
  return 'ok';
}

/**
 * The draft's product in the brand's catalog (00278; Quality CE-053): by
 * the page's URL (an optimize draft's), else by its title, when one product
 * has it. Says whether a catalog is connected at all, so Quality can say to
 * connect one. Fails soft: null, when it can't be read.
 */
export async function getCatalogMatch(id: string, title: string): Promise<CatalogMatch | null> {
  if (!draftId.safeParse(id).success) return null;
  try {
    return await catalogMatchFor(await createClient(), id, title);
  } catch (err) {
    console.error('Failed to read the catalog:', err);
    return null;
  }
}
