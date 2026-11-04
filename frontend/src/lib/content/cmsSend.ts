import type { DraftPage } from '@/lib/actions/contentDrafts';
import type { AuthorsRead, ContentAuthor } from '@/lib/content/authors';
import { publishableHtml } from '@/lib/content/cleanHtml';
import {
  articleSchemaInput,
  schemaAuthor,
  withArticleSchema,
  type AddedArticleSchema,
} from '@/lib/content/pageSchema';
import { qualityPhase } from '@/lib/content/quality';
import {
  bylineText,
  exportPlaceholders,
  fragment,
  pageFields,
  teamName,
  titlePlaceholders,
  withByline,
  withoutDangling,
  withoutLeadingH1,
  withReviewerJsonLd,
  type PageFields,
} from '@/lib/content/readyToPublish';

/**
 * Send to CMS (#1331): a Content Editor page as the server takes it
 * (POST /api/content-drafts/send) and sends to the brand's webhook. The HTML
 * is the page ready to paste (CE-057: publishableHtml, placeholders filled),
 * with the brand's byline line and without its H1, which the CMS's own title
 * field carries, and an article's Article schema with its author unless the
 * person left it out (00448); slug and meta are filled from the page and what
 * the person changed wins.
 */

export interface CmsPage {
  draftId: string;
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  html: string;
  author: string | null;
  reviewer: string | null;
  featuredImage: { src: string; alt: string } | null;
}

/** The fields a send fills in, editable in the Send dialog and kept on the draft. */
export interface CmsFields {
  slug: string;
  metaTitle: string;
  metaDescription: string;
}

/** As the server's: letters, digits, '-', '_' and single dots. */
const SLUG_PATTERN = /^(?!.*\.\.)[\p{L}\p{N}._-]+$/u;
export const META_TITLE_MAX = 300;
export const META_DESCRIPTION_MAX = 500;
// The server's other limits, which the page itself fills.
const TITLE_MAX = 300;
const HTML_MAX = 1_000_000;
const AUTHOR_MAX = 200;
const ALT_MAX = 500;
const IMAGE_SRC_MAX = 2048;

/** A meta title from the page stops about here, at a word, as search results cut it (#1331). */
const META_TITLE_PREFILL = 60;

/**
 * Text up to `max` characters, cut at the last space that fits (any space,
 * a no-break one too), or at `max` with none past half, never inside a
 * character (an emoji); without the punctuation a cut leaves at its end.
 */
function upToWord(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let space = -1;
  for (let i = max; i >= 0; i--) {
    if (/\s/u.test(chars[i])) {
      space = i;
      break;
    }
  }
  const cut = chars.slice(0, space > max / 2 ? space : max).join('');
  return cut.replace(/[\s,:;|–—-]+$/u, '');
}

/**
 * A meta title from the page's title: whole when it fits; else its first
 * part, when the title has parts ("Pour-over at home: a guide") and that
 * one says enough; else cut at a word near 60 characters, never on a word
 * that leads into what was cut ("…Unified Tracking Across").
 */
export function metaTitleOf(title: string): string {
  if (Array.from(title).length <= META_TITLE_PREFILL) return title;
  const [first] = title.split(/\s*[:|–—]\s+|\s+-\s+/u);
  const firstLength = Array.from(first.trim()).length;
  if (firstLength >= META_TITLE_PREFILL / 2 && firstLength <= META_TITLE_PREFILL) {
    return first.trim();
  }
  const cut = upToWord(title, META_TITLE_PREFILL);
  return withoutDangling(cut.split(/\s+/u))
    .join(' ')
    .replace(/[\s,:;|–—-]+$/u, '');
}

/**
 * What a send starts with: what the draft keeps, else what the page gives,
 * its meta title cut near 60 characters (metaTitleOf).
 */
export function cmsFields(fields: PageFields, kept: Partial<CmsFields> | null): CmsFields {
  return {
    slug: kept?.slug || fields.slug,
    metaTitle: kept?.metaTitle || metaTitleOf(fields.metaTitle),
    metaDescription: kept?.metaDescription || fields.metaDescription,
  };
}

