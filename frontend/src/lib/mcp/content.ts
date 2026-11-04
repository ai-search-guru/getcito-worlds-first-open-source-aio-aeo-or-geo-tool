import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  SHOPPING_COLUMNS,
  lastSendsOf,
  mcpShoppingLinks,
  mcpShoppingPath,
  type McpLastSend,
  type McpShoppingLinks,
  type McpShoppingPath,
} from './contentDelivery';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { brandAllowed, mayUseBrand } from '@/lib/mcp/data';
import {
  draftPassages,
  keepAgentSuggestions,
  type AgentSuggestionInput,
  type DroppedReason,
} from '@/lib/content/agentSuggestions';
import { classifyDomain, extractHostname, normalizeDomain } from '@/lib/citations/classify';
import { completeDraftTasks } from '@/lib/content/actionDrafts';
import { CITED_DAYS, passageKey, quotedPassages } from '@/lib/content/citedPassages';
import { agentStateOf, contentEditorPath, isPageType, type PageType } from '@/lib/content/drafts';
import { IMPACT_PERIODS } from '@/lib/content/impact';
import { detectPageType, siteTypeOf } from '@/lib/content/pageTypes';
import { sanitizeDraftHtml } from '@/lib/content/sanitizeDraftHtml';
import { SOURCES_DAYS } from '@/lib/content/sources';
import {
  MAX_OWN_PAGES,
  linkAllowList,
  pickLinkTargets,
  type LinkTargets,
} from '@/lib/content/linkTargets';

/**
 * The Content Editor's API for agents (CE-022, spec §15): what a person does
 * in the editor, an agent does through the same data — open or create a
 * draft, read Impact and Sources, add a source, leave suggestions, set
 * Ready. Agents never accept their own suggestions, publish, or change a
 * passage AI answers quote (locked, CE-018).
 *
 * As the rest of the MCP layer: the service role, with an explicit check
 * that the draft's brand is the API key's organization's. A draft outside
 * it reads as not found.
 */

/** The most drafts list_content_drafts returns, the latest changed first. */
const LIST_LIMIT = 100;

const DRAFT_COLUMNS =
  'id, brand_id, title, status, method, page_type, author, source_url, published_url, published_at, body_html, action_id, prompt_ids, updated_at, agent_state, agent_state_at, brands!inner(organization_id, site_type, industry, shopping_mode_enabled), actions(action_no)';

interface DraftRow {
  id: string;
  brand_id: string;
  title: string;
  status: string;
  method: string;
  page_type: string | null;
  author: string;
  source_url: string | null;
  /** Where the page went live (Send to CMS or marked published, 00262), as the Live page tab reads it. */
  published_url: string | null;
  /** When it went live, set with published_url (00262). */
  published_at: string | null;
  body_html: string;
  action_id: string | null;
  prompt_ids: string[] | null;
  updated_at: string;
  agent_state: string | null;
  agent_state_at: string | null;
  actions: { action_no: number } | { action_no: number }[] | null;
}

/** A draft of a brand the caller may use, or null. */
async function draftFor(auth: McpAuthContext, draftId: string): Promise<DraftRow | null> {
  if (!auth.organizationId) return null;
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .select(DRAFT_COLUMNS)
    .eq('id', draftId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const draft = (data as unknown as DraftRow | null) ?? null;
  return draft && (await mayUseBrand(auth, draft.brand_id)) ? draft : null;
}

const actionNo = (row: DraftRow) => {
  const action = Array.isArray(row.actions) ? row.actions[0] : row.actions;
  return action?.action_no ?? null;
};

/**
 * The passages AI answers quote today, by key: from the answers citing the
 * draft's page over 30 days (00216), matched as the editor matches them.
 */
async function lockedKeys(draft: DraftRow, texts: string[]): Promise<Set<string>> {
  if (!draft.source_url) return new Set();
  const { data, error } = await supabaseAdmin.rpc('content_draft_cited_answers', {
    p_draft_id: draft.id,
    p_days: CITED_DAYS,
  });
  if (error) throw new Error(error.message);
  const answers = (data ?? []) as { platform: string; response: string }[];
  return new Set(quotedPassages(texts, answers).map((p) => p.key));
}

/** How many of a draft's newest suggestions are read to find its latest batch. */
const LATEST_BATCH_ROWS = 200;

/**
 * The draft's latest batch's suggestions still waiting for a person: the
 * editor shows only that batch, so a new one would hide them (and Undo on
 * the ones accepted).
 */
async function openSuggestionsOf(draftId: string) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_suggestions')
    .select('id, kind, reason, batch_id, status, created_at')
    .eq('draft_id', draftId)
    .order('created_at', { ascending: false })
    .limit(LATEST_BATCH_ROWS);
  if (error) throw new Error(error.message);
  const batch = data?.[0]?.batch_id;
  return (data ?? [])
    .filter((s) => s.batch_id === batch && s.status === 'open')
    .map((s) => ({ id: s.id, kind: s.kind, reason: s.reason }));
}

