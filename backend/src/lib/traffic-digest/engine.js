import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { readAllRpcRows } from '../rpcPages.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { appUrl, resolveRecipients } from '../pulse/engine.js';
import { untrackedGoogleQueries } from '../untrackedQueries.js';
import {
  brokenCandidates,
  dailyVisits,
  digestWeek,
  formatShare,
  pageCandidates,
  summarySentences,
  topChanges,
  topPlatforms,
  visitChangePct,
} from './summary.js';
import { renderTrafficDigestEmail, sendTrafficDigestEmail } from './email.js';

/**
 * The AI Traffic weekly digest (AT-013, spec §3.8): every Monday, for the
 * week before, "the summary line and the top three changes" to the Daily
 * Pulse's recipients (00036), unless Settings › Notifications turned it off
 * for the brand (00187) or the brand's pulse is off.
 *
 * A brand with no AI visits in either week gets nothing. A week is claimed in
 * ai_traffic_digests before anything is sent, so two sweeps can't mail it
 * twice, and marked sent (sent_at) just before the e-mail goes, so a stop
 * after the send can't leave a claim a later sweep takes over and sends
 * again. The sweep runs Monday to Wednesday: a week a failure left unsent (a
 * read that kept failing, an e-mail Resend refused, a restart between the
 * claim and the send) is tried again the next day, and one already sent is
 * skipped. An e-mail Resend gave no answer for may have gone out, so its
 * week isn't sent again: Resend's idempotency keys don't last to the next
 * day. Cloud only, like the pulse's e-mail. Best effort: one brand's failure
 * is logged and the sweep moves on.
 */

/** Monday, as the weekly pulse; then Tuesday and Wednesday for a week left unsent. */
const SEND_UTC_DAYS = [1, 2, 3];

/** A claim this old without a send was left by a sweep that stopped; it's taken over. */
const STALE_CLAIM_MS = 60 * 60 * 1000;

/** A read is tried this many times before the brand's week waits for the next sweep. */
const READ_ATTEMPTS = 3;

/** Broken AI links read for the week's line, as the nightly signal reads them. */
const BROKEN_LINKS_READ = 50;

async function withRetries(read, waitMs) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (err) {
      if (attempt >= READ_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs * attempt));
    }
  }
}

/** Writes to the week's row, tried again as the reads are; throws when it still fails. */
function updateDigest(id, patch, waitMs) {
  return withRetries(async () => {
    const { error } = await supabaseAdmin.from('ai_traffic_digests').update(patch).eq('id', id);
    if (error) throw new Error(`ai_traffic_digests: ${error.message}`);
  }, waitMs);
}

