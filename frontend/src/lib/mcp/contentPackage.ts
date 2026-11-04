import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { mayUseBrand } from '@/lib/mcp/data';
import { readContentAuthors } from '@/lib/content/authorsRead';
import { bulkCmsItems, cmsSource, type BulkProblem } from '@/lib/content/cmsSend';
import { missingSchemaLeftOut } from '@/lib/content/drafts';
import { withContentDom } from '@/lib/content/serverDom';
import { qualityPhase } from '@/lib/content/quality';
import { fragment } from '@/lib/content/readyToPublish';
import { draftLanguage } from '@/lib/content/rules';

/**
 * A draft as a page ready for a CMS, for the MCP tool
 * get_content_draft_package (MCP plan B5): what the Content Library's Send to
 * CMS sends (bulkCmsItems), so the user's own AI tool can put it on their CMS
 * with its own connector. GetCito's MCP never sends it.
 *
 * The editor's helpers read HTML with a DOM, which the server has none of:
 * jsdom's window is given to them (withContentDom, made on the first call
 * and kept), imported here alone, so no other tool waits for it and the
 * browser's bundle never carries it. The MCP server imports this module on
 * the tool's first call too.
 */

/** The page as the CMS takes it. */
export interface McpCmsPackage {
  draft_id: string;
  title: string;
  /** The page's address part, as the draft kept it from its last send, else its title's. */
  slug: string;
  meta_title: string;
  meta_description: string;
  /**
   * The page's HTML ready to paste, as the editor's Copy HTML gives it: HTML
   * blocks are passed as written (their scripts, iframes and links too), as
   * Copy HTML and Send to CMS pass them; no placeholders left, with the
   * brand's byline line when it puts one in the content, and without its H1,
   * which the CMS's title field carries.
   */
  html: string;
  /** The JSON-LD blocks the HTML carries, parsed, for a CMS that takes them apart. */
  json_ld: unknown[];
  /** The author's name for the CMS's author field; null to keep the CMS's own. */
  author: string | null;
  /** The qualified reviewer's name and credential, separate from the author. */
  reviewer: string | null;
  featured_image: { src: string; alt: string } | null;
  /** The live page it optimizes; null for a new page. */
  source_url: string | null;
}

export type McpPackageError = {
  error: 'not_found' | 'not_ready';
  problem?: BulkProblem;
  message: string;
};

/** What a page that can't go yet needs, as the Library's Send says it. */
const PROBLEMS: Record<BulkProblem, string> = {
  noTitle: 'The page has no title.',
  longTitle: 'The title is longer than 300 characters.',
  empty: 'The page has nothing under its H1 to publish.',
  tooLong: 'The page is longer than a million characters.',
  placeholders:
    'The page still has [placeholders] to fill: fill them in the editor (or with suggest_content_changes) first.',
  slug: "The slug the draft kept isn't one a CMS takes: letters, digits, '-', '_' and single dots, up to 200.",
  metaTitle: 'The meta title the draft kept is longer than 300 characters.',
  metaDescription: 'The meta description the draft kept is longer than 500 characters.',
};

/** The JSON-LD blocks of a page's HTML, each parsed; one that doesn't parse is left out. */
function jsonLdOf(html: string): unknown[] {
  return Array.from(fragment(html).querySelectorAll('script[type="application/ld+json"]')).flatMap(
    (script) => {
      try {
        return [JSON.parse(script.textContent ?? '')];
      } catch {
        return [];
      }
    },
  );
}

/**
 * The draft as Send to CMS would send it unchanged; why it can't go yet when
 * it can't (fill it in the editor). Not found for a draft outside the key's
 * organization, or archived.
 */
export async function getContentDraftPackageFor(
  auth: McpAuthContext,
  draftId: string,
): Promise<McpCmsPackage | McpPackageError> {
  const notFound: McpPackageError = { error: 'not_found', message: 'Draft not found' };
  if (!auth.organizationId) return notFound;
  const columns =
    'id, brand_id, title, body_html, source_url, author_id, reviewer_id, author_real_at, rules, page_type, method, slug, meta_title, meta_description, archived_at, brands!inner(organization_id, name, language)' as const;
  const read = await supabaseAdmin
    .from('content_drafts')
    .select(`${columns}, schema_left_out` as const)
    .eq('id', draftId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  // The web ahead of 00448: the draft without it, as not left out.
  const { data: draft, error } = missingSchemaLeftOut(read.error)
    ? await supabaseAdmin
        .from('content_drafts')
        .select(columns)
        .eq('id', draftId)
        .eq('brands.organization_id', auth.organizationId)
        .maybeSingle()
    : read;
  if (error) throw new Error(error.message);
  if (!draft || draft.archived_at || !(await mayUseBrand(auth, draft.brand_id))) return notFound;
  const brand = (Array.isArray(draft.brands) ? draft.brands[0] : draft.brands) as {
    name: string;
    language: string | null;
  };

  // As the Library reads them: the authors once Quality is live (its phase 1).
  const [authors] = await Promise.all([
    qualityPhase() >= 1
      ? readContentAuthors(supabaseAdmin, auth.organizationId, {
          // Who reads them: cmsSource doesn't use it, so the key's role isn't looked up.
          me: { id: auth.userId, role: 'analyst' },
        })
      : Promise.resolve(null),
    withContentDom(),
  ]);
  const name = authors?.brands.find((b) => b.id === draft.brand_id)?.name ?? brand.name;
  const source = cmsSource({
    page: {
      id: draft.id,
      title: draft.title,
      bodyHtml: draft.body_html,
      sourceUrl: draft.source_url,
      authorId: draft.author_id,
      reviewerId: draft.reviewer_id,
      authorConfirmed: draft.author_real_at !== null,
      language: draftLanguage(draft.rules),
      pageType: draft.page_type,
      isNew: draft.method === 'create',
      schemaLeftOut: 'schema_left_out' in draft && draft.schema_left_out === true,
    },
    authors,
    brandId: draft.brand_id,
    brandName: name,
    brandLanguage: brand.language,
  });
  const kept = {
    slug: draft.slug ?? undefined,
    metaTitle: draft.meta_title ?? undefined,
    metaDescription: draft.meta_description ?? undefined,
  };
  const [item] = bulkCmsItems([source], new Map([[draft.id, kept]]));
  if (!item.page) {
    const problem = item.problem ?? 'empty';
    return { error: 'not_ready', problem, message: PROBLEMS[problem] };
  }
  const page = item.page;
  return {
    draft_id: draft.id,
    title: page.title,
    slug: page.slug,
    meta_title: page.metaTitle,
    meta_description: page.metaDescription,
    html: page.html,
    json_ld: jsonLdOf(page.html),
    author: page.author,
    reviewer: page.reviewer,
    featured_image: page.featuredImage,
    source_url: draft.source_url,
  };
}
