/**
 * Tracking job processor.
 * Fetches brand data, runs prompts through AI models / scrapers, stores results.
 */

import { runPrompt, analyzeSentimentAI } from '../lib/aiTracker.js';
import { isLegacyChatgptTask, pollScraperResult, submitPromptTask } from '../lib/cloroScraper.js';
import { chatgptFanoutDue, chatgptFanoutMode } from '../lib/chatgptFanout.js';
import { parseResponse, countBrandMentions } from '../lib/responseParser.js';
import supabaseAdmin from '../config/supabase.js';
import { hasFeature, getPlan, isCloud } from '../config/plans.js';
import { applyPlanOverrides } from '../lib/planGuard.js';
import { generateContentOpportunities } from '../lib/opportunityGenerator.js';
import { refreshPromptClusters } from '../lib/promptClusters.js';
import { refreshSitePages } from '../lib/sitePages.js';
import { updateTargetUrlStats } from '../lib/targetUrlStats.js';
import { persistCitationRows } from '../lib/citationRows.js';
import { isUnknownCity, locationsForModels, locationsForScraper } from '../lib/locations.js';
import { loadSupportedCountries, supportedLocations } from '../lib/cloroCountries.js';
import { settleTrackingRun } from '../lib/runSettlement.js';
import { FIRST_RUN_LATE_POLL_MS, isFirstRun, progressiveRollups } from '../lib/firstRunRollups.js';
import logger from '../lib/logger.js';

function resolveModelPlatform(model) {
  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gemini-')) return 'gemini';
  return 'chatgpt';
}

/**
 * Platforms Cloro cannot currently deliver, dropped before anything is
 * submitted.
 *
 * Grok started answering every task with a 500 on 2026-08-18. Leaving it in
 * the run would submit a paid task per prompt per region, hold the drain open
 * waiting for results that never arrive, and record nothing — so the platform
 * is removed up front rather than failing task by task.
 *
 * Deliberately a run-time filter and nothing else. Dropping Grok from the
 * engine picker would also drop it from `ALL_SCRAPERS`, which
 * `filterByPlan` and `alignPromptsToPlanForOrg` use as the allow-set when
 * writing prompts — so every prompt edit and every plan change would quietly
 * strip the stored id, and restoring Grok would need a data repair rather
 * than a revert. Empty this list when Cloro reports Grok healthy again and
 * every prompt that still lists it resumes on the next run.
 */
export const UNAVAILABLE_PLATFORMS = ['grok-web'];

/**
 * The platforms a prompt should actually be run against.
 *
 * Prompts keep whatever platform ids they were saved with, so the stored array
 * cannot be trusted at run time: a brand may have turned Shopping off since,
 * and a platform may be down. Both are filtered here rather than at the picker,
 * because every id that survives becomes a paid Cloro submission.
 */
export function runnablePlatforms(platforms, { shoppingEnabled } = {}) {
  return (platforms ?? []).filter(
    (platform) =>
      !UNAVAILABLE_PLATFORMS.includes(platform) &&
      (shoppingEnabled || platform !== 'chatgpt-shopping'),
  );
}

/**
 * Whether ChatGPT Shopping is run for a brand: its Shopping mode is on, and
 * its plan has the Shopping page (`shopping_analytics`) that shows the
 * results. On a plan without it, every ChatGPT Shopping task would be a paid
 * Cloro submission nobody can see. `plan` is null on self-host, where every
 * feature is on.
 */
export function shoppingTracked(brand, plan) {
  return Boolean(brand?.shopping_mode_enabled) && (!plan || hasFeature(plan, 'shopping_analytics'));
}

/**
 * PostgREST silently caps an un-paginated select at 1000 rows, so reading a
 * brand's pending tasks in one request under-reports any run that submitted
 * more than that (#714). Page through instead.
 *
 * Exported for the test that pins the paging behaviour; `fetchPage(offset)`
 * resolves to `{ data, error }` exactly as a PostgREST range query does.
 */
export const PENDING_PAGE_SIZE = 1000;

export async function fetchAllPendingRows(fetchPage, pageSize = PENDING_PAGE_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset);
    // A partial read is worse than no read: it looks like progress that never
    // happened. Surface the error and let the caller retry the whole poll.
    if (error) return { rows: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
  }
}

/**
 * Which drain time budget, if any, has run out (#702).
 *
 * Two budgets rather than one cap measured from submission. Before anything
 * has come back there is nothing to reason about — the stall and ghost exits
 * both compare successive pending counts — so that phase gets its own, longer
 * allowance. Once delivery starts, the tail is measured from the first result,
 * so a slow queue start no longer consumes the time the tail needs.
 *
 * Returns 'no_first_result', 'tail_deadline', or null while within budget.
 */
