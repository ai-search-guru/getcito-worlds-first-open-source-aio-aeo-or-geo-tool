import supabaseAdmin from '../config/supabase.js';
import { siteTypeOf } from './contentPageTypes.js';

/**
 * What a brand's page read is read with, besides the page: its kind of site,
 * its name, and its approved claims about itself (CE-047), at most 10, in
 * one order (the read is kept by them). For the editor's route and the
 * go-live gate alike.
 */
export async function pageReadContext(brandId) {
  const [brandRes, factsRes] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('name, site_type, industry, shopping_mode_enabled')
      .eq('id', brandId)
      .single(),
    supabaseAdmin
      .from('brand_facts')
      .select('quote')
      .eq('brand_id', brandId)
      .eq('kind', 'claim')
      .eq('status', 'approved')
      .is('gone_at', null)
      // One order for ties (a run's facts share their time): the page's read is kept by them.
      .order('first_seen_at')
      .order('id')
      .limit(10),
  ]);
  if (brandRes.error) throw brandRes.error;
  if (factsRes.error) throw factsRes.error;
  const brand = brandRes.data;
  return {
    siteType: siteTypeOf({
      siteType: brand.site_type,
      industry: brand.industry,
      shoppingModeEnabled: brand.shopping_mode_enabled,
    }),
    brandName: brand.name,
    facts: (factsRes.data ?? []).map((f) => f.quote),
  };
}