/** Whether the address is on one of the brand's domains, or a subdomain of one. */
async function onBrandDomain(brandId: string, url: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  const host = extractHostname(url);
  const brandDomains = (data ?? []).map((r) => normalizeDomain(r.domain)).filter(Boolean);
  return !!host && classifyDomain(host, { brandDomains, competitorDomains: [] }) === 'you';
}

export interface McpDraftSummary {
  id: string;
  title: string;
  status: string;
  method: string;
  page_type: string | null;
  author: string;
  source_url: string | null;
  open_suggestions: number;
  updated_at: string;
  editor_path: string;
  /** Its last Send to CMS, as the Library shows it; null when never sent. */
  last_send: McpLastSend | null;
  /** Whether its shopping links still sell. */
  shopping_links: McpShoppingLinks;
}

/** How many agent suggestions wait for review on each draft, by draft id. */
async function openSuggestionCounts(draftIds: string[]): Promise<Map<string, number>> {
  const open = new Map<string, number>();
  if (!draftIds.length) return open;
  const { data, error } = await supabaseAdmin
    .from('content_draft_suggestions')
    .select('draft_id')
    .in('draft_id', draftIds)
    .eq('status', 'open');
  if (error) throw new Error(error.message);
  for (const s of data ?? []) open.set(s.draft_id, (open.get(s.draft_id) ?? 0) + 1);
  return open;
}

/** A brand's drafts, the latest changed first; null for a brand outside the organization. */
export async function listContentDraftsFor(
  auth: McpAuthContext,
  brandId: string,
  status?: string,
): Promise<McpDraftSummary[] | null> {
  if (!(await brandAllowed(auth, brandId))) return null;
  let query = supabaseAdmin
    .from('content_drafts')
    .select(
      `id, title, status, method, page_type, author, source_url, updated_at, ${SHOPPING_COLUMNS}`,
    )
    .eq('brand_id', brandId)
    // Archived drafts (00233) are set aside in the Library, and here.
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const ids = rows.map((r) => r.id);
  const [open, sends] = await Promise.all([openSuggestionCounts(ids), lastSendsOf(ids)]);
  return rows.map(({ shopping_built, content_shopping_checks, ...row }) => ({
    ...row,
    open_suggestions: open.get(row.id) ?? 0,
    editor_path: contentEditorPath(row.id),
    last_send: sends.get(row.id) ?? null,
    shopping_links: mcpShoppingLinks(shopping_built, content_shopping_checks),
  }));
}

export interface McpDraft {
  id: string;
  brand_id: string;
  title: string;
  status: string;
  method: string;
  page_type: string | null;
  author: string;
  source_url: string | null;
  /** Where and since when the page is live (00262): null until it goes live. */
  published_url: string | null;
  published_at: string | null;
  action: { id: string; number: number | null } | null;
  editor_path: string;
  body_html: string;
  /** The page passage by passage, as suggest_content_changes numbers them. */
  passages: { n: number; tag: string; text: string; locked: boolean }[];
  /** The latest batch's suggestions still waiting for a person. */
  open_suggestions: { id: string; kind: string; reason: string }[];
  /**
   * Where suggest_content_changes may link (Content Agent rule gaps, A): the
   * brand's own pages for internal links, the draft's sources for outbound
   * links and inline citations. A link to anything else is unwrapped.
   */
  link_targets: { own_pages: LinkTargets['own']; sources: LinkTargets['sources'] };
  /** Its last Send to CMS; null when never sent. */
  last_send: McpLastSend | null;
  /** What the page should link on an online shop (its Brief tab); null for none. */
  shopping_path: McpShoppingPath | null;
  /** Whether its shopping links still sell. */
  shopping_links: McpShoppingLinks;
}

