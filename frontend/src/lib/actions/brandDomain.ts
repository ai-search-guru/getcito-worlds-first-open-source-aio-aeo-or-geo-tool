'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import type { BrandDomain } from '@/types';
import { API_BASE_URL } from '@/config/api';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * `prompt_results.citation_count` is computed at tracking time against the
 * brand's domain list of that moment and frozen into the row. When the list
 * changes, the stored tallies silently diverge from what the Citations page
 * classifies live — the same "own citations" metric then shows different
 * numbers on different surfaces. Kick the server-side recount after the
 * response is sent; a failed recount self-heals on the next domain change.
 */
function scheduleCitationRecount(brandId: string) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return;
  after(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/internal/recount-citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ brandId }),
      });
    } catch (err) {
      console.error('[brand-domain] citation recount failed', err);
    }
  });
}

function mapDomainRow(d: Record<string, unknown>): BrandDomain {
  return {
    id: d.id as string,
    brandId: d.brand_id as string,
    domain: d.domain as string,
    country: (d.country as string | null) ?? undefined,
    isPrimary: d.is_primary as boolean,
  };
}

export async function addDomain(
  brandId: string,
  data: { domain: string; country?: string; isPrimary: boolean },
): Promise<BrandDomain> {
  await assertWritable({ brandId });
  const supabase = await createClient();

  const { data: domain, error } = await supabase
    .from('brand_domains')
    .insert({
      brand_id: brandId,
      domain: data.domain.trim(),
      country: data.country?.trim() || null,
      is_primary: data.isPrimary,
    })
    .select()
    .single();

  if (error || !domain) throw new Error(error?.message ?? 'Failed to add domain');

  scheduleCitationRecount(brandId);
  revalidatePath('/dashboard/brands');
  return mapDomainRow(domain as Record<string, unknown>);
}

export async function updateDomain(
  id: string,
  data: { domain?: string; country?: string | null; isPrimary?: boolean },
): Promise<BrandDomain> {
  await assertWritable();
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (data.domain !== undefined) payload.domain = data.domain.trim();
  if ('country' in data) payload.country = data.country?.trim() || null;
  if (data.isPrimary !== undefined) payload.is_primary = data.isPrimary;

  const { data: domain, error } = await supabase
    .from('brand_domains')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error || !domain) throw new Error(error?.message ?? 'Failed to update domain');

  // Only a change to the domain string itself affects citation counts.
  if (data.domain !== undefined) {
    scheduleCitationRecount((domain as Record<string, unknown>).brand_id as string);
  }
  revalidatePath('/dashboard/brands');
  return mapDomainRow(domain as Record<string, unknown>);
}

export async function removeDomain(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  const { data: removed, error } = await supabase
    .from('brand_domains')
    .delete()
    .eq('id', id)
    .select('brand_id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (removed?.brand_id) scheduleCitationRecount(removed.brand_id as string);
  revalidatePath('/dashboard/brands');
}

/**
 * Replace all domains for a brand with the provided list.
 * Used by the DomainsTab save action.
 */
export async function syncDomains(
  brandId: string,
  domains: { domain: string; country?: string; isPrimary: boolean }[],
): Promise<BrandDomain[]> {
  await assertWritable({ brandId });
  const supabase = await createClient();

  await supabase.from('brand_domains').delete().eq('brand_id', brandId);

  if (domains.length === 0) {
    scheduleCitationRecount(brandId);
    revalidatePath('/dashboard/brands');
    return [];
  }

  const { data: inserted, error } = await supabase
    .from('brand_domains')
    .insert(
      domains.map((d) => ({
        brand_id: brandId,
        domain: d.domain.trim(),
        country: d.country?.trim() || null,
        is_primary: d.isPrimary,
      })),
    )
    .select();

  if (error) throw new Error(error.message);

  scheduleCitationRecount(brandId);
  revalidatePath('/dashboard/brands');
  return ((inserted as Record<string, unknown>[]) ?? []).map(mapDomainRow);
}