/** Why the fields can't go as they are, or null. */
export function cmsFieldsProblem(
  fields: CmsFields,
): 'slug' | 'metaTitle' | 'metaDescription' | null {
  if (!SLUG_PATTERN.test(fields.slug.trim()) || fields.slug.trim().length > 200) return 'slug';
  if (fields.metaTitle.trim().length > META_TITLE_MAX) return 'metaTitle';
  if (fields.metaDescription.trim().length > META_DESCRIPTION_MAX) return 'metaDescription';
  return null;
}

/**
 * Why the page can't go yet, or null: the CMS needs a title, a page with no
 * words or image under its H1 has nothing to publish, and the server takes
 * a page up to a million characters.
 */
export function cmsPageProblem(
  title: string,
  html: string,
): 'noTitle' | 'longTitle' | 'empty' | 'tooLong' | null {
  if (!title.trim()) return 'noTitle';
  if (title.trim().length > TITLE_MAX) return 'longTitle';
  if (html.length > HTML_MAX) return 'tooLong';
  const body = fragment(withoutLeadingH1(html));
  if (!body.textContent?.trim() && !body.querySelector('img')) return 'empty';
  return null;
}

/** A stored page as the Send dialog takes it, as the editor would give it. */
export interface CmsSource {
  draftId: string;
  title: string;
  /** publishableHtml's, as Copy HTML gives it. */
  html: string;
  sourceUrl: string | null;
  author: ContentAuthor | null;
  /** Qualified reviewer (CE-049), not the page author. */
  reviewer: ContentAuthor | null;
  /**
   * The brand's team in the page's language, for the CMS's author field when
   * the page has no author (teamName); empty while the authors aren't read.
   */
  teamByline: string;
  /** The byline line the brand puts in the content, or null. */
  byline: string | null;
  /** The Article schema GetCito adds to the page as it goes (00448). */
  schema: AddedArticleSchema;
}

/**
 * A Library row's page for Send to CMS, as the editor gives its own: the
 * stored page made publishable, its author, the team for the CMS's author
 * field as Export names it, and the brand's byline line, both in the page's
 * language (its own Language rule, else the brand's; a workspace's My rules
 * for the type aren't read here). `authors` is null while Quality is off,
 * as the editor reads none then. With no author picked and the one the site
 * names confirmed (00271), neither the team nor its byline line: the CMS
 * keeps its own author.
 */
export function cmsSource({
  page,
  authors,
  brandId,
  brandName,
  brandLanguage,
}: {
  page: DraftPage;
  authors: AuthorsRead | null;
  brandId: string;
  brandName: string;
  brandLanguage: string | null | undefined;
}): CmsSource {
  const language = page.language ?? brandLanguage;
  const author = authors?.authors.find((a) => a.id === page.authorId) ?? null;
  const reviewer = authors?.authors.find((a) => a.id === page.reviewerId) ?? null;
  const inContent = authors?.brands.find((b) => b.id === brandId)?.bylineInContent ?? false;
  const confirmed = !author && page.authorConfirmed;
  return {
    draftId: page.id,
    title: page.title,
    html: publishableHtml(page.bodyHtml),
    sourceUrl: page.sourceUrl,
    author,
    reviewer,
    teamByline: authors && !confirmed ? teamName(language, brandName) : '',
    byline: inContent && !confirmed ? bylineText(language, author?.name ?? null, brandName) : null,
    // As Before you publish shows it; Site trust isn't read here, so no pages of theirs.
    schema: {
      input: articleSchemaInput({
        title: page.title,
        author: schemaAuthor({
          authorsOn: qualityPhase() >= 1,
          authorsRead: authors !== null,
          author,
          confirmedReal: page.authorConfirmed,
        }),
        siteTrust: null,
        brandName,
        isNew: page.isNew,
      }),
      pageType: page.pageType,
      leftOut: page.schemaLeftOut,
    },
  };
}

/** The image's alt text, where the page shows it. */
function altOf(html: string, src: string): string {
  const image = [...fragment(html).querySelectorAll('img')].find(
    (img) => img.getAttribute('src') === src,
  );
  return image?.getAttribute('alt') ?? '';
}