/** One draft, its passages numbered and the locked ones marked; null outside the organization. */
export async function getContentDraftFor(
  auth: McpAuthContext,
  draftId: string,
): Promise<McpDraft | null> {
  const draft = await draftFor(auth, draftId);
  if (!draft) return null;
  const passages = draftPassages(draft.body_html);
  const [locked, openSuggestions, targets, sends, shopping] = await Promise.all([
    lockedKeys(
      draft,
      passages.map((p) => p.text),
    ),
    openSuggestionsOf(draft.id),
    linkTargetsOf(draft),
    lastSendsOf([draft.id]),
    supabaseAdmin
      .from('content_drafts')
      .select(`shopping_path, ${SHOPPING_COLUMNS}`)
      .eq('id', draft.id)
      .maybeSingle(),
  ]);
  if (shopping.error) throw new Error(shopping.error.message);

  return {
    id: draft.id,
    brand_id: draft.brand_id,
    title: draft.title,
    status: draft.status,
    method: draft.method,
    page_type: draft.page_type,
    author: draft.author,
    source_url: draft.source_url,
    published_url: draft.published_url,
    published_at: draft.published_at,
    action: draft.action_id ? { id: draft.action_id, number: actionNo(draft) } : null,
    editor_path: contentEditorPath(draft.id),
    body_html: draft.body_html,
    passages: passages.map((p, i) => ({
      n: i + 1,
      tag: p.tag,
      text: p.text,
      locked: locked.has(passageKey(p.text)),
    })),
    open_suggestions: openSuggestions,
    link_targets: { own_pages: targets.own, sources: targets.sources },
    last_send: sends.get(draft.id) ?? null,
    shopping_path: mcpShoppingPath(shopping.data?.shopping_path ?? null),
    shopping_links: mcpShoppingLinks(
      shopping.data?.shopping_built ?? null,
      shopping.data?.content_shopping_checks ?? null,
    ),
  };
}

/**
 * The draft's link targets (pickLinkTargets): the brand's pages from
 * site_pages, and its sources from the content_draft_sources RPC and the
 * person's choices. A failed read leaves its list empty.
 */
async function linkTargetsOf(draft: {
  id: string;
  brand_id: string;
  source_url: string | null;
}): Promise<LinkTargets> {
  const [pages, sources, choices] = await Promise.all([
    supabaseAdmin
      .from('site_pages')
      .select('url, title, h1')
      .eq('brand_id', draft.brand_id)
      // Not fetched yet, or answered: 0 is a fetch that failed outright (00104).
      .or('fetch_status.is.null,and(fetch_status.gte.200,fetch_status.lt.400)')
      .order('ai_citations', { ascending: false })
      .order('ga_sessions', { ascending: false })
      .limit(MAX_OWN_PAGES + 1),
    supabaseAdmin.rpc('content_draft_sources', { p_draft_id: draft.id, p_days: SOURCES_DAYS }),
    supabaseAdmin
      .from('content_draft_sources')
      .select('ref, included, added')
      .eq('draft_id', draft.id)
      .eq('kind', 'cited_page'),
  ]);
  for (const [what, read] of [
    ['site pages', pages],
    ['sources', sources],
    ['source choices', choices],
  ] as const) {
    if (read.error) console.error(`Failed to read the draft's link targets (${what}):`, read.error);
  }
  return pickLinkTargets({
    pages: pages.error ? [] : (pages.data ?? []),
    sources: sources.error ? null : sources.data,
    choices: choices.error ? [] : (choices.data ?? []),
    sourceUrl: draft.source_url,
  });
}

export interface CreateDraftInput {
  brandId: string;
  title: string;
  bodyHtml: string;
  method: 'create' | 'optimize';
  pageType?: string;
  sourceUrl?: string;
  promptIds?: string[];
}

/**
 * An agent's draft (spec §5, "Agent: drafts, I review"): written by the
 * agent, so it goes to the Library's In review for a person. Its HTML is
 * checked against the draft allow-list, as a save is; the page type is the
 * one given, or the one the page shows; prompts are kept to the brand's.
 * Null for a brand outside the organization; 'off_domain' for a source_url
 * that isn't on one of the brand's domains.
 */
export async function createContentDraftFor(
  auth: McpAuthContext,
  input: CreateDraftInput,
): Promise<
  | { id: string; status: string; page_type: string | null; editor_path: string }
  | 'off_domain'
  | null
