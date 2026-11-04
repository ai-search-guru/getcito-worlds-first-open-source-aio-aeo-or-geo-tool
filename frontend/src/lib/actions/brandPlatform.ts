'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { enforceFeature, enforceLimit } from '@/lib/guards/planGuard';
import type { AIPlatform, BrandPlatform, CheckFrequency } from '@/types';
import { assertWritable } from '@/lib/subscriptionGuard';

function mapRow(row: Record<string, unknown>): BrandPlatform {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    platform: row.platform as AIPlatform,
    isEnabled: row.is_enabled as boolean,
    checkFrequency: row.check_frequency as CheckFrequency,
    apiModel: (row.api_model as string | null) ?? undefined,
    lastCheckedAt: (row.last_checked_at as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getBrandPlatforms(brandId: string): Promise<BrandPlatform[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('brand_platforms')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function syncBrandPlatforms(
  brandId: string,
  platforms: {
    platform: AIPlatform;
    isEnabled: boolean;
    checkFrequency: CheckFrequency;
    apiModel?: string;
  }[],
): Promise<BrandPlatform[]> {
  await assertWritable({ brandId });
  const supabase = await createClient();

  const { data: brand } = await supabase
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .single();

  if (brand) {
    const enabledCount = platforms.filter((p) => p.isEnabled).length;
    await enforceLimit(brand.organization_id, 'maxPlatforms', enabledCount - 1);

    const hasDailyFreq = platforms.some((p) => p.checkFrequency === 'daily');
    if (hasDailyFreq) {
      await enforceFeature(brand.organization_id, 'daily_monitoring');
    }
  }

  const { error: deleteError } = await supabase
    .from('brand_platforms')
    .delete()
    .eq('brand_id', brandId);

  if (deleteError) throw new Error(deleteError.message);

  if (platforms.length === 0) {
    revalidatePath('/dashboard/brands');
    return [];
  }

  const { data, error } = await supabase
    .from('brand_platforms')
    .insert(
      platforms.map((p) => ({
        brand_id: brandId,
        platform: p.platform,
        is_enabled: p.isEnabled,
        check_frequency: p.checkFrequency,
        api_model: p.apiModel || null,
      })),
    )
    .select();

  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/brands');
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function updateBrandPlatform(
  id: string,
  updates: { isEnabled?: boolean; checkFrequency?: CheckFrequency; apiModel?: string },
): Promise<BrandPlatform> {
  await assertWritable();
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (updates.isEnabled !== undefined) payload.is_enabled = updates.isEnabled;
  if (updates.checkFrequency !== undefined) payload.check_frequency = updates.checkFrequency;
  if (updates.apiModel !== undefined) payload.api_model = updates.apiModel || null;

  const { data, error } = await supabase
    .from('brand_platforms')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to update platform');

  revalidatePath('/dashboard/brands');
  return mapRow(data as Record<string, unknown>);
}