export function drainBudgetExceeded({
  now,
  drainStartedAt,
  firstResultAt,
  firstResultWaitMs,
  drainTailMs,
}) {
  if (firstResultAt === null || firstResultAt === undefined) {
    return now - drainStartedAt >= firstResultWaitMs ? 'no_first_result' : null;
  }
  return now - firstResultAt >= drainTailMs ? 'tail_deadline' : null;
}

/**
 * True when every still-pending task was submitted longer ago than `maxAgeMs`.
 *
 * Such tasks can no longer be in flight: Cloro accepted them and never called
 * back (google-aio does this whenever a query has no AI Overview). Combined
 * with "no new result for a while", this is what separates a ghost tail from
 * a normal quiet gap mid-burst, where fresh tasks are still outstanding.
 *
 * Deliberately false for an empty list — no pending tasks is a completed
 * drain, handled by the caller before this is consulted.
 */
export function allTasksAreStale(rows, maxAgeMs, now = Date.now()) {
  if (!rows || rows.length === 0) return false;
  const cutoff = now - maxAgeMs;
  return rows.every((r) => r.submitted_at && new Date(r.submitted_at).getTime() < cutoff);
}

/**
 * How many outstanding tasks count as a negligible tail for a run of this size.
 *
 * A floor of 3 rather than a pure percentage, because the fraction alone is
 * useless on a small run: a single-prompt refresh submits about seven tasks,
 * and 5% of that rounds to one, so one ghost would still hold the run open.
 */
export function tailRemainder(expected) {
  return Math.max(3, Math.ceil(expected * 0.05));
}

/**
 * True when an interactive run should stop waiting on the tasks it has left.
 *
 * Interactive runs are watched: a progress bar sits on the Insights page for
 * as long as this loop polls. The ghost thresholds are sized for the slowest
 * brand, where delivery can start an hour after submission, and applying them
 * to a run that finished in four minutes left the bar frozen a couple of tasks
 * short of the total for another twenty-five — reliably, because google-aio
 * accepts a task and never calls back whenever the query has no AI Overview.
 *
 * Leaving early costs the run nothing but an undercounted `result_count`:
 * /cloro/callback matches a late delivery by task id and inserts the result
 * whether or not this loop is still watching for it.
 *
 * Cron runs have no audience and keep the patient thresholds, so a quiet gap
 * mid-burst can never cost them results.
 */
export function interactiveTailExhausted({ pending, expected, quietPolls, quietPollLimit }) {
  if (pending <= 0 || expected <= 0) return false;
  return pending <= tailRemainder(expected) && quietPolls >= quietPollLimit;
}

/**
 * Whether a run's ChatGPT tasks may ask for their fan-out at all: only the
 * nightly run's first attempt. A manual run, a new prompt's first run, a
 * retry or a recovered run would ask again on a day the prompt may already
 * have paid +2 credits for it.
 */
export function runAsksChatgptFanout({ source, attempt }) {
  return source === 'cron' && attempt === 1;
}

/**
 * A run's scraper tasks: one per prompt × engine × location that engine can
 * run. `region` carries the full location code — it is what gets stamped on
 * the result row, so a Google run collapsed to its country is recorded as the
 * country it actually ran in, not the state that was asked for.
 *
 * `chatgptFanout` is `{ mode, date }` when the run may ask (see
 * runAsksChatgptFanout), else null. A prompt's ChatGPT tasks then ask on its
 * day of the week (chatgptFanout.js), every location's alike.
 */
export function scraperTasksFor(prompts, { platformsFor, locationsFor, chatgptFanout }) {
  const tasks = [];
  for (const prompt of prompts) {
    for (const scraperId of platformsFor(prompt)) {
      const legacy =
        chatgptFanout != null &&
        scraperId === 'chatgpt-web' &&
        chatgptFanoutDue(prompt.id, chatgptFanout.date, chatgptFanout.mode);
      for (const region of locationsFor(prompt, scraperId)) {
        tasks.push({ prompt, scraperId, region, legacy });
      }
    }
  }
  return tasks;
}

/**
 * Poll one of a run's tasks (polling mode). A legacy ChatGPT task that Cloro
 * took and then failed goes once more without legacy and is polled in its
 * place, so the day keeps its answer; the webhook path does the same in
 * routes/cloroCallback.js. `legacy` is the submission's own record, as
 * polling has no pending row.
 */
export async function pollTrackingTask({ taskId, scraperId, legacy, meta }) {
  try {
    return await pollScraperResult(taskId, scraperId);
  } catch (err) {
    if (!(err?.taskFailed && isLegacyChatgptTask({ scraperId, legacy }))) throw err;
    logger.warn(
      { err, taskId, scraperId, promptId: meta.prompt.id },
      'chatgpt fan-out task failed at cloro; submitting it again without fan-out',
    );
    const again = await submitPromptTask({
      promptText: meta.prompt.text,
      promptId: meta.prompt.id,
      scraperId,
      region: meta.region,
    });
    return pollScraperResult(again.taskId, scraperId);
  }
}

