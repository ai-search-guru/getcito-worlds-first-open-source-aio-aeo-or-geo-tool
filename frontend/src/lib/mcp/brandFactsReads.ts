import type { McpAuthContext } from '@/lib/mcpAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { FactKind, FactValue } from '@/lib/content/brandFacts';
import { brandAllowed } from './data';
import { newestOf } from './chatFacts';

/**
 * Chat's read of a brand's facts (CHAT-20 §8a Brands, CE-047): its prices
 * and plans, trial, founding year and claims, read from its own pricing,
 * About and product pages, each approved by a person in Brand settings ›
 * Brand facts. Only the approved ones still on the site, the ones Quality's
 * Trust check and the go-live gate compare a page with: a pending, rejected
 * or gone fact never leaves. Each fact as the page's words that state it,
 * its kind and value, when it was approved and the page it was read from;
 * no id, slot or reviewer. `data_as_of` is the last time the site was read
 * and still said them (§15a). Null for a brand outside the organization or
 * the person's brand access.
 */

interface FactRow {
  kind: FactKind;
  value: FactValue | null;
  quote: string;
  source_url: string;
  reviewed_at: string | null;
  last_seen_at: string | null;
}

export async function getBrandFactsFor(auth: McpAuthContext, params: { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const { data, error } = await supabaseAdmin
    .from('brand_facts')
    .select(
      'kind, value, quote, source_url, reviewed_at, last_seen_at, brands!inner(organization_id)',
    )
    .eq('brand_id', params.brandId)
    .eq('brands.organization_id', auth.organizationId!)
    .eq('status', 'approved')
    .is('gone_at', null)
    .order('first_seen_at')
    .order('id');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as FactRow[];
  return {
    facts: rows.map((row) => ({
      kind: row.kind,
      text: row.quote,
      // A claim is its words; a price, a trial or a founding year has its value too.
      ...(row.kind === 'claim' ? {} : { value: row.value }),
      approved_at: row.reviewed_at,
      source_url: row.source_url,
    })),
    data_as_of: newestOf(rows.map((row) => row.last_seen_at)),
  };
}
