import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { brandOutsiders, brandReaders } from '../access.js';
import { dispatchBrandWebhook } from '../webhookDispatch.js';
import { computePulseMetrics } from './metrics.js';
import { renderPulseEmail, sendPulseEmail } from './email.js';

/**
 * Daily Pulse orchestration (#540).
 *
 * generatePulseForBrand runs after a brand's daily tracking job finishes.
 * It decides eligibility, computes the digest, records it in sent_pulses
 * (which doubles as the "already sent today" dedup and the 7-day warning
 * cooldown log), then delivers: email via Resend on cloud, and the
 * `daily_pulse.created` webhook event everywhere.
 *
 * Everything is best-effort — a pulse failure must never fail the
 * tracking job that triggered it.
 */

const WEEKLY_SEND_UTC_DAY = 1; // Monday

let warnedAppUrlPath = false;

export function appUrl() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    const url = new URL(raw);
    if (url.pathname !== '/' && url.pathname !== '' && !warnedAppUrlPath) {
      warnedAppUrlPath = true;
      logger.warn(
        { PUBLIC_APP_URL: raw },
        '[pulse] PUBLIC_APP_URL includes a path; using the origin only. Set it to the bare origin (e.g. https://app.example.com) to silence this warning.',
      );
    }
    return url.origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

/** The sign-in e-mail of each of `ids` that has one. */
async function emailsOf(ids) {
  const emails = [];
  for (const id of ids) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(id);
    if (authUser?.user?.email) emails.push(authUser.user.email);
  }
  return emails;
}

const sameAddress = (address) => String(address).trim().toLowerCase();

/**
 * Recipient emails (brand access, spec §5.4): the explicit list from
 * settings, as an Admin or Manager set it, less the members who can't see
 * the brand, so a list made before someone was narrowed doesn't mail them
 * its numbers; an address that is no member's (a client, team@) stays.
 * Else every member who can see the brand: with All brands, every member.
 * The AI Traffic weekly digest (AT-013) sends to the same people.
 */
export async function resolveRecipients(organizationId, settings, brandId) {
  if (settings?.recipients?.length) {
    const outsiders = await brandOutsiders(organizationId, brandId);
    if (outsiders.length === 0) return settings.recipients;
    const hidden = new Set((await emailsOf(outsiders)).map(sameAddress));
    return settings.recipients.filter((address) => !hidden.has(sameAddress(address)));
  }

  const readers = await brandReaders(organizationId, [brandId]);
  return emailsOf([...readers.keys()]);
}

// In webhook mode the tracking job can "complete" while Cloro is still
// delivering results (the worker's drain loop gives up after 10 minutes
// without progress, but Cloro's real latency is 30-80 minutes) — a pulse
// computed at that moment emails partial-window numbers that contradict the
// dashboard. Wait for the brand's pending-task queue to drain first; the
// cap only exists so an orphaned task row can't block the pulse forever
// (cleanupStalePendingTasks sweeps those after 2h).
const DRAIN_POLL_MS = 60_000;
const DRAIN_MAX_WAIT_MS = 90 * 60_000;
// Tasks older than this are ghosts: Cloro accepted them and never called back
// (google-aio does this routinely when a query has no AI Overview). Waiting on
// them is pure cost — they are already past any plausible delivery latency and
// cleanupStalePendingTasks removes them on the next cycle. Counting them kept
// every brand parked for the full 90-minute cap, which also synchronised the
// wake-ups: whole waves of brands started computing metrics in the same second
// and the heaviest one hit the database statement timeout and lost its pulse.
const GHOST_TASK_AGE_MS = 45 * 60_000;