/**
 * Core logic: fetch prompts, run them through specified models, store results.
 * `attempt` is the job's attempt number (1 on its first run).
 * @param {{ brandId: string, promptId?: string, promptIds?: string[], source?: string, attempt?: number, job?: { progress: function, signal?: AbortSignal } }} opts
 */
export async function processTrackingJob({ brandId, promptId, promptIds, source, attempt, job }) {
  // 1. Fetch brand info with domains
  const { data: brand, error: brandErr } = await supabaseAdmin
    .from('brands')
    // `state` is deliberately not read: it is the default location offered
    // when new prompts are created, not a tracking-time override (#691).
    .select('id, name, organization_id, shopping_mode_enabled')
    .eq('id', brandId)
    .single();
  if (brandErr || !brand) throw new Error(`Brand not found: ${brandId}`);

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);

  const brandInfo = {
    brandName: brand.name,
    domains: (domains || []).map((d) => d.domain),
  };

  // 2. Fetch active prompts
  const { data: promptSets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (!promptSets || promptSets.length === 0) {
    logger.info({ brandId }, 'no prompt sets for brand');
    return { resultCount: 0 };
  }

  const setIds = promptSets.map((s) => s.id);

  let promptsQuery = supabaseAdmin
    .from('prompts')
    .select('*')
    .in('prompt_set_id', setIds)
    .eq('is_active', true);

  if (promptId) {
    promptsQuery = promptsQuery.eq('id', promptId);
  } else if (promptIds && promptIds.length > 0) {
    promptsQuery = promptsQuery.in('id', promptIds);
  }

  const { data: prompts, error: promptErr } = await promptsQuery;
  if (promptErr) throw new Error(`Failed to fetch prompts: ${promptErr.message}`);
  if (!prompts || prompts.length === 0) {
    logger.info({ brandId }, 'no active prompts for brand');
    return { resultCount: 0 };
  }

  // Tracking-run ledger (00044): FULL runs stamp a row so the insights 24h
  // view can anchor to the last COMPLETED run instead of a wall-clock window
  // that empties and refills every morning. Single/subset-prompt runs must
  // NOT stamp — a completed single-prompt "run" would swing the dashboard
  // window onto one prompt's worth of data.
  //
  // By the time this function returns, this run's scraper results are already
  // inserted (webhook mode drains its own submitted task_ids above; polling
  // mode is inline), so completion is stamped at the end of this function —
  // no webhook-side bookkeeping needed. The stall/deadline caps in the drain
  // loop bound how long a stuck Cloro queue can delay the stamp.
  const isFullRun = !promptId && (!promptIds || promptIds.length === 0);
  let trackingRunId = null;
  let trackingRunStartedAt = null;
  // A brand's first full run (no run of it ever stamped) fills the rollups as
  // its answers land, and checks for its stamp more often
  // (firstRunRollups.js). Read before this run's own row exists. Not the
  // job's `afterPayment`, which only orders the queue: a new brand's first
  // run need not follow a payment.
  const firstRun = isFullRun && (await isFirstRun(brandId));
  if (isFullRun) {
    // A run that died mid-flight (crash, abort) leaves an uncompleted row;
    // clear those so at most one in-progress row exists per brand.
    await supabaseAdmin
      .from('tracking_runs')
      .delete()
      .eq('brand_id', brandId)
      .is('completed_at', null);

    const { data: runRow, error: runErr } = await supabaseAdmin
      .from('tracking_runs')
      .insert({ brand_id: brandId, source: source || 'manual' })
      .select('id, started_at')
      .single();
    if (runErr) {
      // Ledger failure must never block tracking itself.
      logger.warn({ err: runErr, brandId }, 'failed to create tracking_runs row');
    } else {
      trackingRunId = runRow.id;
      trackingRunStartedAt = runRow.started_at;
    }
  }

  // 3. Fetch competitors for this brand
  const { data: competitorRows } = await supabaseAdmin
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  const competitors = (competitorRows || []).map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain || '',
  }));

  // 3b. Cloud: API-model tracking is plan-gated (Growth has no Claude;
  // Enterprise is per-customer via organizations.plan_overrides.allowedModels).
  // Prompts can still carry disallowed model ids from an earlier plan, so
  // filter at run time instead of trusting the stored arrays. `null` means
  // every model is allowed (self-host, or a plan without the restriction).
  let allowedModels = null;
  let plan = null;
  if (isCloud()) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan, plan_overrides')
      .eq('id', brand.organization_id)
      .single();
    plan = applyPlanOverrides(getPlan(org?.plan), org);
    allowedModels = plan.limits.allowedModels ?? null;
    if (allowedModels) {
      logger.info({ brandId, allowedModels }, 'api-model tracking plan-gated for this org');
    }
  }
  // ChatGPT Shopping, like the models, only where the plan shows its results.
  const shoppingEnabled = shoppingTracked(brand, plan);
  if (brand.shopping_mode_enabled && !shoppingEnabled) {
    logger.info({ brandId }, 'chatgpt-shopping not tracked: the plan has no Shopping page');
  }
  const allowedModelsFor = (prompt) => {
    const models = prompt.models && prompt.models.length > 0 ? prompt.models : [];
    return allowedModels ? models.filter((m) => allowedModels.includes(m)) : models;
  };

  const allowedPlatformsFor = (prompt) => runnablePlatforms(prompt.platforms, { shoppingEnabled });

  // A prompt's tracked locations (#691): country codes, US state codes
  // (`US-CA`) and city codes (`TR~ISTANBUL`, PROMPT-015d) alike. No locations
  // means one untargeted run, which is what an empty list has always meant
  // here. locationsForScraper keeps a city only for Google's engines; the API
  // models take every code (userLocationFor). A city no list names is run by
  // neither: its answers would be the country's, recorded as the city's.
  const locationsFor = (prompt) =>
    prompt.regions && prompt.regions.length > 0 ? prompt.regions : [null];
  const unknownCities = [
    ...new Set(prompts.flatMap((prompt) => locationsFor(prompt).filter(isUnknownCity))),
  ];
  if (unknownCities.length > 0) {
    logger.warn({ brandId, codes: unknownCities }, 'skipping city codes no city list names');
  }

  // The countries each engine answers from (PROMPT-015e, read daily): an
  // engine isn't asked in a country it doesn't support, which would fail and
  // cost a task. Nothing is skipped when no list was read.
  const supportedCountries = await loadSupportedCountries().catch((err) => {
    logger.error({ err, brandId }, 'engine country lists unreadable; nothing skipped');
    return new Map();
  });
  const scraperLocations = (prompt, scraperId) =>
    supportedLocations(locationsFor(prompt), scraperId, supportedCountries);

  // 4. Count total tasks: one per prompt × engine × location that engine can
  // actually run: a city only by Google's engines, a US state by every one.
  let totalTasks = 0;
  let unsupported = 0;
  for (const prompt of prompts) {
    const locations = locationsFor(prompt);
    totalTasks += allowedModelsFor(prompt).length * locationsForModels(locations).length;
    for (const scraperId of allowedPlatformsFor(prompt)) {
      const runnable = scraperLocations(prompt, scraperId).length;
      totalTasks += runnable;
      unsupported += locationsForScraper(locations, scraperId).length - runnable;
    }
  }
  if (unsupported > 0) {
    logger.info(
      { brandId, skipped: unsupported },
      'engine × country pairs the engine does not support, skipped',
    );
  }

  // 5. Shared counters & helper
  let insertedCount = 0;
  let completedTasks = 0;

  const firstRunRollups = progressiveRollups({
    brandId,
    startedAt: trackingRunStartedAt,
    enabled: firstRun,
  });
  // Answers landed so far, for the refresher: those this worker stored, and
  // in webhook mode the Cloro tasks answered (the callback stores those).
  let scraperProcessed = 0;
  const landedSoFar = () => insertedCount + scraperProcessed;

  async function insertResult(row) {
    // `created_at` comes back from the insert rather than being stamped here:
    // the citation rows copy it, and a value computed in app code would drift
    // from the column default by the round trip.
    const { data: inserted, error } = await supabaseAdmin
      .from('prompt_results')
      .insert(row)
      .select('id, created_at')
      .single();
    if (error) {
      logger.error({ err: error, brandId }, 'failed to insert tracking result');
      throw error;
    }
    insertedCount++;
    firstRunRollups.note(landedSoFar());
    // Best-effort: mark target URLs cited by this answer (00032).
    await updateTargetUrlStats(row.prompt_id, row.citations, new Date().toISOString());
    // Best-effort: expand the citation array into rows (#732). The jsonb
    // column still holds the same data, so anything missed here is recoverable
    // with the backfill rather than lost.
    await persistCitationRows({
      promptResultId: inserted.id,
      brandId: row.brand_id,
      createdAt: inserted.created_at,
      citations: row.citations,
    });
  }

  // 6. Phase 1: Collect & run all scraper (platform) tasks first. A prompt's
  // ChatGPT answer asks for its fan-out on its day of the week
  // (CLORO_CHATGPT_FANOUT), on the nightly run's first attempt only; the
  // mode and the day are read once for the whole run.
  const scraperTasks = scraperTasksFor(prompts, {
    platformsFor: allowedPlatformsFor,
    locationsFor: scraperLocations,
    chatgptFanout: runAsksChatgptFanout({ source, attempt })
      ? { mode: chatgptFanoutMode(), date: new Date() }
      : null,
  });

  const webhookUrl = process.env.CLORO_WEBHOOK_URL;

  if (scraperTasks.length > 0) {
    logger.info(
      {
        brandId,
        count: scraperTasks.length,
        chatgptFanout: scraperTasks.filter((t) => t.legacy).length,
        mode: webhookUrl ? 'webhook' : 'polling',
      },
      'submitting scraper tasks to cloro',
    );

    if (job) {
      job.progress({
        current: completedTasks,
        total: totalTasks,
        promptText: 'Preparing platform scans...',
        model: null,
        platform: 'cloro',
      });
    }

    // Submit all tasks concurrently
    const submissions = await Promise.allSettled(
      scraperTasks.map((t) =>
        submitPromptTask({
          promptText: t.prompt.text,
          promptId: t.prompt.id,
          scraperId: t.scraperId,
          region: t.region,
          legacy: t.legacy,
          webhookUrl,
        }).then((res) => ({
          ...res,
          meta: t,
        })),
      ),
    );

    const submitted = [];
    for (const sub of submissions) {
      if (sub.status === 'fulfilled') {
        logger.debug(
          { scraperId: sub.value.scraperId, taskId: sub.value.taskId },
          'submitted scraper task',
        );
        submitted.push(sub.value);
      } else {
        const failedTask = scraperTasks[submissions.indexOf(sub)];
        logger.error(
          { err: sub.reason, scraperId: failedTask.scraperId },
          'failed to submit scraper task',
        );
        completedTasks++;
      }
    }

    if (webhookUrl) {
      // Webhook mode: persist (taskId → prompt) mapping; the /cloro/callback
      // endpoint will pick up results asynchronously when Cloro pushes them.
      if (submitted.length > 0) {
        // `legacy` (00378): the task went to ChatGPT's legacy interface, so
        // the callback sends it again without it if Cloro fails it.
        const pendingRows = submitted.map(({ taskId, scraperId, meta, legacy }) => ({
          task_id: taskId,
          prompt_id: meta.prompt.id,
          brand_id: brandId,
          scraper_id: scraperId,
          region: meta.region,
          legacy: legacy === true,
        }));

        const { error: pendingErr } = await supabaseAdmin
          .from('cloro_pending_tasks')
          .insert(pendingRows);

        if (pendingErr) {
          logger.error(
            { err: pendingErr, brandId },
            'failed to record pending cloro tasks — webhook results will be dropped',
          );
        } else {
          logger.info(
            { brandId, count: submitted.length },
            'pending cloro tasks recorded; webhook will deliver results',
          );
        }
      }

      // Wait for the webhook handler to drain THIS job's pending tasks. The
      // worker stays alive (cheap DB poll) so the job's `active` status drives
      // the UI loading banner until results actually arrive.
      //
      // We count only the task_ids THIS run submitted — not every pending row
      // for the brand. A brand-wide count is poisoned by orphan rows from tasks
      // Cloro never delivered a webhook for (and by concurrent runs), so it
      // never reaches zero: the drain loop runs to the deadline and the progress
      // bar freezes partway even though results keep landing. Counting our own
      // task_ids lets the loop finish as soon as this run's results are in.
      const submittedTaskIds = new Set(submitted.map((s) => s.taskId));
      const expectedSubmitted = submittedTaskIds.size;

      if (expectedSubmitted > 0) {
        const drainPollMs = 15_000;
        // Two separate budgets, because "nothing has come back yet" and "the
        // tail is taking a while" are different situations (#702).
        //
        // A single 60-minute cap measured from submission discarded healthy
        // runs: on the largest brand the first callback landed 62-65 minutes
        // after submission three nights running, so the worker gave up two to
        // five minutes before the delivery it was waiting for. The run then
        // produced zero results at stamp time, the ledger row was deleted, and
        // the dashboard and pulse stayed anchored to the previous day even
        // though ~1800 results landed minutes later.
        //
        // Before the first result there is nothing to measure: the stall and
        // ghost exits below both reason about *changes* in the pending set, so
        // they are meaningless until at least one task has come back. That
        // phase gets its own generous budget.
        const firstResultWaitMs = (Number(process.env.CLORO_FIRST_RESULT_WAIT_MIN) || 90) * 60_000;
        // Once delivery has started, this bounds the tail. Measured from the
        // first result rather than from submission, so a slow queue start no
        // longer eats the time the tail needs.
        const drainTailMs = (Number(process.env.CLORO_DRAIN_TAIL_MIN) || 60) * 60_000;
        // Give up early if delivery stalls — no new result for this many
        // consecutive polls. Cloro delivers in bursts with quiet gaps: a real
        // run went silent for 10+ minutes after the first ~600 results and
        // then delivered the remaining ~1000, so the old ~10-min limit cut a
        // healthy run in half. ~25 min tolerates those gaps while the tail
        // budget above stays the hard cap on a queue that dies mid-delivery.
        // Only counted once the first result has arrived.
        const stallPollLimit = Number(process.env.CLORO_STALL_POLL_LIMIT) || 100;
        // Ghost tasks — accepted by Cloro, never called back (google-aio does
        // this whenever a query has no AI Overview) — used to burn the whole
        // stall window on every run. Once delivery has gone quiet AND every
        // remaining task is old enough that it can no longer be in flight,
        // there is nothing left to wait for. Both conditions are required: a
        // quiet gap alone is normal mid-burst, and old tasks alone are fine as
        // long as results are still landing.
        const ghostStallPolls = Number(process.env.CLORO_GHOST_STALL_POLLS) || 60;
        // How old a still-pending task has to be before it counts as a ghost.
        // Configurable because the safe value tracks Cloro's delivery latency,
        // which moves: one brand's first result has arrived 34 minutes after
        // submission, and another's at 29.7 — seconds under this threshold.
        // Raise it if healthy runs start exiting as 'ghosts'.
        const ghostTaskAgeMs = (Number(process.env.CLORO_GHOST_TASK_AGE_MIN) || 30) * 60_000;
        // A run someone kicked off from the UI is watched while it runs; a
        // nightly cron run is not. Only the watched one pays for the ghost
        // thresholds in user-visible time, so only it gets the short tail —
        // two minutes of quiet is enough to call a negligible remainder done.
        const isInteractive = source !== 'cron';
        const interactiveTailPolls = Number(process.env.CLORO_INTERACTIVE_TAIL_POLLS) || 8;

        let lastPending = expectedSubmitted;
        // Tracks the true count at every poll, unlike lastPending, which only
        // moves when the set shrinks. Reported at exit so the log says how many
        // tasks were abandoned rather than leaving it to be inferred.
        let pendingAtExit = expectedSubmitted;
        let stalledPolls = 0;
        // Consecutive polls where the pending set did not shrink. Distinct from
        // stalledPolls, which advances only after delivery has been confirmed;
        // this one is counted unconditionally so the interactive tail keeps
        // working when that confirmation never comes.
        let quietPolls = 0;
        const drainStartedAt = Date.now();
        const drainStartedIso = new Date(drainStartedAt).toISOString();
        let firstResultAt = null;
        let exitReason = 'drained';

        for (;;) {
          // Budget first, so it also bounds a poll that keeps failing — the
          // retry path below skips the rest of the iteration.
          const budgetExit = drainBudgetExceeded({
            now: Date.now(),
            drainStartedAt,
            firstResultAt,
            firstResultWaitMs,
            drainTailMs,
          });
          if (budgetExit) {
            exitReason = budgetExit;
            break;
          }

          // Brand-scoped read, intersected in memory with our own task_ids —
          // avoids a giant `.in(...)` URL. Paged, because PostgREST caps an
          // un-paginated select at 1000 rows: a run that submitted more than
          // that saw a pending count frozen at 1000, which read as "1130 tasks
          // already finished" on the first poll and as "nothing is moving" on
          // every poll after it (#714).
          const { rows, error: drainErr } = await fetchAllPendingRows((offset) =>
            supabaseAdmin
              .from('cloro_pending_tasks')
              .select('task_id, submitted_at')
              .eq('brand_id', brandId)
              .range(offset, offset + PENDING_PAGE_SIZE - 1),
          );

          // A transient read failure must NOT be read as "0 pending" — that would
          // break the loop early and report the run as finished while tasks are
          // still in flight. Skip this tick and retry on the next poll.
          if (drainErr) {
            logger.warn({ err: drainErr, brandId }, 'pending-task poll failed, retrying');
            await new Promise((r) => setTimeout(r, drainPollMs));
            continue;
          }

          const ourRows = (rows || []).filter((r) => submittedTaskIds.has(r.task_id));
          const pending = ourRows.length;
          pendingAtExit = pending;
          const processed = expectedSubmitted - pending;
          scraperProcessed = processed;
          firstRunRollups.note(landedSoFar());
          const allPendingAreOld = allTasksAreStale(ourRows, ghostTaskAgeMs);

          // "Delivery started" has to mean a result actually landed, not just
          // that a pending row went away. The callback handler also deletes
          // rows for FAILED tasks, for a COMPLETED task with no response body,
          // and when the brand lookup fails — none of which produce a result.
          // A shrinking pending set is therefore not proof that anything
          // arrived, and treating it as proof starts the stall clock against a
          // run that has received nothing (#714).
          if (processed > 0 && firstResultAt === null) {
            const { data: firstRows, error: firstErr } = await supabaseAdmin
              .from('prompt_results')
              .select('id')
              .eq('brand_id', brandId)
              .gte('created_at', drainStartedIso)
              .limit(1);
            if (!firstErr && (firstRows ?? []).length > 0) {
              firstResultAt = Date.now();
              logger.info(
                { brandId, waitedMs: firstResultAt - drainStartedAt, expected: expectedSubmitted },
                'cloro delivery started',
              );
            }
          }

          if (job) {
            // Once delivery has gone quiet and only a negligible remainder is
            // left, "still processing" reads as a hang. Say what is actually
            // happening instead: the run is finishing, waiting on stragglers.
            // The count is answers still outstanding, not platforms — keep the
            // word "platform" away from it, or "10 platform checks" reads as
            // ten engines on a brand that tracks six.
            const finishingUp =
              pending > 0 && quietPolls > 0 && pending <= tailRemainder(expectedSubmitted);
            job.progress({
              current: completedTasks + processed,
              total: totalTasks,
              promptText:
                pending === 0
                  ? 'All AI answers received'
                  : finishingUp
                    ? pending === 1
                      ? 'Finishing up — waiting on the last answer'
                      : `Finishing up — waiting on the last ${pending} answers`
                    : `Receiving AI answers — ${pending} still in progress...`,
              model: null,
              platform: 'cloro',
            });
          }

          if (pending === 0) break;

          // Whether the set moved this poll is tracked here, ABOVE the
          // first-result guard. The guard below can hold a run indefinitely if
          // the delivery probe never succeeds, and a measured run sat here for
          // over forty minutes with 292 of its 294 tasks long since resolved —
          // past the stall cap, past the ghost age, exiting on neither because
          // execution never reached them. The interactive tail must not depend
          // on that probe: a pending set that has shrunk to a handful is
          // evidence enough that nothing is left worth waiting for, whether
          // those tasks came back as results, failures or empty responses.
          if (pending < lastPending) {
            lastPending = pending;
            stalledPolls = 0;
            quietPolls = 0;
          } else {
            quietPolls += 1;
          }

          if (
            isInteractive &&
            interactiveTailExhausted({
              pending,
              expected: expectedSubmitted,
              quietPolls,
              quietPollLimit: interactiveTailPolls,
            })
          ) {
            exitReason = 'tail';
            break;
          }

          // Stall and ghost detection reason about results actually arriving,
          // so they only mean anything once one demonstrably has.
          if (firstResultAt === null) {
            await new Promise((r) => setTimeout(r, drainPollMs));
            continue;
          }

          if (quietPolls > 0) {
            if (allPendingAreOld && stalledPolls + 1 >= ghostStallPolls) {
              stalledPolls += 1;
              exitReason = 'ghosts';
              break;
            }
            if (++stalledPolls >= stallPollLimit) {
              exitReason = 'stalled';
              break;
            }
          }

          await new Promise((r) => setTimeout(r, drainPollMs));
        }

        // Always log how the drain ended. Reconstructing this from the database
        // the morning after — which is how #702 was diagnosed — is guesswork,
        // because the timed-out path used to fall out of the loop silently.
        // 'tail' joins 'drained' as an ordinary ending rather than a warning:
        // it means the run delivered everything but a negligible remainder and
        // chose not to make a waiting user sit through the ghost thresholds.
        const healthyExit = exitReason === 'drained' || exitReason === 'tail';
        const log = healthyExit ? logger.info : logger.warn;
        log.call(
          logger,
          {
            brandId,
            exitReason,
            expected: expectedSubmitted,
            pendingAtExit,
            elapsedMs: Date.now() - drainStartedAt,
            firstResultAfterMs: firstResultAt ? firstResultAt - drainStartedAt : null,
          },
          `cloro drain finished (${exitReason})`,
        );
      }

      completedTasks += expectedSubmitted;
    } else {
      logger.info(
        { submitted: submitted.length, total: scraperTasks.length },
        'tasks submitted, polling for results',
      );

      // Polling fallback: wait for each task inline (legacy behavior)
      await Promise.allSettled(
        submitted.map(async ({ taskId, scraperId, meta, legacy }) => {
          try {
            logger.debug({ taskId, scraperId }, 'polling scraper task');
            const aiResponse = await pollTrackingTask({ taskId, scraperId, legacy, meta });
            logger.debug({ taskId, scraperId }, 'scraper task completed, inserting result');

            const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
            const sentimentResult =
              mentionCount > 0
                ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName, brandInfo.domains)
                : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };
            const metrics = parseResponse(
              aiResponse,
              brandInfo,
              sentimentResult.sentiment,
              competitors,
            );

            await insertResult({
              prompt_id: meta.prompt.id,
              brand_id: brandId,
              platform: meta.scraperId,
              response: aiResponse.text,
              citations: aiResponse.citations,
              mention_count: metrics.mentionCount,
              citation_count: metrics.citationCount,
              sentiment: metrics.sentiment,
              visibility_score: metrics.visibilityScore,
              model_used: aiResponse.model,
              region: meta.region,
              competitor_mentions: metrics.competitorMentions,
              mention_position: metrics.mentionPosition,
              mentioned_entity_count: metrics.mentionedEntityCount,
              search_queries: Array.isArray(aiResponse.search_queries)
                ? aiResponse.search_queries
                : [],
            });

            logger.debug({ taskId, scraperId }, 'scraper task result saved');
          } catch (err) {
            logger.error({ err, taskId, scraperId }, 'scraper task failed');
          }

          completedTasks++;
          if (job) {
            job.progress({
              current: completedTasks,
              total: totalTasks,
              promptText: meta.prompt.text.slice(0, 80),
              model: scraperId,
              platform: 'cloro',
            });
          }
        }),
      );
    }
  }

  // 7. Phase 2: Run AI model tasks concurrently
  const modelTasks = [];
  for (const prompt of prompts) {
    const modelsToRun = allowedModelsFor(prompt);
    const locations = locationsFor(prompt);

    for (const modelName of modelsToRun) {
      for (const region of locationsForModels(locations)) {
        modelTasks.push({ prompt, modelName, region });
      }
    }
  }

  if (modelTasks.length > 0) {
    logger.info({ count: modelTasks.length }, 'running ai model tasks concurrently');

    await Promise.allSettled(
      modelTasks.map(async ({ prompt, modelName, region }) => {
        if (job) {
          job.progress({
            current: completedTasks,
            total: totalTasks,
            promptText: prompt.text.slice(0, 80),
            model: modelName,
            region,
            platform: resolveModelPlatform(modelName),
          });
        }

        try {
          const aiResponse = await runPrompt(prompt.text, modelName, region);

          const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
          const sentimentResult =
            mentionCount > 0
              ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName, brandInfo.domains)
              : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };
          const metrics = parseResponse(
            aiResponse,
            brandInfo,
            sentimentResult.sentiment,
            competitors,
          );

          await insertResult({
            prompt_id: prompt.id,
            brand_id: brandId,
            platform: resolveModelPlatform(modelName),
            response: aiResponse.text,
            citations: aiResponse.citations,
            mention_count: metrics.mentionCount,
            citation_count: metrics.citationCount,
            sentiment: metrics.sentiment,
            visibility_score: metrics.visibilityScore,
            model_used: aiResponse.model,
            region,
            competitor_mentions: metrics.competitorMentions,
            mention_position: metrics.mentionPosition,
            mentioned_entity_count: metrics.mentionedEntityCount,
            // The searches the model ran, where its API gives them (OpenAI's web_search).
            search_queries: Array.isArray(aiResponse.search_queries)
              ? aiResponse.search_queries
              : [],
          });
        } catch (err) {
          logger.error({ err, model: modelName, region }, 'ai model task failed');
        }

        completedTasks++;
        if (job) {
          job.progress({
            current: completedTasks,
            total: totalTasks,
            promptText: prompt.text.slice(0, 80),
            model: modelName,
            platform: resolveModelPlatform(modelName),
          });
        }
      }),
    );
  }

  logger.info({ brandId, resultCount: insertedCount }, 'tracking results stored');

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('organization_id', brand.organization_id)
      .limit(1)
      .single();

    if (profile) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('plan')
        .eq('id', brand.organization_id)
        .single();

      const plan = getPlan(org?.plan);
      if (hasFeature(plan, 'content_optimization')) {
        refreshPromptClusters(brandId)
          .catch((err) => {
            logger.error({ err, brandId }, 'prompt cluster refresh failed');
          })
          .then(() => refreshSitePages(brandId))
          .catch((err) => {
            logger.error({ err, brandId }, 'site page inventory refresh failed');
          })
          .then(() => generateContentOpportunities(brandId))
          .catch((err) => {
            logger.error({ err, brandId }, 'auto opportunity generation failed');
          });
      }
    }
  } catch (err) {
    logger.error({ err, brandId }, 'failed to check opportunity generation eligibility');
  }

  // Stamp the ledger row — or, when Cloro is still delivering, hand back a
  // promise that stamps it once the late answers are in (lib/run-settlement).
  // `stamped` / `lateStamp` gate the Daily Pulse and signal pass (#702): a
  // run whose row never stamped did not move the 24h anchor, so its pulse
  // would recompute the previous run's window and mail numbers the recipient
  // already has.
  const settlement = trackingRunId
    ? await settleTrackingRun(
        {
          brandId,
          runId: trackingRunId,
          startedAt: trackingRunStartedAt,
          plannedTasks: totalTasks,
        },
        // A first run also hands over its rollup refresher: the stamp waits
        // for it, and late answers keep the rollups moving.
        firstRun ? { pollMs: FIRST_RUN_LATE_POLL_MS, rollups: firstRunRollups } : undefined,
      )
    : { stamped: false, lateStamp: null, resultCount: null };

  return {
    // A webhook's answers are stored by /cloro/callback, never through
    // insertResult: the settlement's count, read from the table, has them.
    resultCount: settlement.resultCount ?? insertedCount,
    stamped: settlement.stamped,
    // Still arriving: the run waits for its late answers before it stamps.
    stillArriving: Boolean(settlement.lateStamp),
    lateStamp: settlement.lateStamp,
    // The brand's first full run: its stamp e-mails "Your first results are ready".
    firstRun,
  };
}
