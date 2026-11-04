import supabaseAdmin from '../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../config/plans.js';
import { refreshOnce } from './brandFacts.js';
import { qualityPhase } from './contentQuality.js';
import { logger } from './logger.js';

/**
 * A brand's facts read again each week (Quality spec §10, CE-047): the
 * daily run reads the brands whose site was last read over REFRESH_DAYS
 * ago, the longest waiting first, SWEEP_LIMIT a run. Only brands read
 * before (someone opened their facts): a brand no one uses the Content
 * Editor for costs nothing. A page that hasn't changed isn't read by the
 * model (refreshBrandFacts, once at a time with the tab's reads); a value
 * that has is a new pending fact, the to-do. Approved facts gone from the site for GONE_KEEP_DAYS go.
 */

export const REFRESH_DAYS = 7;
/** Brands one run reads, so a night's model spend has a ceiling. */
export const SWEEP_LIMIT = 25;
/** How long an approved fact gone from the site is kept, shown as gone. */
export const GONE_KEEP_DAYS = 30;
/** How long one run reads: 25 slow sites in a row could keep it busy half an hour. */
export const SWEEP_DEADLINE_MS = 10 * 60_000;

const DAY_MS = 86_400_000;

/**
 * Reads the brands due again, one at a time, `limit` of them. A brand
 * whose workspace isn't subscribed (cloud) or that has no domain left is
 * marked read so it doesn't stand first in line every night; one whose
 * read failed is marked failed (read again when someone opens its facts).
 * A read the AI budget stopped is `paused`: its pages are marked read (by
 * the read itself) and failed, read again when someone opens its facts or
 * next week; the workspace's other brands wait for the next run, and
 * don't count toward `limit`.
 *
 * @returns {Promise<{ read: number, paused: number, skipped: number, failed: number } | { skipped: 'off' }>}
 */
export async function sweepBrandFacts({
  now = Date.now(),
  limit = SWEEP_LIMIT,
  db = supabaseAdmin,
  refresh = refreshOnce,
} = {}) {
  if (qualityPhase() < 2) return { skipped: 'off' };
  const nowIso = new Date(now).toISOString();
  const { data: rows, error } = await db
    .from('brand_fact_pages')
    .select('brand_id, checked_at, brands!inner(organization_id, is_active, is_demo)')
    .lt('checked_at', new Date(now - REFRESH_DAYS * DAY_MS).toISOString())
    .eq('brands.is_active', true)
    // A demo brand's site (00380) is a `.example` domain nobody serves.
    .eq('brands.is_demo', false)
    .order('checked_at', { ascending: true })
    .limit(limit * 6);
  if (error) throw new Error(error.message);

  const brands = [];
  for (const row of rows ?? []) {
    if (!brands.some((b) => b.id === row.brand_id)) {
      brands.push({ id: row.brand_id, orgId: row.brands.organization_id });
    }
  }
  let active = () => true;
  if (brands.length && isCloud()) {
    const { data: orgs, error: orgError } = await db
      .from('organizations')
      .select('id, subscription_status')
      .in('id', [...new Set(brands.map((b) => b.orgId))]);
    if (orgError) throw new Error(orgError.message);
    const subscribed = new Set(
      (orgs ?? []).filter((o) => isSubscriptionActive(o.subscription_status)).map((o) => o.id),
    );
    active = (orgId) => subscribed.has(orgId);
  }

  const outcome = { read: 0, paused: 0, skipped: 0, failed: 0 };
  const spent = new Set();
  const markRead = [];
  const markFailed = [];
  let tried = 0;
  const started = Date.now();
  for (const brand of brands) {
    // The brands left stay first in line for the next run.
    if (tried >= limit || Date.now() - started > SWEEP_DEADLINE_MS) break;
    if (!active(brand.orgId)) {
      outcome.skipped += 1;
      markRead.push(brand.id);
      continue;
    }
    if (spent.has(brand.orgId)) continue;
    tried += 1;
    try {
      const result = await refresh(brand.id, { orgId: brand.orgId, now });
      if (result.noDomain) {
        outcome.skipped += 1;
        markRead.push(brand.id);
        continue;
      }
      if (result.paused) {
        spent.add(brand.orgId);
        outcome.paused += 1;
      } else outcome.read += 1;
    } catch (err) {
      // One brand's failure isn't the run's, nor first in line tomorrow.
      outcome.failed += 1;
      markFailed.push(brand.id);
      logger.warn(
        { err: { name: err?.name, message: err?.message }, brandId: brand.id },
        '[brand-facts] a brand was not read',
      );
    }
  }

  const writes = [
    db
      .from('brand_facts')
      .delete()
      .eq('status', 'approved')
      .lt('gone_at', new Date(now - GONE_KEEP_DAYS * DAY_MS).toISOString()),
  ];
  if (markRead.length) {
    writes.push(
      db.from('brand_fact_pages').update({ checked_at: nowIso }).in('brand_id', markRead),
    );
  }
  if (markFailed.length) {
    // A page whose answer missed the schema stays missed: failed, it would
    // keep its hash and be taken as read, its facts never read.
    writes.push(
      db
        .from('brand_fact_pages')
        .update({ checked_at: nowIso, status: 'failed' })
        .in('brand_id', markFailed)
        .neq('status', 'missed'),
      db
        .from('brand_fact_pages')
        .update({ checked_at: nowIso })
        .in('brand_id', markFailed)
        .eq('status', 'missed'),
    );
  }
  for (const res of await Promise.all(writes)) {
    if (res.error) throw new Error(res.error.message);
  }
  logger.info(outcome, '[brand-facts] weekly sweep');
  return outcome;
}
