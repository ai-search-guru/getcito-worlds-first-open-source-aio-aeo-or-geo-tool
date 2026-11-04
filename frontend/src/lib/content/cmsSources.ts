import { getContentAuthors } from '@/lib/actions/contentAuthors';
import { getContentDraftPages, type DraftPage } from '@/lib/actions/contentDrafts';
import { cmsSource, type CmsSource } from '@/lib/content/cmsSend';
import { DRAFT_PAGES_PER_CALL } from '@/lib/content/drafts';
import { qualityPhase } from '@/lib/content/quality';

/**
 * Library pages for Send to CMS (#1331), made ready as the editor makes its
 * own: their author, the team and the brand's byline line in the page's
 * language once Quality is live. Read a
 * slice at a time, as the Library's Export reads them; a page gone meanwhile
 * is left out. The Library's bulk send and Chat's push_cms_draft read here.
 */
export async function readCmsSources({
  brandId,
  draftIds,
  brandName,
  brandLanguage,
}: {
  brandId: string;
  draftIds: string[];
  brandName: string;
  brandLanguage: string | null | undefined;
}): Promise<Map<string, CmsSource>> {
  const readPages = async () => {
    const pages: DraftPage[] = [];
    let queue = draftIds;
    while (queue.length > 0) {
      const read = await getContentDraftPages(brandId, queue.slice(0, DRAFT_PAGES_PER_CALL));
      pages.push(...read.pages);
      queue = [...read.rest, ...queue.slice(DRAFT_PAGES_PER_CALL)];
    }
    return pages;
  };
  const [pages, authors] = await Promise.all([
    readPages(),
    qualityPhase() >= 1 ? getContentAuthors().catch(() => null) : Promise.resolve(null),
  ]);
  const name = authors?.brands.find((b) => b.id === brandId)?.name ?? brandName;
  return new Map(
    pages.map((page) => [
      page.id,
      cmsSource({
        page,
        authors,
        brandId,
        brandName: name,
        brandLanguage,
      }),
    ]),
  );
}
