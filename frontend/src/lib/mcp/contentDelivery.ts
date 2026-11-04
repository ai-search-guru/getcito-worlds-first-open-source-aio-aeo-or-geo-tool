import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { API_BASE_URL } from '@/config/api';
import { lastSend } from '@/lib/content/cmsStatus';
import { draftShopping } from '@/lib/content/shoppingCheck';
import { shoppingPathSchema } from '@/lib/content/shoppingPath';
import { assertSubscriptionActive } from './subscriptionGate';

/**
 * Where a draft went and whether its shopping links still sell, for the MCP's
 * draft tools (B5), as the Content Library shows them: its last Send to CMS
 * (00262, 00284) and its shopping path's check after each catalog sync
 * (00351, 00352). GetCito's MCP never sends a page itself: the user's AI
 * tool does, with its own CMS connector, and marks it published here.
 */

/** A draft's last Send to CMS. */
export interface McpLastSend {
  /** queued, sent, failed (a send left queued reads as failed: interrupted) or published. */
  status: string;
  /** webhook, webflow, wordpress, framer or wix: the brand's webhook, Webflow collection, WordPress site, Framer collection or Wix site's Blog. */
  target: string;
  /** When it was published, sent or queued. */
  at: string;
  /** What the webhook answered, when it did. */
  http_status: number | null;
  error: string | null;
  /** Where the CMS says it went live. */
  published_url: string | null;
}

/** Whether a draft's shopping links still sell, as the Library's Shopping path column reads it. */
export type McpShoppingLinks =
  /** No shopping path: not a shop's page, or not one of the types that take one. */
  | { state: 'none' }
  /** A path, not checked since it was built. */
  | { state: 'unchecked' }
  | {
      /** attention: it links products that no longer sell. */
      state: 'ok' | 'attention';
      /** Read from the live page, or the draft when it isn't live. */
      read_from: 'page' | 'draft';
      checked_at: string;
      categories: number;
      categories_linked: number;
      products: number;
      products_linked: number;
      /** The linked products that no longer sell: sold out, refused by Merchant Center, or gone. */
      bad: { id: string; title: string; state: string }[];
    };

/** The columns a draft read adds for mcpShoppingLinks, as the Library's read embeds them. */
export const SHOPPING_COLUMNS =
  'shopping_built:shopping_path->>builtAt, content_shopping_checks(read_from, checked_at, categories, categories_linked, products, products_linked, bad)';

export function mcpShoppingLinks(builtAt: string | null, check: unknown): McpShoppingLinks {
  const read = draftShopping(builtAt, check);
  if (read.state === 'none' || read.state === 'unchecked') return read;
  return {
    state: read.state,
    read_from: read.readFrom,
    checked_at: read.checkedAt,
    categories: read.categories,
    categories_linked: read.categoriesLinked,
    products: read.products,
    products_linked: read.productsLinked,
    bad: read.bad,
  };
}

/** Ids a read takes: content_draft_last_deliveries (00262) reads up to 500. */
const IDS_PER_READ = 500;

/** Each draft's last send, by draft id; a draft never sent has none. */
export async function lastSendsOf(draftIds: string[]): Promise<Map<string, McpLastSend>> {
  const chunks: string[][] = [];
  for (let i = 0; i < draftIds.length; i += IDS_PER_READ) {
    chunks.push(draftIds.slice(i, i + IDS_PER_READ));
  }
  const reads = await Promise.all(
    chunks.map((ids) => supabaseAdmin.rpc('content_draft_last_deliveries', { p_draft_ids: ids })),
  );
  const sends = new Map<string, McpLastSend>();
  for (const { data, error } of reads) {
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.draft_id) continue;
      const send = lastSend(row);
      sends.set(row.draft_id, {
        status: send.status,
        target: send.target,
        at: send.at,
        http_status: row.http_status,
        error: send.error,
        published_url: row.published_url,
      });
    }
  }
  return sends;
}

/** A draft's shopping path, as its Brief tab shows it: what the page should link. */
export interface McpShoppingPath {
  built_at: string;
  page_type: string | null;
  /** The category pages it should link. */
  categories: { name: string; url: string | null }[];
  /** The catalog products it should link, the best first. */
  products: {
    id: string;
    title: string;
    url: string | null;
    price: number | null;
    sale_price: number | null;
    currency: string | null;
    availability: string;
  }[];
  /** Products the path left out, and why (sold_out, refused, no_link, gone…). */
  left_out: { id: string; title: string | null; reason: string }[];
}

/** The stored shopping path in the MCP's shape; null for none, or one that can't be read. */
export function mcpShoppingPath(stored: unknown): McpShoppingPath | null {
  const parsed = shoppingPathSchema.safeParse(stored);
  if (!parsed.success) return null;
  const path = parsed.data;
  return {
    built_at: path.builtAt,
    page_type: path.pageType,
    categories: path.categories.map((c) => ({ name: c.name, url: c.url })),
    products: path.products.map((p) => ({
      id: p.id,
      title: p.title,
      url: p.url,
      price: p.price,
      sale_price: p.salePrice,
      currency: p.currency,
      availability: p.availability,
    })),
    left_out: path.leftOut.map((p) => ({ id: p.id, title: p.title, reason: p.reason })),
  };
}

/** Where a page was marked live, as the editor's Mark published answers. */
export interface McpPublished {
  published_url: string;
  published_at: string;
  /** The linked action's Publish task done: every page it names is live. */
  task_completed: boolean;
  /** Off the brand's domains the address is kept, but the Live page tab can't measure it. */
  on_brand_domain: boolean;
}

export type McpPublishError = { error: 'invalid_url' | 'not_found'; message: string };

/**
 * A page marked Published at the address it went live at, as the editor's
 * Mark published does (CE-013), for a page the user's own AI tool put on a
 * CMS: GetCito then measures that address (the Live page tab, its
 * citations and AI visits) and a linked action's Publish task completes
 * once all its pages are live. The API's publishDraft runs it for the key's
 * user through the CRON_SECRET internal endpoint; the draft must be the
 * key's organization's. Never on a demo brand (00380): the tool and its REST
 * mirror refuse it (lib/mcp/demoGate.ts), and so does the endpoint.
 */
export async function markContentDraftPublishedFor(
  auth: McpAuthContext,
  draftId: string,
  url: string,
): Promise<McpPublished | McpPublishError> {
  const notFound: McpPublishError = { error: 'not_found', message: 'Draft not found' };
  if (!auth.organizationId) return notFound;
  // Nothing marked for a read-only workspace, whoever asks: the API's
  // internal endpoint is outside its own read-only check.
  await assertSubscriptionActive(auth.organizationId);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error('CRON_SECRET must be configured for MCP publishing');

  const res = await fetch(
    `${API_BASE_URL}/api/internal/content-drafts/${encodeURIComponent(draftId)}/publish`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, userId: auth.userId, orgId: auth.organizationId }),
    },
  );
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (body?.code === 'invalid_url') {
      return {
        error: 'invalid_url',
        message: 'Give the http(s) address the page is live at, with no sign-in details.',
      };
    }
    if (res.status === 404) return notFound;
    throw new Error(
      (body?.message as string | undefined) ?? `Internal publish endpoint returned ${res.status}`,
    );
  }
  return {
    published_url: String(body?.publishedUrl ?? url),
    published_at: String(body?.publishedAt ?? new Date().toISOString()),
    task_completed: body?.taskCompleted === true,
    on_brand_domain: body?.onBrandDomain !== false,
  };
}
