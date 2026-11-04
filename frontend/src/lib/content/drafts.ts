/**
 * Content drafts (Content Editor, CE-002): the pages a person or the Content
 * Agent writes or changes in GetCito, as the Library lists them. One row per
 * content_drafts row (migration 00204).
 */

import type { SiteType } from './pageTypes';
import type { DraftRules } from '@/lib/content/rules';
import type { DraftShopping } from '@/lib/content/shoppingCheck';

/** Draft → In review (an agent's draft waiting for a person) → Ready → Published. */
export const DRAFT_STATUSES = ['draft', 'in_review', 'ready', 'published'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** A new page, or an existing one improved. */
export type DraftMethod = 'create' | 'optimize';

/**
 * Where the Content Agent is on a draft Start gave it (CE-015,
 * content_drafts.agent_state, 00219): writing it, or couldn't finish.
 */
export type AgentState = 'writing' | 'failed' | null;

/**
 * Which run holds the draft, or last held it (content_drafts.agent_run,
 * 00247): Start with Agent, or Rewrite the page to these rules.
 */
export type AgentRun = 'write' | 'rewrite' | null;

/** A stored run, or null for anything else. */
export function agentRunOf(value: string | null | undefined): AgentRun {
  return value === 'write' || value === 'rewrite' ? value : null;
}

/** A 'writing' this old was left by a server that stopped (contentWriter.js). */
export const WRITING_STALE_MS = 10 * 60_000;

/** How often the Library and the editor look again while the agent writes. */
export const AGENT_POLL_MS = 5_000;

/** The agent's state as the app shows it: a 'writing' gone stale reads as failed. */
export function agentStateOf(
  state: string | null,
  at: string | null,
  now: number = Date.now(),
): AgentState {
  if (state === 'failed') return 'failed';
  if (state !== 'writing') return null;
  return at && now - new Date(at).getTime() < WRITING_STALE_MS ? 'writing' : 'failed';
}

/**
 * The page types a draft can be, across brand types (B2B, e-commerce, B2C,
 * mobile app; SITE_PAGE_TYPES says which). Stored as these keys (content_drafts.page_type);
 * named in en.json under contentEditor.pageTypes.
 */
export const PAGE_TYPES = [
  'feature_page',
  'solution_page',
  'comparison',
  'integration',
  'pricing',
  'guide',
  'blog_post',
  'docs_faq',
  'product_page',
  'category_page',
  'buying_guide',
  'best_of',
  'policy',
  'destination_page',
  'itinerary',
  'help_faq',
  // The formats www.getcito.com offers (content intelligence page).
  'definition',
  'alternatives',
  'collection_page',
  'sizing_guide',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export function isPageType(value: string | null): value is PageType {
  return value !== null && (PAGE_TYPES as readonly string[]).includes(value);
}

/** The Library (CE-001 route). */
export const CONTENT_LIBRARY_PATH = '/dashboard/content/library';

/** The Library with New content open: a new page's start. */
export const CONTENT_NEW_PATH = `${CONTENT_LIBRARY_PATH}?new=1`;

/** Content › Editor: the draft last opened here, else a new page's start. */
export const CONTENT_EDITOR_PATH = '/dashboard/content/editor';

/** Where a draft opens: the editor (CE-004). */
export function contentEditorPath(draftId: string) {
  return `${CONTENT_EDITOR_PATH}/${draftId}`;
}

/**
 * The Library's tabs: everything, one per status, then the archived drafts
 * (00233), which leave every other tab and keep their status for Restore.
 */
export const LIBRARY_TABS = ['all', ...DRAFT_STATUSES, 'archived'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

/**
 * Drafts' pages read per Export call: each comes back with its whole page
 * (about 30 KB on average, up to 500 KB), so a list is read in calls of this
 * many rather than in one response.
 */
export const DRAFT_PAGES_PER_CALL = 50;

export interface DraftAuthor {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  email?: string | null;
}

export interface ContentDraftListItem {
  id: string;
  title: string;
  pageType: string | null;
  method: DraftMethod;
  status: DraftStatus;
  /** A person or the Content Agent. */
  author: 'user' | 'agent';
  /** The person who started it: null for an agent's draft, or a member since removed. */
  createdBy: DraftAuthor | null;
  /** Whether the signed-in member started it ("You"). */
  isMine: boolean;
  /** Where the Content Agent is on it (CE-015). */
  agentState: AgentState;
  createdAt: string;
  updatedAt: string;
  /** When an admin or manager archived it (00233); null when it isn't archived. */
  archivedAt: string | null;
  /** Its shopping path's links as the last catalog sync left them (00352); none when absent. */
  shopping?: DraftShopping;
  /** Where it was made (00463, W4-10): the Library's Made in. */
  origin: DraftOrigin;
  /** The chat it was made in, when the member may open it; null otherwise. */
  conversation: DraftConversation | null;
}

/**
 * Where a draft was made (00463, W4-10): the Content Editor, Chat's
 * create_draft, an Action Center task, an agent's run or an MCP client.
 * Set once, when it is made.
 */
export const DRAFT_ORIGINS = ['editor', 'chat', 'action_center', 'agent', 'mcp'] as const;
export type DraftOrigin = (typeof DRAFT_ORIGINS)[number];

/** The chat a draft was made in, as its title reads. */
export interface DraftConversation {
  id: string;
  title: string;
}

/**
 * The embed that reads a draft's chat (00463's conversation_id), named by
 * its foreign key: through the member's session, another's chat reads as none.
 */
export const DRAFT_CHAT =
  'conversation:chat_conversations!content_drafts_conversation_id_fkey(id, title)';

/** A row's origin: one of DRAFT_ORIGINS, else the editor's (the column's default). */
export const draftOriginOf = (value: unknown): DraftOrigin =>
  (DRAFT_ORIGINS as readonly unknown[]).includes(value) ? (value as DraftOrigin) : 'editor';

/**
 * The chat an embed of chat_conversations (00463's conversation_id) gives,
 * or null: none, or one the member's session can't read (another's chat).
 */
export function draftConversationOf(row: unknown): DraftConversation | null {
  const chat = (Array.isArray(row) ? row[0] : row) as { id?: unknown; title?: unknown } | null;
  if (!chat || typeof chat.id !== 'string') return null;
  return { id: chat.id, title: typeof chat.title === 'string' && chat.title ? chat.title : '' };
}

/**
 * Where a draft's page type comes from (CE-023): detected from the page, and
 * kept in step with it as it changes, until a person picks one.
 */
export type PageTypeSource = 'detected' | 'user';

/** A draft as the editor opens it. */
export interface ContentDraft {
  id: string;
  brandId: string;
  title: string;
  pageType: string | null;
  pageTypeSource: PageTypeSource;
  /** The brand's site type, which sets the page types on offer. */
  siteType: SiteType;
  /** The existing page an optimize draft is for, when Start picked one. */
  sourceUrl: string | null;
  /**
   * Where the page is live (CE-013): given when it was marked published, or
   * by its CMS (00262). The Live page tab measures it, else sourceUrl.
   */
  publishedUrl: string | null;
  method: DraftMethod;
  status: DraftStatus;
  bodyHtml: string;
  author: 'user' | 'agent';
  /**
   * The person the page is by (CE-038, content_authors): page metadata the
   * editor shows outside the page and the CMS author field gets. Null is the
   * organization byline ("{Brand} Team").
   */
  authorId: string | null;
  /**
   * The qualified person who reviewed a page that advises on health,
   * finance or law (Quality CE-049, 00273): page metadata, from Authors.
   */
  reviewerId: string | null;
  /** What the person changed on the page's rules for this draft (CE-009). */
  rules: DraftRules;
  /** Weak or competitors' sources the person kept (Quality CE-046, 00263): they don't lower Trust. */
  keptSources: string[];
  /**
   * With no author picked, what a member confirmed of the author the site
   * names (00271): a real person, and their profile with a bio and links.
   */
  authorConfirmed: { real: boolean; profile: boolean };
  /** The Action Center action the draft is the work of (CE-022), shown as "from Action AC-214". */
  action: { id: string; number: number } | null;
  /** The chat it was made in (W4-10), shown as "From chat: {title}"; null for none or another's. */
  conversation: DraftConversation | null;
  /** Where the Content Agent is on it (CE-015): the editor waits while it writes. */
  agentState: AgentState;
  /** When the agent's state last changed: while it writes, when it started. */
  agentSince: string | null;
  /** Which run that is, for every device: a failed rewrite is tried again as one. */
  agentRun: AgentRun;
  updatedAt: string;
  /** When an admin or manager archived it (00233): Content › Editor doesn't go back to it. */
  archivedAt: string | null;
  /**
   * Quality's automatic hand-off (CE-051, 00275): the brand handed off its
   * new and optimized pages when the draft was made. Its run is once a draft.
   */
  qualityHandoff: boolean;
  /**
   * The person left out the Article schema GetCito adds to the page it
   * sends and exports (00448): their CMS writes its own.
   */
  schemaLeftOut: boolean;
}

/**
 * A database without 00448 has no content_drafts.schema_left_out (42703 on
 * a read, PGRST204 on a write): the web deployed ahead of its migration.
 * Drafts are read without it, as not left out, and the choice isn't saved.
 */
export function missingSchemaLeftOut(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    (error?.code === '42703' || error?.code === 'PGRST204') &&
    (error.message ?? '').includes('schema_left_out')
  );
}

/**
 * What New content starts a page from (CE-003): an opportunity, a tracked
 * prompt or a topic for a new page, or content to optimize.
 */
export type DraftSource =
  { kind: 'opportunity' | 'prompt' | 'topic'; id: string } | { kind: 'content' };

/** A draft as Start opens it (CE-015). */
export interface DraftStart {
  method: DraftMethod;
  title: string;
  pageType: PageType;
  /** The person picked the type; otherwise it was Start's guess, and follows the page. */
  typePicked?: boolean;
  source: DraftSource;
  /** The content to optimize, as HTML. */
  bodyHtml?: string;
  /** The existing page to optimize instead of writing a new one (overlap check). */
  sourceUrl?: string;
  /** Where it is made (00463): the editor's unless said; a member's own write is editor or chat. */
  origin?: DraftOrigin;
  /** The chat it is made in (Chat's create_draft). */
  conversationId?: string | null;
}

/** A page of the brand's brought in by its URL (CE-003): main content, title and schema. */
export interface ImportedPage {
  /** The address after redirects. */
  url: string;
  title: string;
  html: string;
}

/** Why a page couldn't be brought in, as the API names it ('failed' for anything else). */
export const PAGE_IMPORT_ERRORS = [
  'off_site',
  'invalid_url',
  'blocked',
  'not_html',
  'http_error',
  'too_large',
  'timeout',
  'unreachable',
  'too_many_redirects',
  'failed',
] as const;
export type PageImportError = (typeof PAGE_IMPORT_ERRORS)[number];

/** One of the brand's pages AI already cites for a new page's prompts (CE-015). */
export interface OverlapPage {
  url: string;
  title: string | null;
  promptsInCommon: number;
  citations: number;
  /** Average Google position over the last 28 days; null without Search Console data. */
  gscPosition: number | null;
}

/** Start's overlap check: the prompts a new page would answer, and the pages that answer them. */
export interface ContentOverlap {
  totalPrompts: number;
  pages: OverlapPage[];
}

/** What New content offers to start a page from. */
export interface DraftStartOptions {
  /**
   * pageTitle: the page title its brief suggests, once one is generated;
   * the opportunity's own title says what to do, not what to call the page.
   * assetType: its primary asset's type as stored (lib/content/assetTypes.ts).
   */
  opportunities: {
    id: string;
    title: string;
    decision: string | null;
    pageTitle: string | null;
    assetType: string | null;
  }[];
  /**
   * seen: the brand was named in or cited for it lately, so it needs no new
   * page (New content leaves it out; Add source keeps it). Not seen first.
   */
  prompts: { id: string; text: string; seen: boolean }[];
  /** How many active prompts are seen, past the listed ones too. */
  promptsSeen: number;
  topics: { id: string; name: string; promptCount: number }[];
}

/** The Library's Created filter (CE-002): any time, or the last 7, 30 or 90 days. */
export const CREATED_RANGES = ['all', '7d', '30d', '90d'] as const;
export type CreatedRange = (typeof CREATED_RANGES)[number];

/** The drafts created in the range, counted back from `now`. */
export function draftsCreatedIn(
  drafts: ContentDraftListItem[],
  range: CreatedRange,
  now: number = Date.now(),
): ContentDraftListItem[] {
  if (range === 'all') return drafts;
  const since = now - Number.parseInt(range, 10) * 86_400_000;
  return drafts.filter((d) => new Date(d.createdAt).getTime() >= since);
}

/** The Library's Made in filter (W4-10): any, or one place a draft was made. */
export const MADE_IN_FILTERS = ['all', ...DRAFT_ORIGINS] as const;
export type MadeInFilter = (typeof MADE_IN_FILTERS)[number];

/** The drafts made where the filter says. */
export function draftsMadeIn(
  drafts: ContentDraftListItem[],
  filter: MadeInFilter,
): ContentDraftListItem[] {
  return filter === 'all' ? drafts : drafts.filter((d) => d.origin === filter);
}

/**
 * The Library's Last send filter (#1331): any, never sent, or how the last
 * send to the CMS stands, as the row's mark shows it.
 */
export const SEND_FILTERS = ['all', 'never', 'queued', 'sent', 'failed', 'published'] as const;
export type SendFilter = (typeof SEND_FILTERS)[number];

/**
 * The drafts whose last send is as picked, read from each draft's last send
 * (readCmsStatuses: one left queued past its half hour reads as failed). A
 * page taken down (AUTONOMOUS-GO-LIVE PR 10) is a draft in its CMS again: Sent.
 */
export function draftsLastSent(
  drafts: ContentDraftListItem[],
  sends: ReadonlyMap<string, { status: string }>,
  filter: SendFilter,
): ContentDraftListItem[] {
  if (filter === 'all') return drafts;
  if (filter === 'never') return drafts.filter((d) => !sends.has(d.id));
  return drafts.filter((d) => {
    const status = sends.get(d.id)?.status;
    return status === filter || (filter === 'sent' && status === 'taken_down');
  });
}

export function draftsInTab(drafts: ContentDraftListItem[], tab: LibraryTab) {
  if (tab === 'archived') return drafts.filter((d) => d.archivedAt !== null);
  const live = drafts.filter((d) => d.archivedAt === null);
  return tab === 'all' ? live : live.filter((d) => d.status === tab);
}

export function libraryTabCounts(drafts: ContentDraftListItem[]): Record<LibraryTab, number> {
  const counts = Object.fromEntries(LIBRARY_TABS.map((tab) => [tab, 0])) as Record<
    LibraryTab,
    number
  >;
  for (const d of drafts) {
    if (d.archivedAt !== null) {
      counts.archived += 1;
    } else {
      counts.all += 1;
      counts[d.status] += 1;
    }
  }
  return counts;
}
