'use server';

/**
 * Getting started (New GetCito, AC-ALT2 §4): the 17 setup steps in the
 * Actions page. Reads the brand's facts in one call (getting_started_facts,
 * 00196) and turns them into steps in lib/getting-started/steps.ts; stores
 * only what the data can't show — a page opened, an optional step skipped.
 */

import { createClient } from '@/lib/supabase/server';
import { dbClient } from '@/lib/supabase/scoped';
import {
  GETTING_STARTED_STEPS,
  buildGettingStarted,
  isPageOpenedStep,
  parseGettingStartedFacts,
  type GettingStartedStatus,
} from '@/lib/getting-started/steps';
import { assertWritable } from '@/lib/subscriptionGuard';

/** What the database says when a write would change the demo brand (00381). */
const DEMO_BRAND = 'demo_brand';

/** The brand's steps, or null for a brand the caller can't see. */
export async function getGettingStarted(brandId: string): Promise<GettingStartedStatus | null> {
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('getting_started_facts', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  const facts = parseGettingStartedFacts(data);
  return facts ? buildGettingStarted(facts) : null;
}

/** A page opened, as recorded: whether it counts now (or did before), or why it couldn't be. */
export type PageOpenedResult =
  { ok: true; recorded: boolean } | { ok: false; failure: 'step' | 'failed' };

/**
 * One of the explore pages was opened. Recorded once the brand's first
 * answers are in, so a page opened while it had nothing to show doesn't
 * count: `recorded` says whether the step counts, now or before. Open while
 * the workspace is read-only: a trace of reading, which changes nothing.
 * The demo brand's sample data keeps no steps (00381 refuses the write):
 * nothing is recorded and nothing is said. Answers as a value and never
 * throws (#1777), so a page's open never ends in an error.
 */
export async function markGettingStartedPageOpened(
  brandId: string,
  step: string,
): Promise<PageOpenedResult> {
  try {
    if (!isPageOpenedStep(step)) return { ok: false, failure: 'step' };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('getting_started_page_opened', {
      p_brand_id: brandId,
      p_step: step,
    });
    if (error?.message === DEMO_BRAND) return { ok: true, recorded: false };
    if (error) {
      console.error('[getting-started] could not record a page opened:', error.message);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true, recorded: data === true };
  } catch (error) {
    console.error('[getting-started] could not record a page opened:', error);
    return { ok: false, failure: 'failed' };
  }
}

/** Skip an optional step (Search Console, Analytics). It counts as complete. */
export async function skipGettingStartedStep(brandId: string, step: string): Promise<void> {
  await assertWritable({ brandId });
  if (!GETTING_STARTED_STEPS.some((s) => s.key === step && s.optional)) {
    throw new Error('not an optional step');
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('getting_started_steps')
    .upsert(
      { brand_id: brandId, step, state: 'skipped', updated_at: new Date().toISOString() },
      { onConflict: 'brand_id,step' },
    );
  if (error) throw new Error(error.message);
}

/**
 * Run Getting started for the brand: an existing brand's "Start getting
 * started", or "Run" on a new brand's question. Starting again after a skip
 * clears it. Admins and managers only (00197); the started time is kept, so
 * steps finished meanwhile still count.
 */
export async function startGettingStarted(brandId: string): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { error } = await supabase
    .from('getting_started')
    .upsert(
      { brand_id: brandId, confirmed_at: new Date().toISOString(), dismissed_at: null },
      { onConflict: 'brand_id' },
    );
  if (error) throw new Error(error.message);
}

/**
 * Skip Getting started: the actions list goes back to normal, the steps
 * already done stay done, and Start brings it back.
 */
export async function skipGettingStarted(brandId: string): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('getting_started')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select('brand_id');
  if (error) throw new Error(error.message);
  // RLS lets only admins and managers write: nothing changed otherwise.
  if (!data?.length) throw new Error('not skipped');
}