async function waitForCloroDrain(brandId) {
  const deadline = Date.now() + DRAIN_MAX_WAIT_MS;
  for (;;) {
    const freshSince = new Date(Date.now() - GHOST_TASK_AGE_MS).toISOString();
    const { count, error } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('task_id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('submitted_at', freshSince);
    // A failed read must not be mistaken for "nothing pending" — retry on the
    // next tick rather than computing the pulse on a half-delivered window.
    if (error) {
      logger.warn({ err: error, brandId }, 'pulse drain poll failed, retrying');
    } else if (!count) {
      return true;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        { brandId, pending: count },
        'pulse proceeding although cloro tasks are still pending',
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
  }
}

/**
 * The dedupe key for a computed digest: the end of the window it describes
 * (#701).
 *
 * `pulse_date` alone cannot express "these two mails say the same thing".
 * The daily KPI window is anchored to the tracking-run ledger, so two pulses
 * fired on different calendar days repeat each other verbatim whenever the
 * anchor has not moved between them — which is exactly what happened when the
 * catch-up sweep recovered a missed day at the start of a cycle and the
 * brand's own run pulsed an hour later, and again on every following day for a
 * brand whose runs had stopped stamping.
 *
 * Returns null for windows that are not run-anchored (weekly digests, and
 * brands with no completed run yet). Their `to` is the wall clock, which is
 * different on every call and would make this check a no-op anyway — better to
 * say so than to compare values that can never match.
 */
export function pulseWindowKey(metrics) {
  const window = metrics?.window;
  if (!window?.runAnchored) return null;
  return window.to ?? null;
}

/** Warning keys already sent for this brand in the last 7 days. */
async function recentWarningKeys(brandId, now) {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from('sent_pulses')
    .select('warning_keys')
    .eq('brand_id', brandId)
    .gte('created_at', since);
  const keys = new Set();
  for (const row of data ?? []) {
    for (const key of row.warning_keys ?? []) keys.add(key);
  }
  return keys;
}

export async function generatePulseForBrand(brandId, { pulseDate: pulseDateOverride } = {}) {
  try {
    const now = new Date();
    // The catch-up sweep passes the missed run's completion date so a
    // recovered pulse claims THAT day's dedupe slot — today's real pulse
    // (fired when today's run completes) keeps its own date.
    const pulseDate = pulseDateOverride ?? now.toISOString().slice(0, 10);

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id, name, organization_id, is_active, is_demo')
      .eq('id', brandId)
      .single();
    if (!brand?.is_active) return { skipped: 'brand_inactive' };
    // A demo brand (00380) is sample data: nobody is mailed about it.
    if (brand.is_demo) return { skipped: 'demo_brand' };

    // Hard requirement: never generate for orgs without an active or
    // trialing subscription (self-host always passes — isSubscriptionActive
    // short-circuits when not cloud).
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('subscription_status')
      .eq('id', brand.organization_id)
      .single();
    if (!isSubscriptionActive(org?.subscription_status)) {
      return { skipped: 'subscription_inactive' };
    }

    const { data: settings } = await supabaseAdmin
      .from('pulse_settings')
      .select('frequency, recipients')
      .eq('brand_id', brandId)
      .maybeSingle();
    const frequency = settings?.frequency ?? 'daily';

    if (frequency === 'off') return { skipped: 'off' };
    if (frequency === 'weekly' && now.getUTCDay() !== WEEKLY_SEND_UTC_DAY) {
      return { skipped: 'not_weekly_day' };
    }

    // Dedup: at most one pulse per brand per day.
    const { data: existing } = await supabaseAdmin
      .from('sent_pulses')
      .select('id')
      .eq('brand_id', brandId)
      .eq('pulse_date', pulseDate)
      .maybeSingle();
    if (existing) return { skipped: 'already_sent' };

    // Don't compute until this brand's Cloro results have actually landed —
    // the numbers must match what the dashboard will show for the same
    // window (see waitForCloroDrain).
    await waitForCloroDrain(brandId);

    const windowDays = frequency === 'weekly' ? 7 : 1;
    const metrics = await computePulseMetrics(brandId, { windowDays, now: new Date() });

    // Skip brands with no fresh tracking results in the window.
    if (metrics.kpis.totalResults === 0) return { skipped: 'no_fresh_results' };

    // Never mail the same window twice, whichever path fired (#701). The
    // pulse_date slot claimed above cannot see this: a recovery pulse dated to
    // the missed day and today's own pulse hold different dates while
    // describing the identical tracking run.
    const windowKey = pulseWindowKey(metrics);
    if (windowKey) {
      const { data: samePulse, error: sameErr } = await supabaseAdmin
        .from('sent_pulses')
        .select('id, pulse_date')
        .eq('brand_id', brandId)
        .eq('payload->window->>to', windowKey)
        .limit(1)
        .maybeSingle();
      // A failed read must not suppress a pulse — the insert below still has
      // the unique index as the final guard.
      if (sameErr) {
        logger.warn({ err: sameErr, brandId, windowKey }, 'pulse window lookup failed');
      } else if (samePulse) {
        logger.info(
          { brandId, windowKey, alreadySentFor: samePulse.pulse_date },
          'skipping daily pulse — this window was already sent',
        );
        return { skipped: 'window_already_sent' };
      }
    }

    // Warning cooldown: don't repeat the same warning for the same subject
    // within 7 days.
    const cooldown = await recentWarningKeys(brandId, now);
    metrics.warnings = metrics.warnings.filter((w) => !cooldown.has(w.key));

    if (frequency === 'notable' && !metrics.highlights.length && !metrics.warnings.length) {
      return { skipped: 'nothing_notable' };
    }

    // Read before the claim: a read that fails (a brief 503) then leaves no
    // claim, and the catch-up sweep sends the pulse later, webhook included.
    const recipients = isCloud()
      ? await resolveRecipients(brand.organization_id, settings, brand.id)
      : [];

    // Record first — the unique (brand_id, pulse_date) constraint makes
    // this the race-safe claim on "today's pulse".
    const { data: pulseRow, error: insertError } = await supabaseAdmin
      .from('sent_pulses')
      .insert({
        brand_id: brandId,
        pulse_date: pulseDate,
        frequency,
        payload: metrics,
        warning_keys: metrics.warnings.map((w) => w.key),
      })
      .select('id')
      .single();
    if (insertError) {
      // 23505 = another worker claimed this pulse between our checks and the
      // insert — either today's date slot or, via the window index, the same
      // tracking window under a different date.
      if (insertError.code === '23505') return { skipped: 'already_sent' };
      throw new Error(insertError.message);
    }

    const insightsUrl = `${appUrl()}/dashboard/insights`;
    const settingsUrl = `${appUrl()}/dashboard/settings?tab=notifications`;

    // Email leg — cloud only.
    let emailSent = false;
    let recipientCount = 0;
    if (isCloud()) {
      recipientCount = recipients.length;
      if (recipients.length) {
        const { subject, html } = renderPulseEmail({
          brandName: brand.name,
          metrics,
          insightsUrl,
          settingsUrl,
        });
        emailSent = await sendPulseEmail({ to: recipients, subject, html, settingsUrl });
      }
    }

    // Webhook leg — cloud and self-host alike.
    const { sent } = await dispatchBrandWebhook(brandId, {
      event: 'daily_pulse.created',
      brand: { id: brand.id, name: brand.name },
      pulse: {
        date: pulseDate,
        frequency,
        kpis: metrics.kpis,
        highlights: metrics.highlights,
        warnings: metrics.warnings,
        degraded_platforms: metrics.degradedPlatforms,
        insights_url: insightsUrl,
      },
    });

    await supabaseAdmin
      .from('sent_pulses')
      .update({
        email_sent: emailSent,
        email_recipient_count: emailSent ? recipientCount : 0,
        webhook_sent: sent > 0,
      })
      .eq('id', pulseRow.id);

    logger.info(
      { brandId, pulseDate, frequency, emailSent, recipientCount, webhooksSent: sent },
      'daily pulse generated',
    );
    return { generated: true, emailSent, webhooksSent: sent };
  } catch (err) {
    logger.error({ err, brandId }, 'daily pulse generation failed');
    return { error: true };
  }
}

/**
 * Catch-up sweep (#missed-pulse incident): the per-brand pulse trigger is
 * fire-and-forget at the end of a tracking job — a process death, deploy, or
 * OOM in that window silently eats the mail while the run's stamp survives.
 * This sweep runs at the start of the daily cycle: any brand whose latest
 * completed run (last 36h) has no pulse row created after it gets a recovery
 * pulse, dated to that run's completion day so today's real pulse keeps its
 * own dedupe slot.
 *
 * Two guards keep that from turning into a duplicate mail: the sent_pulses
 * (brand_id, pulse_date) key stops the same day being sent twice, and the
 * window key (#701) stops the recovery pulse repeating a run that today's own
 * pulse is about to report — the two dates disagree, the data does not.
 *
 * Cron runs only: the pulse trigger never fires for manual/immediate runs, so
 * those are not "missed" pulses to recover. Sweeping them mailed every new
 * brand twice on its first morning — once at cycle start for yesterday's
 * onboarding run, once when its own daily run completed an hour later.
 */
export async function runPulseCatchUp() {
  try {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const { data: runs, error } = await supabaseAdmin
      .from('tracking_runs')
      .select('brand_id, completed_at')
      .eq('source', 'cron')
      .not('completed_at', 'is', null)
      .gte('completed_at', since)
      .order('completed_at', { ascending: false });
    if (error) throw new Error(error.message);

    const latestByBrand = new Map();
    for (const r of runs || []) {
      if (!latestByBrand.has(r.brand_id)) latestByBrand.set(r.brand_id, r.completed_at);
    }

    let sent = 0;
    let skipped = 0;
    for (const [brandId, completedAt] of latestByBrand) {
      const { count, error: countErr } = await supabaseAdmin
        .from('sent_pulses')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('created_at', completedAt);
      if (countErr || (count ?? 0) > 0) continue; // run already pulsed (or unknowable)

      const result = await generatePulseForBrand(brandId, {
        pulseDate: completedAt.slice(0, 10),
      });
      if (result?.generated) {
        logger.info({ brandId, runCompletedAt: completedAt }, '[pulse] catch-up pulse sent');
        sent++;
      } else {
        skipped++;
      }
    }

    if (sent > 0 || skipped > 0) {
      logger.info({ sent, skipped }, '[pulse] catch-up sweep completed');
    }
    return { sent, skipped };
  } catch (err) {
    logger.error({ err }, '[pulse] catch-up sweep failed');
    return { error: true };
  }
}
