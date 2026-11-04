'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { dbClient } from '@/lib/supabase/scoped';
import type { OpenAiIndexRead } from '@/lib/shopping/openaiIndex';
import { getShoppingMerchantSplit, type ShoppingDatePreset } from './shopping';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * What "Catalog in OpenAI's product index" reads (#1281): the brand's word
 * that it sends a direct feed, and the cards for its own products in US
 * ChatGPT Shopping answers over the Overview's window, counted by
 * `shopping_merchant_split` (own-product cards, classified or not). On the
 * page, RLS and the RPC's membership check keep both to the caller's
 * organization; the MCP server runs it with the service role, so the brand
 * id filter and the RPC's p_brand_id are what keep it to the brand.
 */
export async function getOpenAiIndexRead(
  brandId: string,
  datePreset: ShoppingDatePreset,
): Promise<OpenAiIndexRead> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await dbClient();
  const [brand, split] = await Promise.all([
    supabase.from('brands').select('openai_product_feed').eq('id', brandId).maybeSingle(),
    getShoppingMerchantSplit(brandId, {
      datePreset,
      platforms: ['chatgpt-shopping'],
      chatgptMarket: 'us',
    }),
  ]);
  if (brand.error) throw new Error(brand.error.message);
  if (!brand.data) throw new Error('not_found');
  return {
    directFeed: !!brand.data.openai_product_feed,
    ownCards: split.classifiedCards + split.unclassifiedCards,
  };
}

/**
 * The brand's word that it sends OpenAI a direct product feed (00277).
 * Admins and managers (brands: admin/manager update); a brand they can't
 * change is refused.
 */
export async function setOpenAiProductFeed(brandId: string, on: boolean): Promise<void> {
  await assertWritable({ brandId });
  if (!z.guid().safeParse(brandId).success || typeof on !== 'boolean') throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .update({ openai_product_feed: on })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}