> {
  if (!(await brandAllowed(auth, input.brandId))) return null;
  if (input.sourceUrl && !(await onBrandDomain(input.brandId, input.sourceUrl))) {
    return 'off_domain';
  }
  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('site_type, industry, shopping_mode_enabled')
    .eq('id', input.brandId)
    .single();
  if (brandError) throw new Error(brandError.message);

  const bodyHtml = sanitizeDraftHtml(input.bodyHtml);
  const title = input.title.trim().slice(0, 300);
  const picked = input.pageType && isPageType(input.pageType) ? input.pageType : null;
  const pageType: PageType | null =
    picked ??
    detectPageType(
      { title, html: bodyHtml, url: input.sourceUrl },
      siteTypeOf({
        siteType: brand.site_type,
        industry: brand.industry,
        shoppingModeEnabled: brand.shopping_mode_enabled,
      }),
    );

  let promptIds: string[] = [];
  if (input.promptIds?.length) {
    // Through the prompt's set, not its topic: a prompt may have no topic.
    const { data: prompts, error: promptsError } = await supabaseAdmin
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)')
      .in('id', input.promptIds)
      .eq('prompt_sets.brand_id', input.brandId);
    if (promptsError) throw new Error(promptsError.message);
    promptIds = (prompts ?? []).map((p) => p.id);
  }

  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .insert({
      brand_id: input.brandId,
      author: 'agent',
      created_by: null,
      method: input.method,
      title,
      page_type: pageType,
      page_type_source: picked ? 'user' : 'detected',
      body_html: bodyHtml,
      source_url: input.sourceUrl ?? null,
      prompt_ids: promptIds,
      status: 'in_review',
      // Made by an MCP client (00463, W4-10).
      origin: 'mcp',
    })
    .select('id, status, page_type')
    .single();
  if (error) throw new Error(error.message);
  return { ...data, editor_path: contentEditorPath(data.id) };
}

/**
 * The draft's page in AI answers, AI visits and Google over the period
 * (CE-016, 00209), as the Live page tab reads it: the address it was
 * published at, else the page it optimizes. 'no_page' for a draft that
 * isn't of a live page yet; null outside the organization.
 */
