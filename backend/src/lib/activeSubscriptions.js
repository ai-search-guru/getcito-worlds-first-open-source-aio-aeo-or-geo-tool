/**
 * Which organizations the paid nightly work may still run for (2026-10-27).
 *
 * On the cloud, an organization whose free trial ended or whose plan was
 * cancelled is read-only: its people can look around, and the nightly
 * database-only upkeep (rollups, counters, retention) still runs for it, but
 * nothing that costs: no tracking, no AI, no agent, no scraping, no sync
 * with an outside service, no new signal, action or suggestion. Those
 * sweeps, the jobs and the job recovery keep to the ids these let through,
 * as webflowStatus.js and brandFactsSweep.js already did; what outside
 * sites and services send for it (AI-bot logs, traffic beacons, Cloro's
 * answers, workflow callbacks) is answered as usual and not stored.
 *
 * Self-hosted, every organization is let through (billing doesn't apply),
 * and nothing is read for them.
 *
 * A demo brand (00380) is never let through, on the cloud or self-hosted:
 * its data is the sample the demo generator writes (lib/demo), and nothing
 * may track, write or spend for it. So a brand is read even self-hosted.
 */

import supabaseAdmin from '../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../config/plans.js';
import { selectInChunks } from './chunkedIn.js';

/**
 * The subscription statuses isSubscriptionActive takes as active, for a
 * filter in a query (`.in(...)`); kept equal to it by a test. past_due is
 * not one: a failed payment locks the workspace at once (product decision,
 * 2026-10-27), with no grace while Stripe retries.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

const everyone = () => true;

function uniqueIds(ids) {
  return [...new Set((ids ?? []).filter(Boolean))];
}

/**
 * A test for the ids among `orgIds`: whether the organization has an active
 * or trialing subscription. Throws when the organizations can't be read: a
 * sweep that can't tell runs for nobody.
 *
 * @param {string[]} orgIds
 * @returns {Promise<(orgId: string) => boolean>}
 */
export async function activeOrgFilter(orgIds) {
  if (!isCloud()) return everyone;
  const ids = uniqueIds(orgIds);
  if (ids.length === 0) return () => false;
  const { data, error } = await selectInChunks(ids, (chunk) =>
    supabaseAdmin.from('organizations').select('id, subscription_status').in('id', chunk),
  );
  if (error) throw new Error(`organizations read: ${error.message}`);
  const active = new Set(
    (data ?? [])
      .filter((org) => isSubscriptionActive(org.subscription_status))
      .map((org) => org.id),
  );
  return (orgId) => active.has(orgId);
}

/** Why no work may start for a brand: a demo brand's sample data (00380). */
export const DEMO_BRAND_REASON = 'demo_brand';
/** Why no work may start for a brand: its organization has no active plan. */
export const SUBSCRIPTION_INACTIVE_REASON = 'subscription_inactive';

/**
 * For the ids among `brandIds`, why no work may start for the brand, or null
 * when it may: DEMO_BRAND_REASON for a demo brand (on the cloud or
 * self-hosted), SUBSCRIPTION_INACTIVE_REASON for a brand whose organization
 * has no active or trialing subscription (on the cloud), or that wasn't
 * found. Throws when the brands can't be read.
 *
 * @param {string[]} brandIds
 * @returns {Promise<(brandId: string) => string|null>}
 */
export async function brandStopReasons(brandIds) {
  const ids = uniqueIds(brandIds);
  if (ids.length === 0) return () => SUBSCRIPTION_INACTIVE_REASON;
  const cloud = isCloud();
  const { data, error } = await selectInChunks(ids, (chunk) =>
    supabaseAdmin
      .from('brands')
      .select(cloud ? 'id, is_demo, organizations(subscription_status)' : 'id, is_demo')
      .in('id', chunk),
  );
  if (error) throw new Error(`brands read: ${error.message}`);
  const reasons = new Map(
    (data ?? []).map((brand) => {
      if (brand.is_demo) return [brand.id, DEMO_BRAND_REASON];
      if (cloud && !isSubscriptionActive(brand.organizations?.subscription_status)) {
        return [brand.id, SUBSCRIPTION_INACTIVE_REASON];
      }
      return [brand.id, null];
    }),
  );
  return (brandId) => (reasons.has(brandId) ? reasons.get(brandId) : SUBSCRIPTION_INACTIVE_REASON);
}

