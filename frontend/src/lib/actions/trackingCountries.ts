'use server';

import { createClient } from '@/lib/supabase/server';
import type { TrackingCountry } from '@/lib/trackingCountries';

/** Rows read per page: PostgREST stops a read at 1000. */
const PAGE = 1000;

/**
 * The countries the tracking engines answer from (PROMPT-015e), as the API
 * last read them from the provider; each with its engines. Empty before the
 * first read, or without the provider key: the picker then offers its own
 * list.
 */
export async function getTrackingCountries(): Promise<TrackingCountry[]> {
  const supabase = await createClient();
  const rows: { model: string; country: string }[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await supabase
      .from('cloro_countries')
      .select('model, country')
      .order('country')
      .order('model')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  const byCountry = new Map<string, string[]>();
  for (const { model, country } of rows) {
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country)!.push(model);
  }
  return [...byCountry].map(([code, models]) => ({ code, models }));
}
