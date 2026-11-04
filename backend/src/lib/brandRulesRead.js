/**
 * Reads a brand's rules (brandRules.js, 00450) for the server's prompts,
 * from the brand's row: never from the browser.
 */

import supabaseAdmin from '../config/supabase.js';
import { cleanBrandRules } from './brandRules.js';
import logger from './logger.js';

/** A database without brands.brand_rules yet (the API deployed ahead of 00450). */
const missingColumn = (error) =>
  (error?.code === '42703' || error?.code === 'PGRST204') &&
  String(error.message ?? '').includes('brand_rules');

/**
 * The brand's rules; none for a brand without, before 00450, or when they
 * can't be read: what's written then follows the other rules alone, as before.
 * Never throws.
 */
export async function readBrandRules(brandId) {
  if (!brandId) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('brand_rules')
      .eq('id', brandId)
      .maybeSingle();
    if (error) {
      if (!missingColumn(error)) logger.warn({ err: error, brandId }, 'brand rules unread');
      return [];
    }
    return cleanBrandRules(data?.brand_rules);
  } catch (err) {
    logger.warn({ err, brandId }, 'brand rules unread');
    return [];
  }
}