async function rpc(name, params) {
  const { data, error } = await supabaseAdmin.rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/** The last second of the week: the reads that take an inclusive end stop on its Sunday. */
const lastSecond = (end) => new Date(Date.parse(end) - 1000).toISOString();

/**
 * The numbers behind one brand's digest, read as the AI Traffic page reads
 * them for a 7-day range.
 */
export async function readDigestData(brandId, week) {
  // To each week's last second, inclusive: ai_traffic_merged keeps Analytics
  // rows through p_to's day (00176), so a midnight end would count the
  // Monday between the weeks in both.
  const merged = (from, to) =>
    rpc('ai_traffic_merged', {
      p_brand_id: brandId,
      p_from: from,
      p_to: lastSecond(to),
      p_to_inclusive: true,
      p_analytics: true,
    });
  const [cur, prev] = await Promise.all([
    merged(week.start, week.end),
    merged(week.prevStart, week.start),
  ]);
  const data = { cur: cur ?? {}, prev: prev ?? {} };
  if ((Number(data.cur.visits) || 0) + (Number(data.prev.visits) || 0) === 0) return data;

  const until = lastSecond(week.end);
  const [totals, pages, broken, untracked] = await Promise.all([
    supabaseAdmin
      .rpc('ga_traffic_totals', {
        p_brand_id: brandId,
        p_since: week.firstDay,
        p_until: week.lastDay,
      })
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (error) throw new Error(`ga_traffic_totals: ${error.message}`);
        return row;
      }),
    rpc('ai_traffic_pages', {
      p_brand_id: brandId,
      p_from: week.start,
      p_to: until,
      p_tab: 'cited_not_clicked',
      p_limit: 0,
      p_offset: 0,
    }),
    // As many as the broken_citation_target signal reads: the line counts
    // only those it would raise (cited, or brokenLinkMinVisits), and the
    // most visited come first.
    rpc('ai_traffic_broken_links', {
      p_brand_id: brandId,
      p_from: week.start,
      p_to: until,
      p_limit: BROKEN_LINKS_READ,
      p_offset: 0,
    }),
    untrackedGoogleQueries(brandId, {
      since: week.firstDay,
      until: week.lastDay,
      latest: true,
      limit: 0,
    }),
  ]);
  // The pages the changes could name, and the broken link with its redirect,
  // checked against sources the public beacon can't write (00194).
  const candidates = [...new Set([...pageCandidates(data), ...brokenCandidates(broken)])].sort();
  // Share and conversions only from a connected Analytics (§3.8b rule 5).
  const gaSessions = (Number(totals?.sessions) || 0) > 0 ? Number(totals.sessions) : null;
  const [knownPages, platformValue] = await Promise.all([
    candidates.length === 0
      ? []
      : rpc('ai_traffic_known_pages', { p_brand_id: brandId, p_pages: candidates }),
    gaSessions === null
      ? null
      : rpc('ga_platform_value', {
          p_brand_id: brandId,
          p_since: week.firstDay,
          p_until: week.lastDay,
        }),
  ]);
  return {
    ...data,
    gaSessions,
    platformValue: platformValue ?? null,
    citedNotClicked: Number(pages?.counts?.cited_not_clicked) || 0,
    broken: broken ?? null,
    untrackedQueries: untracked?.count ?? 0,
    knownPages: new Set(Array.isArray(knownPages) ? knownPages : []),
  };
}

/** What the e-mail says and shows, from the numbers. */
export function digestContent(data, week) {
  const visits = Number(data.cur.visits) || 0;
  const prevVisits = Number(data.prev.visits) || 0;
  const platforms = topPlatforms(data.cur.platforms ?? []);
  return {
    visits,
    prevVisits,
    change: visitChangePct(visits, prevVisits),
    // The cards and charts (the summary line says the same in words).
    share: data.gaSessions ? formatShare(visits, data.gaSessions) : null,
    citedNotClicked: data.citedNotClicked ?? 0,
    platforms,
    days: dailyVisits(week, data.cur.days ?? []),
    sentences: summarySentences({
      visits,
      prevVisits,
      platforms: data.cur.platforms ?? [],
      gaSessions: data.gaSessions ?? null,
      platformValue: data.platformValue ?? null,
      citedNotClicked: data.citedNotClicked ?? 0,
      untrackedQueries: data.untrackedQueries ?? 0,
    }),
    changes: topChanges(data),
  };
}

/**
 * One brand's digest for the week before `now`'s.
 *
 * @returns {Promise<object>} what happened: `{ sent, emailSent, recipients }` or `{ skipped }`
 */
