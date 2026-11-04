'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import type { BrandFactsRead, FactStatus } from '@/lib/content/brandFacts';

/**
 * A brand's facts (Quality CE-047), as the API reads them from the brand's
 * own site and keeps them. Returned, not thrown: 'off' before Quality's
 * phase 2 is live on the API, 'failed' otherwise.
 */

type FactsError = { error: 'invalid' | 'failed' | 'off' };

const id = z.guid();

async function call(path: string, init: RequestInit = {}): Promise<Response | FactsError> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/brand-facts${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === 'off') return { error: 'off' };
    }
    if (!res.ok) return { error: 'failed' };
    return res;
  } catch (err) {
    console.error('Failed to reach the brand facts:', err);
    return { error: 'failed' };
  }
}

const readOf = async (res: Response | FactsError): Promise<BrandFactsRead | FactsError> => {
  if ('error' in res) return res;
  const body = (await res.json().catch(() => null)) as Partial<BrandFactsRead> | null;
  if (!body) return { error: 'failed' };
  return {
    facts: body.facts ?? [],
    pages: body.pages ?? [],
    checkedAt: body.checkedAt ?? null,
    recheckAt: body.recheckAt ?? null,
    paused: body.paused ?? false,
    noDomain: body.noDomain ?? false,
  };
};

/** The brand's facts: read from its site on the first ask, else as kept. */
export async function getBrandFacts(brandId: string): Promise<BrandFactsRead | FactsError> {
  if (!id.safeParse(brandId).success) return { error: 'invalid' };
  return readOf(await call(`?brandId=${encodeURIComponent(brandId)}`));
}

/** Reads the brand's site again (not more than every few minutes; the API says when). */
export async function readBrandFactsAgain(brandId: string): Promise<BrandFactsRead | FactsError> {
  if (!id.safeParse(brandId).success) return { error: 'invalid' };
  return readOf(await call('/fetch', { method: 'POST', body: JSON.stringify({ brandId }) }));
}

/** Approves or rejects a fact, as the member who does. */
export async function setBrandFactStatus(
  factId: string,
  status: Exclude<FactStatus, 'pending'>,
): Promise<{ id: string; status: FactStatus } | FactsError> {
  if (!id.safeParse(factId).success || (status !== 'approved' && status !== 'rejected')) {
    return { error: 'invalid' };
  }
  const res = await call(`/${factId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if ('error' in res) return res;
  const body = (await res.json().catch(() => null)) as { id: string; status: FactStatus } | null;
  return body ? { id: body.id, status: body.status } : { error: 'failed' };
}
