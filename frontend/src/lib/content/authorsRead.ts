import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorsRead } from '@/lib/content/authors';

/**
 * The workspace's authors and its brands (content_authors, 00256; the
 * brands' byline setting, 00261), read through the client given: the
 * member's session for Settings and the editor (getContentAuthors), the
 * service role for the MCP's get_content_draft_package once the draft is the
 * key's. `pages` counts each author's pages (Settings' column).
 */

const AUTHOR_COLUMNS = 'id, name, title, bio, photo_url, same_as, user_id, created_by';

export async function readContentAuthors(
  supabase: SupabaseClient,
  organizationId: string,
  { me, pages: pagesToo = false }: { me: AuthorsRead['me']; pages?: boolean },
): Promise<AuthorsRead> {
  const [authorsRes, brandsRes, defaultsRes] = await Promise.all([
    supabase
      .from('content_authors')
      .select(AUTHOR_COLUMNS)
      .eq('organization_id', organizationId)
      .order('name'),
    supabase
      .from('brands')
      .select('id, name, content_byline')
      .eq('organization_id', organizationId)
      .order('name'),
    // The organization's brands' defaults only: the service role reads every row.
    supabase
      .from('content_author_defaults')
      .select('brand_id, author_id, brands!inner(organization_id)')
      .eq('brands.organization_id', organizationId),
  ]);
  for (const res of [authorsRes, brandsRes, defaultsRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const defaults = (defaultsRes.data ?? []) as { brand_id: string; author_id: string }[];
  const rows = authorsRes.data ?? [];
  // A workspace has a few authors: one count each, on content_drafts_author,
  // of the pages the Library shows (not archived).
  const pages = pagesToo
    ? await Promise.all(
        rows.map(async (row) => {
          const { count, error } = await supabase
            .from('content_drafts')
            .select('id', { count: 'exact', head: true })
            .eq('author_id', row.id)
            .is('archived_at', null);
          if (error) throw new Error(error.message);
          return count ?? 0;
        }),
      )
    : null;
  return {
    authors: rows.map((row, i) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      bio: row.bio,
      photoUrl: row.photo_url,
      sameAs: row.same_as ?? [],
      userId: row.user_id,
      createdBy: row.created_by,
      defaultFor: defaults.filter((d) => d.author_id === row.id).map((d) => d.brand_id),
      pages: pages?.[i] ?? null,
    })),
    brands: (brandsRes.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      bylineInContent: !!b.content_byline,
    })),
    me,
  };
}