/**
 * A test for the ids among `brandIds`: whether the brand is a real one (not
 * a demo brand) whose organization has an active or trialing subscription
 * (any, self-hosted). Throws when the brands can't be read.
 *
 * @param {string[]} brandIds
 * @returns {Promise<(brandId: string) => boolean>}
 */
export async function activeBrandFilter(brandIds) {
  const reasonFor = await brandStopReasons(brandIds);
  return (brandId) => reasonFor(brandId) === null;
}

/**
 * Why no work may start for one brand, or null when it may (brandStopReasons):
 * for a job that starts work for one brand, and says why it didn't.
 *
 * @param {string} brandId
 * @returns {Promise<string|null>}
 */
export async function brandStopReason(brandId) {
  return (await brandStopReasons([brandId]))(brandId);
}

/**
 * Whether one organization has an active or trialing subscription (always,
 * self-hosted): for a route that reads what is kept instead of starting a
 * read that costs.
 *
 * @param {string} orgId
 * @returns {Promise<boolean>}
 */
export async function isOrgActive(orgId) {
  return (await activeOrgFilter([orgId]))(orgId);
}

/**
 * Whether one brand's organization has an active or trialing subscription
 * (always, self-hosted), and the brand isn't a demo brand: for a job, a pass
 * or a callback that starts work for one brand.
 *
 * @param {string} brandId
 * @returns {Promise<boolean>}
 */
export async function isBrandActive(brandId) {
  return (await activeBrandFilter([brandId]))(brandId);
}

/**
 * How long an answer is kept for what outside sites and services send us
 * (the AI-bot ingest, the traffic beacon, Cloro's answers): one read per
 * organization or brand every few minutes, not one per event. A plan that
 * ends now stops storing within these minutes.
 */
export const CACHED_ANSWER_MS = 5 * 60_000;
/**
 * An inactive answer is kept a minute at most: a plan bought now starts
 * storing within it.
 */
export const CACHED_INACTIVE_MS = 60_000;
/** Answers kept at most; the oldest goes first. */
export const MAX_CACHED_ANSWERS = 10_000;

/** `org:<id>` or `brand:<id>` → { until, active: Promise<boolean> } */
const answers = new Map();

/**
 * The kept answer for `key`, or a new read kept for CACHED_ANSWER_MS
 * (CACHED_INACTIVE_MS once it answers inactive). The read itself is kept,
 * so a burst of events waits on one read; a read that fails is dropped, and
 * the next event asks again.
 */
function keptAnswer(key, read, now) {
  const kept = answers.get(key);
  if (kept && kept.until > now) return kept.active;
  answers.delete(key);
  if (answers.size >= MAX_CACHED_ANSWERS) answers.delete(answers.keys().next().value);
  const active = read();
  const entry = { until: now + CACHED_ANSWER_MS, active };
  answers.set(key, entry);
  active.then(
    (isActive) => {
      if (!isActive) entry.until = Math.min(entry.until, now + CACHED_INACTIVE_MS);
    },
    () => {
      if (answers.get(key) === entry) answers.delete(key);
    },
  );
  return active;
}

/**
 * isOrgActive, answered from memory for CACHED_ANSWER_MS (an inactive
 * answer, CACHED_INACTIVE_MS). Self-hosted, always true, without a read.
 *
 * @param {string} orgId
 * @param {{ now?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function isOrgActiveCached(orgId, { now = Date.now() } = {}) {
  if (!isCloud()) return true;
  if (!orgId) return false;
  return keptAnswer(`org:${orgId}`, () => isOrgActive(orgId), now);
}

/**
 * isBrandActive, answered from memory for CACHED_ANSWER_MS (an inactive
 * answer, CACHED_INACTIVE_MS). Self-hosted, always true, without a read.
 *
 * @param {string} brandId
 * @param {{ now?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function isBrandActiveCached(brandId, { now = Date.now() } = {}) {
  if (!isCloud()) return true;
  if (!brandId) return false;
  return keptAnswer(`brand:${brandId}`, () => isBrandActive(brandId), now);
}

// Test hook — what is answered depends on what is kept.
export function clearCachedAnswers() {
  answers.clear();
}