export async function sendTrafficDigestForBrand(
  brandId,
  { now = new Date(), retryWaitMs = 2000 } = {},
) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, organization_id, is_active')
    .eq('id', brandId)
    .single();
  if (!brand?.is_active) return { skipped: 'brand_inactive' };

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status')
    .eq('id', brand.organization_id)
    .single();
  if (!isSubscriptionActive(org?.subscription_status)) return { skipped: 'subscription_inactive' };

  const { data: settings } = await supabaseAdmin
    .from('pulse_settings')
    .select('recipients, traffic_digest, frequency')
    .eq('brand_id', brandId)
    .maybeSingle();
  // On by default, but not where the brand's pulse is off. No settings row: on.
  if (settings?.traffic_digest === false || settings?.frequency === 'off') {
    return { skipped: 'off' };
  }

  const week = digestWeek(now);
  const { data: existing } = await supabaseAdmin
    .from('ai_traffic_digests')
    .select('id, sent_at, created_at')
    .eq('brand_id', brandId)
    .eq('week_start', week.firstDay)
    .maybeSingle();
  if (existing?.sent_at) return { skipped: 'already_sent' };
  if (existing) {
    if (now.getTime() - Date.parse(existing.created_at) < STALE_CLAIM_MS) {
      return { skipped: 'in_progress' };
    }
    // Claimed by a sweep that stopped before sending (a deploy, a restart).
    await releaseClaim(existing.id);
  }

  const data = await withRetries(() => readDigestData(brandId, week), retryWaitMs);
  const content = digestContent(data, week);
  if (content.visits === 0 && content.prevVisits === 0) return { skipped: 'no_traffic' };

  // Claim the week first: the unique (brand_id, week_start) is the race-safe
  // guard against a second sweep.
  const { data: row, error: claimError } = await supabaseAdmin
    .from('ai_traffic_digests')
    .insert({ brand_id: brandId, week_start: week.firstDay, payload: { week, ...content } })
    .select('id')
    .single();
  if (claimError) {
    if (claimError.code === '23505') return { skipped: 'already_sent' };
    throw new Error(claimError.message);
  }

  let recipients;
  // Nothing to send to, or Resend isn't set up: the week is done all the same.
  let outcome = 'skipped';
  try {
    recipients = await resolveRecipients(brand.organization_id, settings, brandId);
    if (recipients.length) {
      const settingsUrl = `${appUrl()}/dashboard/settings?tab=notifications`;
      const { subject, html } = renderTrafficDigestEmail({
        brandName: brand.name,
        week,
        ...content,
        trafficUrl: `${appUrl()}/dashboard/traffic`,
        settingsUrl,
      });
      // Marked sent before it goes. When this fails, nothing went out.
      await updateDigest(row.id, { sent_at: new Date().toISOString() }, retryWaitMs);
      outcome = await sendTrafficDigestEmail({ to: recipients, subject, html, settingsUrl });
      // Resend answered with an error: nothing went out.
      if (outcome === 'refused') throw new Error('Resend refused the digest');
    }
  } catch (err) {
    // Give the week back, so the next sweep (through Wednesday) tries again.
    await releaseClaim(row.id);
    throw err;
  }
  if (outcome === 'unknown') {
    logger.warn(
      { brandId, week: week.firstDay },
      '[traffic-digest] no answer from Resend; the week is not sent again',
    );
  }
  const emailSent = outcome === 'sent';
  try {
    await updateDigest(
      row.id,
      {
        email_sent: emailSent,
        email_recipient_count: emailSent ? recipients.length : 0,
        sent_at: new Date().toISOString(),
      },
      retryWaitMs,
    );
  } catch (err) {
    // The claim stays, marked sent before the e-mail went (or with nothing to
    // send): only the record of what went out is missing.
    logger.error(
      { err, brandId, week: week.firstDay },
      '[traffic-digest] recording the send failed',
    );
  }

  logger.info(
    { brandId, week: week.firstDay, emailSent, recipients: recipients.length },
    '[traffic-digest] sent',
  );
  return { sent: true, emailSent, recipients: recipients.length };
}

/** Take back a claim, so a later sweep sends the week. */
async function releaseClaim(id) {
  const { error } = await supabaseAdmin.from('ai_traffic_digests').delete().eq('id', id);
  if (error) logger.warn({ err: error, id }, '[traffic-digest] claim release failed');
}

/**
 * The sweep, Monday to Wednesday: every active brand's digest for the week
 * before that isn't sent yet. Called from the daily cycle after the
 * Analytics sync, so Sunday's numbers are in.
 */
export async function sendTrafficDigests({ now = new Date() } = {}) {
  if (!isCloud()) return { skipped: 'self_hosted' };
  if (!SEND_UTC_DAYS.includes(now.getUTCDay())) return { skipped: 'not_send_day' };

  // Read past PostgREST's 1000-row page.
  const { data: brands, error } = await readAllRpcRows('brands', (from, to) =>
    supabaseAdmin
      .from('brands')
      .select('id')
      .eq('is_active', true)
      // A demo brand (00380) is sample data: nobody is mailed about it.
      .eq('is_demo', false)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (error) throw new Error(error.message);

  let sent = 0;
  // A slice boundary can repeat a row (rpcPages.js).
  for (const id of new Set((brands ?? []).map((b) => b.id))) {
    try {
      const result = await sendTrafficDigestForBrand(id, { now });
      if (result.sent) sent += 1;
    } catch (err) {
      logger.error({ err, brandId: id }, '[traffic-digest] brand failed');
    }
  }
  logger.info({ sent, brands: (brands ?? []).length }, '[traffic-digest] weekly sweep done');
  return { sent };
}
