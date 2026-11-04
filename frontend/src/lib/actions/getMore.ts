'use server';

import { isCloud } from '@/config/plans';
import { planCardOf, type PlanCard } from '@/lib/chat/access';
import { readChatStorage } from '@/lib/chat/fileOutput';
import type { ChatStorage } from '@/lib/chat/files';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { planFactsFromOrgRow, type OrgPlanRow } from '@/lib/chat/planFacts';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getBillingAddOns, type BillingAddOns } from './addOns';

/**
 * The "Get more" window's read (CHAT-18 §C), behind CHAT_AGENTIC on the
 * cloud: the packs and whether the person can buy them (Settings › Billing ›
 * Add-ons' own read), the "Your plan" card (CHAT-20 §7a) and the storage
 * Files takes and may keep. Never throws (#1777): `off` when there is no
 * window (Chat off, self-hosted), `failed` when a read didn't answer.
 */

export interface GetMoreWindow {
  addOns: BillingAddOns;
  plan: PlanCard | null;
  storage: ChatStorage;
}

export type GetMoreRead =
  { ok: true; window: GetMoreWindow } | { ok: false; failure: 'off' | 'failed' };

export async function getGetMore(): Promise<GetMoreRead> {
  try {
    if (!isCloud()) return { ok: false, failure: 'off' };
    const [addOns, own] = await Promise.all([getBillingAddOns(), readPlanAndStorage()]);
    if (!addOns.ok) return addOns;
    if (!own) return { ok: false, failure: 'off' };
    return { ok: true, window: { addOns: addOns.addOns, ...own } };
  } catch (err) {
    console.error('[get-more] Read failed:', err);
    return { ok: false, failure: 'failed' };
  }
}

/** The person's workspace's plan card and storage; null without Chat for it. */
async function readPlanAndStorage(): Promise<Pick<GetMoreWindow, 'plan' | 'storage'> | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  const [org, storage] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', organizationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data as OrgPlanRow;
      }),
    readChatStorage(organizationId),
  ]);
  return { plan: planCardOf(planFactsFromOrgRow(org)), storage };
}