export async function getContentImpactFor(
  auth: McpAuthContext,
  draftId: string,
  days: number,
): Promise<Record<string, unknown> | 'no_page' | null> {
  const draft = await draftFor(auth, draftId);
  if (!draft) return null;
  const page = draft.published_url ?? draft.source_url;
  if (!page) return 'no_page';
  if (!(IMPACT_PERIODS as readonly number[]).includes(days))
    throw new Error('days must be 7, 30, 90 or 365');
  const { data, error } = await supabaseAdmin.rpc('content_page_impact', {
    p_brand_id: draft.brand_id,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? {};
}

/**
 * The brand's data the draft draws on over 30 days (CE-008, 00211), with the
 * person's choices: a source left out (included false) or added by hand.
 */
export async function getContentSourcesFor(
  auth: McpAuthContext,
  draftId: string,
): Promise<{ sources: unknown; choices: unknown[] } | null> {
  const draft = await draftFor(auth, draftId);
  if (!draft) return null;
  const [sources, choices] = await Promise.all([
    supabaseAdmin.rpc('content_draft_sources', { p_draft_id: draft.id, p_days: SOURCES_DAYS }),
    supabaseAdmin
      .from('content_draft_sources')
      .select('kind, ref, included, added')
      .eq('draft_id', draft.id),
  ]);
  if (sources.error) throw new Error(sources.error.message);
  if (choices.error) throw new Error(choices.error.message);
  return { sources: sources.data, choices: choices.data ?? [] };
}

export type AddSourceInput =
  { kind: 'prompt'; promptId: string } | { kind: 'cited_page' | 'gsc_query'; ref: string };

/**
 * Adds a source, as the Sources tab's Add does: a prompt of the brand's
 * joins the draft's prompts; a page address or a Search Console query is
 * kept as added. 'not_found' for a prompt outside the brand; null for a draft
 * outside the organization.
 */
export async function addContentSourceFor(
  auth: McpAuthContext,
  draftId: string,
  source: AddSourceInput,
): Promise<{ added: true } | 'not_found' | null> {
  const draft = await draftFor(auth, draftId);
  if (!draft) return null;
  if (source.kind === 'prompt') {
    const { data: prompt, error } = await supabaseAdmin
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)')
      .eq('id', source.promptId)
      .eq('prompt_sets.brand_id', draft.brand_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prompt) return 'not_found';
    const promptIds = [...new Set([...(draft.prompt_ids ?? []), prompt.id])].slice(0, 500);
    const { error: updateError } = await supabaseAdmin
      .from('content_drafts')
      .update({ prompt_ids: promptIds })
      .eq('id', draft.id);
    if (updateError) throw new Error(updateError.message);
    return { added: true };
  }
  const ref = source.kind === 'gsc_query' ? source.ref.trim().toLowerCase() : source.ref.trim();
  const { error } = await supabaseAdmin
    .from('content_draft_sources')
    .upsert(
      { draft_id: draft.id, kind: source.kind, ref, included: true, added: true },
      { onConflict: 'draft_id,kind,ref' },
    );
  if (error) throw new Error(error.message);
  return { added: true };
}

/**
 * An agent's suggestions, left for a person to review in the page as one new
 * batch (CE-018, 00217), linked to the draft's Action Center action. Passages
 * are numbered as get_content_draft lists them; what the editor can't apply
 * is dropped with the reason. Null outside the organization; 'published' for
 * a draft that is live already; 'open_suggestions' while a person still has
 * the latest batch's suggestions to decide; 'writing' while Start or a
 * rewrite holds it (its answer, already charged, would be dropped over this
 * batch).
 */
export async function suggestContentChangesFor(
  auth: McpAuthContext,
  draftId: string,
  suggestions: AgentSuggestionInput[],
): Promise<
  | { kept: number; batch_id: string | null; dropped: { index: number; reason: DroppedReason }[] }
  | 'published'
  | 'open_suggestions'
  | 'writing'
  | null
> {
  const draft = await draftFor(auth, draftId);
  if (!draft) return null;
  if (draft.status === 'published') return 'published';
  if ((await openSuggestionsOf(draft.id)).length) return 'open_suggestions';
  if (agentStateOf(draft.agent_state, draft.agent_state_at) === 'writing') return 'writing';
  const passages = draftPassages(draft.body_html);
  // The targets only when a suggestion links: the sources read is the heavy one.
  const linking = suggestions.some((s) => /<a\b/i.test(s.after));
  const [locked, targets] = await Promise.all([
    lockedKeys(
      draft,
      passages.map((p) => p.text),
    ),
    linking ? linkTargetsOf(draft) : null,
  ]);
  const { kept, dropped } = keepAgentSuggestions(
    suggestions,
    passages,
    locked,
    targets ? linkAllowList(targets) : null,
  );
  if (!kept.length) return { kept: 0, batch_id: null, dropped };

  const batchId = crypto.randomUUID();
  const { error } = await supabaseAdmin.from('content_draft_suggestions').insert(
    kept.map((row, position) => ({
      ...row,
      draft_id: draft.id,
      batch_id: batchId,
      action_id: draft.action_id,
      position,
    })),
  );
  if (error) throw new Error(error.message);
  return { kept: kept.length, batch_id: batchId, dropped };
}

/**
 * Ready (spec §6): a draft is ready to publish, and History keeps it as a
 * version; a draft linked to an action completes its task there, as Mark
 * ready does (CE-022). An agent's draft in review waits for a person to mark
 * it ready in the editor ('in_review'): the key that wrote it can't approve
 * it. A draft already ready or published keeps its status. Null outside the
 * organization.
 */
export async function setContentDraftReadyFor(
  auth: McpAuthContext,
  draftId: string,
): Promise<{ status: string; action_tasks_done: number } | 'in_review' | null> {
  const draft = await draftFor(auth, draftId);
  if (!draft) return null;
  if (draft.status === 'in_review') return 'in_review';
  if (draft.status !== 'draft') return { status: draft.status, action_tasks_done: 0 };
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .update({ status: 'ready' })
    .eq('id', draft.id)
    .eq('status', 'draft')
    .select('status')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    const { error: versionError } = await supabaseAdmin.rpc('content_draft_snapshot', {
      p_draft_id: draft.id,
      p_origin: 'ready',
    });
    if (versionError) console.error('Failed to keep the ready version:', versionError.message);
  }
  let done = 0;
  if (data && draft.action_id) {
    // The draft is ready either way; a task left open can be ticked in the drawer.
    try {
      done = await completeDraftTasks(
        supabaseAdmin,
        {
          id: draft.id,
          brandId: draft.brand_id,
          actionId: draft.action_id,
          method: draft.method === 'create' ? 'create' : 'optimize',
        },
        // The API key's user, as update_task_status records it.
        auth.userId,
      );
    } catch (err) {
      console.error("Failed to complete the action's task:", err);
    }
  }
  return { status: data?.status ?? draft.status, action_tasks_done: done };
}
