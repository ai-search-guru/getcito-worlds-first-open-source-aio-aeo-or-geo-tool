import type { SupabaseClient } from '@supabase/supabase-js';
import { detectPageType, siteTypeOf, type SiteType } from '@/lib/content/pageTypes';

/**
 * A draft's detected page type, kept with its page (CE-023): after a restore
 * (History's, or Chat's Undo) the type is detected again on the page that
 * came back, as on a save. Shared by restoreDraftVersion and Chat's Undo.
 */

/** What a draft row embeds of its brand: enough to know its site type. */
export const BRAND_SITE = 'brands(site_type, industry, shopping_mode_enabled)';

export function brandSiteType(
  brand: {
    site_type: string | null;
    industry: string | null;
    shopping_mode_enabled: boolean;
  } | null,
): SiteType {
  return siteTypeOf({
    siteType: brand?.site_type,
    industry: brand?.industry,
    shoppingModeEnabled: brand?.shopping_mode_enabled,
  });
}

/**
 * Detects the type of a page just restored, for a draft whose type was
 * detected (never one the person picked), and writes it only over that
 * restore (`updatedAt`): a write in between keeps its own. A page that shows
 * no type keeps the one it had. Returns the draft's updated_at after; a
 * failure leaves the type to catch up on the next save.
 */
export async function followRestoredPageType(
  supabase: Pick<SupabaseClient, 'from'>,
  id: string,
  restored: { title: string; bodyHtml: string; updatedAt: string },
): Promise<string> {
  // Read back, so the type is detected only on the draft the version restored.
  const { data: row, error } = await supabase
    .from('content_drafts')
    .select(`page_type, page_type_source, body_html, source_url, ${BRAND_SITE}`)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('Failed to read the restored draft:', error.message);
    return restored.updatedAt;
  }
  if (row?.page_type_source !== 'detected' || row.body_html !== restored.bodyHtml) {
    return restored.updatedAt;
  }
  const brands = (Array.isArray(row.brands) ? row.brands[0] : row.brands) as Parameters<
    typeof brandSiteType
  >[0];
  const detected = detectPageType(
    { title: restored.title, html: restored.bodyHtml, url: row.source_url },
    brandSiteType(brands),
  );
  if (!detected || detected === row.page_type) return restored.updatedAt;
  const { data: typed, error: typeError } = await supabase
    .from('content_drafts')
    .update({ page_type: detected })
    .eq('id', id)
    .eq('page_type_source', 'detected')
    // Only over the restore, as after a save.
    .eq('updated_at', restored.updatedAt)
    .select('updated_at')
    .maybeSingle();
  if (typeError) {
    console.error('Failed to update the detected page type:', typeError.message);
    return restored.updatedAt;
  }
  return (typed?.updated_at as string | undefined) ?? restored.updatedAt;
}
