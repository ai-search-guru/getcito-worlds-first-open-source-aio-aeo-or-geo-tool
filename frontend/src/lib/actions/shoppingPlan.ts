'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { DRAFT_STATUSES } from '@/lib/content/drafts';
import { draftShopping } from '@/lib/content/shoppingCheck';
import type { ShoppingPlanDraft, ShoppingPlanPrompt } from '@/lib/content/shoppingPlan';

/**
 * What Plan › Shopping opportunities is built from besides the catalog's
 * categories (the browser reads those from the API, listCategoryPages),
 * through the signed-in member's session: the brand's drafts with their
 * shopping path's categories and its last check (00352), its active
 * prompts, and how many products its catalog has. lib/content/
 * shoppingPlan.ts makes the rows.
 */

/** The newest drafts read: enough to know which categories a page guides to. */
const DRAFT_LIMIT = 1000;
/** The newest active prompts read, as Start matches a page's (PAGE_PROMPTS_READ). */
const PROMPT_LIMIT = 1000;

const categoriesSchema = z
  .array(z.object({ name: z.string() }).passthrough())
  .catch([])
  .transform((list) => list.map((c) => c.name));

export async function getShoppingPlan(brandId: string): Promise<{
  drafts: ShoppingPlanDraft[];
  prompts: ShoppingPlanPrompt[];
  /** The catalog's live products. */
  products: number;
}> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await createClient();
  const [drafts, prompts, products] = await Promise.all([
    supabase
      .from('content_drafts')
      .select(
        'id, title, status, shopping_built:shopping_path->>builtAt, shopping_categories:shopping_path->categories, content_shopping_checks(read_from, checked_at, categories, categories_linked, products, products_linked, bad)',
      )
      .eq('brand_id', brandId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(DRAFT_LIMIT),
    supabase
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(PROMPT_LIMIT),
    supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .is('removed_at', null),
  ]);
  if (drafts.error) throw new Error(drafts.error.message);
  if (prompts.error) throw new Error(prompts.error.message);
  if (products.error) throw new Error(products.error.message);

  return {
    drafts: (drafts.data ?? []).map((row) => ({
      id: row.id,
      title: row.title ?? '',
      status: (DRAFT_STATUSES as readonly string[]).includes(row.status)
        ? (row.status as ShoppingPlanDraft['status'])
        : 'draft',
      categories: categoriesSchema.parse(row.shopping_categories),
      shopping: draftShopping(row.shopping_built, row.content_shopping_checks),
    })),
    prompts: (prompts.data ?? []).map((p) => ({ id: p.id, text: p.text ?? '' })),
    products: products.count ?? 0,
  };
}