/** The page as it goes to the CMS. `html` is publishableHtml's, its placeholders filled. */
export function cmsPage({
  draftId,
  title,
  html,
  fields,
  page,
  byline,
  reviewer = null,
}: {
  draftId: string;
  title: string;
  html: string;
  fields: CmsFields;
  /** pageFields' read of the page: its author and featured image. */
  page: PageFields;
  /** The byline line the brand puts in the content, or null. */
  byline: string | null;
  /** The selected qualified reviewer: its WebPage.reviewedBy once the page names them. */
  reviewer?: ContentAuthor | null;
}): CmsPage {
  const withLine = withReviewerJsonLd(title, byline ? withByline(html, byline) : html, reviewer);
  const src = page.featuredImage;
  const image = src?.startsWith('https://') && src.length <= IMAGE_SRC_MAX ? src : null;
  return {
    draftId,
    title: title.trim(),
    slug: fields.slug.trim(),
    metaTitle: fields.metaTitle.trim(),
    metaDescription: fields.metaDescription.trim(),
    html: withoutLeadingH1(withLine),
    author: page.author.trim().slice(0, AUTHOR_MAX) || null,
    reviewer: page.reviewer.trim().slice(0, AUTHOR_MAX) || null,
    featuredImage: image ? { src: image, alt: altOf(html, image).slice(0, ALT_MAX) } : null,
  };
}

/** As the server's: the pages one send takes. */
export const CMS_PAGES_PER_SEND = 25;
/**
 * About as much as one request carries: the browser's go through the API's
 * proxy, a serverless function whose body is capped at 4.5 MB.
 */
const SEND_BODY_BUDGET = 3_000_000;

/** Why a page of a bulk send can't go as it is, or null. */
export type BulkProblem =
  | 'noTitle'
  | 'longTitle'
  | 'empty'
  | 'tooLong'
  | 'placeholders'
  | 'slug'
  | 'metaTitle'
  | 'metaDescription';

export interface BulkItem {
  draftId: string;
  title: string;
  problem: BulkProblem | null;
  /** The page as it goes; null when it can't. */
  page: CmsPage | null;
}

/**
 * A bulk send's pages, each as the Send dialog would send it unchanged: its
 * slug and meta what it kept from its last send, else the page's; or why it
 * can't go (filled in the editor, where its fields can be changed too).
 */
export function bulkCmsItems(
  sources: CmsSource[],
  kept: ReadonlyMap<string, Partial<CmsFields>>,
): BulkItem[] {
  return sources.map((source) => {
    const { draftId, title } = source;
    // With the Article schema GetCito adds, as the editor sends it.
    const html = withArticleSchema(source.html, source.schema);
    const page = pageFields(source);
    const fields = cmsFields(page, kept.get(draftId) ?? null);
    const problem =
      cmsPageProblem(title, html) ??
      (exportPlaceholders(html) + titlePlaceholders(title, html) > 0 ? 'placeholders' : null) ??
      cmsFieldsProblem(fields);
    return {
      draftId,
      title,
      problem,
      page: problem
        ? null
        : cmsPage({
            draftId,
            title,
            html,
            fields,
            page,
            byline: source.byline,
            reviewer: source.reviewer,
          }),
    };
  });
}

/**
 * The pages in sends a request each can carry, in order, by their bytes as
 * sent: a long page goes alone, never split. Each request is a send of its
 * own on the server, its pages one after another; the bulk dialog posts the
 * next once the last one's pages have gone, so groups don't go side by side.
 */
export function cmsSendGroups(pages: CmsPage[], budget = SEND_BODY_BUDGET): CmsPage[][] {
  const groups: CmsPage[][] = [];
  const encoder = new TextEncoder();
  let size = 0;
  for (const page of pages) {
    const pageSize = encoder.encode(JSON.stringify(page)).length;
    const last = groups.at(-1);
    if (last && size + pageSize <= budget) {
      last.push(page);
      size += pageSize;
    } else {
      groups.push([page]);
      size = pageSize;
    }
  }
  return groups;
}
