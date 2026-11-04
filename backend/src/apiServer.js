import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { Server as SocketIOServer } from 'socket.io';
import cron from 'node-cron';

import logger from './lib/logger.js';
import { handleProcessErrors } from './lib/processErrors.js';
import Middleware from './middleware/index.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import requestIdMiddleware from './middleware/requestId.js';
import { requireActiveSubscription } from './middleware/subscription.js';
import { requestScope } from './lib/requestScope.js';
import {
  DEMO_BRAND,
  isDemoBrand,
  isDemoBrandRow,
  refuseDemoBrandWrites,
} from './middleware/demoBrand.js';
import routes from './routes/index.js';
import trafficRoutes from './routes/traffic.js';
import publicReportCardRoutes from './routes/publicReportCard.js';
import botIngestRoutes from './routes/botIngest.js';
import cloroCallbackRoutes from './routes/cloroCallback.js';
import internalTriggerTrackingRoutes from './routes/internalTriggerTracking.js';
import internalChatBudgetRoutes from './routes/internalChatBudget.js';
import internalChatNoticesRoutes from './routes/internalChatNotices.js';
import internalChatPagesRoutes from './routes/internalChatPages.js';
import internalChatModelsRoutes from './routes/internalChatModels.js';
import internalChatGoLiveRoutes from './routes/internalChatGoLive.js';
import { pruneBotEvents } from './lib/botIngest.js';
import { pruneContentVersions } from './lib/contentHistory.js';
import { pruneLlmVerdicts } from './lib/audit/llmVerdicts.js';
import {
  createJob,
  cleanupStaleJobs,
  cleanupOldJobs,
  cleanupStalePendingTasks,
} from './lib/jobManager.js';
import { runTrackingJob, recoverWaitingJobs } from './lib/jobRunner.js';
import { joinPersonRoom } from './lib/socketRooms.js';
import { listDailyTrackingBrands } from './lib/trackingBrands.js';
import { rebuildQueuedInsightsRollups, sweepInsightsRollups } from './lib/insightsRollups.js';
import { rebuildQueuedCitationRollups, REBUILD_QUEUE_SCHEDULE } from './lib/citationsRollups.js';
import { sweepActionValidation } from './lib/action-center/validate.js';
import { sweepImproveOutcomes } from './lib/action-center/improveOutcome.js';
import { sweepBrandFacts } from './lib/brandFactsSweep.js';
import { purgeRemovedCatalogProducts } from './lib/catalog/purge.js';
import { sweepExpiredChatUploads } from './lib/chatUploadsSweep.js';
import { sweepIdleDemoBrands } from './lib/demo/idleSweep.js';
import { sweepCatalogSources } from './lib/catalog/sources.js';
import { sweepShoppingCardMatches } from './lib/catalog/cardMatch.js';
import { sweepFramerPublished } from './lib/cms/framerStatus.js';
import { sweepWebflowPublished } from './lib/cms/webflowStatus.js';
import { sweepWordPressPublished } from './lib/cms/wordpressStatus.js';
import { sweepWixPublished } from './lib/cms/wixStatus.js';
import { generateBriefForOpportunity } from './routes/content.js';
import webhookContentCallbackRoutes from './routes/webhookContentCallback.js';
import webhookContentDraftCallbackRoutes from './routes/webhookContentDraftCallback.js';
import { sendImproveActionForKeyUser } from './routes/prompts.js';
import { liveAddress, publishDraftForKeyUser } from './lib/contentPublished.js';
import {
  readOpportunityInbox,
  recentAuditBody,
  startAutoAudits,
  startSiteAuditForBrand,
} from './routes/audits.js';
import { sweepAutoAudits } from './lib/audit/autoAuditSweep.js';
import { PlanLimitError, getAiUsage, getSiteAuditQuotaStatus } from './lib/planGuard.js';
import { recountBrandCitations } from './lib/citationRecount.js';
import supabaseAdmin from './config/supabase.js';
import { getPlan, hasFeature, isCloud, isSubscriptionActive } from './config/plans.js';
import { runGscSync } from './lib/gscSync.js';
import { scheduleDemandCollect, sweepPromptDemand } from './lib/promptDemand.js';
import { runGaSync } from './lib/gaSync.js';
import { sendTrafficDigests } from './lib/traffic-digest/engine.js';
import { runPageOpportunityDetection } from './lib/pageOpportunities.js';
import { runPulseCatchUp } from './lib/pulse/engine.js';
import { runSignalCatchUp } from './lib/signals/pass.js';
import { integrationsConfig } from './routes/integrations.js';
import { sweepTaskExecution } from './lib/action-center/execution/run.js';
import { sweepCompetitorTimeline } from './lib/action-center/competitorTimeline.js';
import { sweepActionTasks } from './lib/action-center/task-writer/index.js';
import { sweepTaskChecks } from './lib/action-center/taskChecks.js';
import { sendHealthReport } from './lib/health/report.js';
import { checkPromptUsageCounters } from './lib/promptUsageCounters.js';
import { refreshCloroCountries } from './lib/cloroCountries.js';
import { chatAgenticDeployed } from './lib/chatFlag.js';
import { startChatAgentTicks } from './lib/chatAgents.js';
import { startModelPriceSync } from './lib/modelPrices.js';
import { startDailySuggestions } from './lib/chat-suggestions/job.js';
import { startImpactLedger } from './lib/impact-ledger/job.js';

// Before anything starts: a stray rejection is logged, not a crash.
handleProcessErrors();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// --- Body parsing (before all routes) ---
// /cloro/callback gets the raw body bytes: HMAC signature verification needs the
// payload exactly as sent, and express.json()'s parse/re-serialize would break it.
// Mounted first so the global JSON parser skips this path (body already consumed).
app.use('/cloro/callback', express.raw({ type: 'application/json', limit: '50mb' }));
// AI-bot requests from brands' Cloudflare / Vercel (AT-010): authenticated by
// each connection's secret, server to server. Mounted before the JSON and form
// parsers: the route checks the secret first, then reads the Worker's JSON,
// the gzipped Logpush file or the Vercel drain's logs raw itself.
app.use('/', botIngestRoutes);

// --- Public traffic tracking (before helmet/cors — needs its own CORS for any origin) ---
// Mounted before the JSON and form parsers too: anyone can post to /track, so
// its own limiter runs first and its body is read only up to its own 64 KB,
// whatever its content type, never by the 50 MB parsers below.
app.use('/', trafficRoutes);

// --- The free report card's form on www.getcito.com (routes/publicReportCard.js) ---
// Public like /track: its own CORS (REPORT_CARD_ORIGINS), limiter and 16 KB
// body, before the dashboard's CORS and the 50 MB parsers below.
app.use('/public/report-card', publicReportCardRoutes);

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// --- Request logger (before everything to catch all requests) ---
app.use(requestIdMiddleware);
app.use((req, res, next) => {
  req.log.debug(
    { method: req.method, path: req.path, origin: req.headers.origin, ip: req.ip },
    'incoming request',
  );
  next();
});

// --- CORS (for dashboard API only — after traffic routes) ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

logger.info({ allowedOrigins }, 'CORS configured');

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// --- Security ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

// --- Rate limiting ---
app.use('/api', apiLimiter);

// --- Socket.IO ---
const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.use((socket, next) => Middleware.checkRequestIsComingFromDomainForSocket(socket, next));
io.use((socket, next) => Middleware.decodeTokenForSocket(socket, next));

io.on('connection', (socket) => {
  logger.debug({ socketId: socket.id, userId: socket.user?.id }, 'socket connected');
  // Its person's room only: job events go to the people who may reach the
  // brand (lib/socketRooms.js), never to every client.
  joinPersonRoom(socket);

  socket.on('disconnect', () => {
    logger.debug({ socketId: socket.id }, 'socket disconnected');
  });
});

// Make io accessible to routes
app.set('io', io);

// --- Daily tracking logic (shared by internal endpoint and self-hosted cron) ---
async function runDailyTracking() {
  const isCloudMode = isCloud();

  // Sweep orphaned Cloro pending tasks daily (runs in both cloud and
  // self-hosted, since both paths funnel through here).
  await cleanupStalePendingTasks();

  // Read the countries each engine answers from (PROMPT-015e) before
  // tracking, so today's runs skip what an engine doesn't support and the
  // location picker offers what it does. A failed read keeps yesterday's.
  await refreshCloroCountries().catch((err) => {
    logger.error({ err }, '[cloro-countries] refresh crashed');
  });

  // Recover pulses whose fire-and-forget trigger died with the process
  // (OOM, deploy, crash) after the run had already stamped. Non-blocking —
  // today's runs and their own pulses are independent of this sweep.
  runPulseCatchUp().catch((err) => {
    logger.error({ err }, '[pulse] catch-up sweep crashed');
  });

  // The same recovery for signals and actions (#818). A pass that threw last
  // night — a statement timeout on a large brand, a deploy, an OOM — left no
  // row in signal_runs, and this re-runs it. Without it a lost night was lost
  // for good: the Action Center simply showed nothing new and said nothing
  // about why.
  runSignalCatchUp().catch((err) => {
    logger.error({ err }, '[signals] catch-up sweep crashed');
  });

  // Check the Tracked Prompts usage counters against the prompts themselves
  // and rebuild any that drifted (PROMPT-012). Non-blocking, like the above.
  checkPromptUsageCounters().catch((err) => {
    logger.error({ err }, '[prompt-usage] counter check crashed');
  });

  // Carry out the tasks the engine can carry out itself (#818 phase 7). Runs
  // after the catch-up above so tonight's actions exist before anything tries
  // to work on them. Bounded by a nightly ceiling; every attempt is recorded
  // in action_task_runs and, where the user needs to know, in the action's own
  // trail. Fire-and-forget like the rest — an unexecuted task is a step
  // somebody does by hand, not a reason to hold up tracking.
  sweepTaskExecution()
    .catch((err) => {
      logger.error({ err }, '[task-run] sweep crashed');
    })
    // Then a competitor's pages over time (learning C3): their first
    // citations, and the weekly re-read of those cited most, within what is
    // left of each brand's page reads after the tasks'.
    .then(() => sweepCompetitorTimeline())
    .catch((err) => {
      logger.error({ err }, '[competitor-timeline] sweep crashed');
    });

  // Write the tasks of recent actions whose writing a pass missed (AC-004):
  // the budget was spent, the model failed, or the process restarted.
  // Bounded per sweep; a no-op unless ACTION_TASKS_AI is on.
  //
  // Then check the open tasks checked `auto` on their pages (AC-010): a page
  // fetched again with the free reader, one at a time, bounded per night. A
  // task that passes is completed. Once the writer's sweep settles, as it
  // can delete a task a check just completed. Fire-and-forget like the rest.
  sweepActionTasks()
    .catch((err) => {
      logger.error({ err }, '[task-writer] daily sweep crashed');
    })
    .then(() => sweepTaskChecks())
    .catch((err) => {
      logger.error({ err }, '[task-checks] daily sweep crashed');
    });

  // Insights rollup backstop (00066). Re-refreshes the trailing days for
  // every brand, so days whose run never stamped (partial, crashed) and
  // out-of-run writes (a prompt analyzed right after being added) appear the
  // next morning. Fire-and-forget: idempotent against the per-run refresh
  // that today's runs will do when they stamp, and never blocks tracking.
  sweepInsightsRollups().catch((err) => {
    logger.error({ err }, '[insights-rollups] daily sweep crashed');
  });

  // Measure what closed actions actually moved (#818 phase 2). Runs after the
  // rollups above are refreshed, since it reads them — but fire-and-forget
  // like the rest: an unmeasured action is a gap in History, not a reason to
  // hold up tonight's tracking.
  sweepActionValidation().catch((err) => {
    logger.error({ err }, '[action-validation] daily sweep crashed');
  });

  // Today's 7-day positions for every Improve action still being tracked
  // (PROMPT-008): the Outcome card, the Positions panel and History read them.
  sweepImproveOutcomes().catch((err) => {
    logger.error({ err }, '[improve-outcome] daily sweep crashed');
  });

  // A brand's facts read again each week (CE-047): the brands whose site was
  // read over a week ago, a bounded number a night; a no-op before Quality's
  // phase 2. Fire-and-forget: an unread week is a stale fact the person can
  // read again by hand, not a reason to hold up tracking.
  sweepBrandFacts().catch((err) => {
    logger.error({ err }, '[brand-facts] weekly sweep crashed');
  });

  // Skip paused brands (the user's own stop) and demo brands (sample data).
  const { data: brands, error } = await listDailyTrackingBrands();

  if (error || !brands || brands.length === 0) {
    return { triggered: 0, total: 0 };
  }

  const orgPlanCache = {};
  let triggered = 0;

  for (const brand of brands) {
    if (!orgPlanCache[brand.organization_id]) {
      if (!isCloudMode) {
        orgPlanCache[brand.organization_id] = getPlan('self_hosted');
      } else {
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('plan, subscription_status')
          .eq('id', brand.organization_id)
          .single();
        // Skip orgs without an active or trialing Stripe subscription.
        // Previously this fell back to starter limits, which silently kept
        // running daily monitoring (and Cloro / AI provider spend) for
        // unsubscribed signups.
        if (!isSubscriptionActive(org?.subscription_status)) {
          orgPlanCache[brand.organization_id] = null;
        } else {
          orgPlanCache[brand.organization_id] = getPlan(org.plan);
        }
      }
    }

    const plan = orgPlanCache[brand.organization_id];
    if (!plan) continue; // unsubscribed → skip silently
    if (!hasFeature(plan, 'daily_monitoring')) continue;

    const { count } = await supabaseAdmin
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
      .eq('prompt_sets.brand_id', brand.id)
      .eq('is_active', true);

    if ((count || 0) === 0) continue;

    const job = await createJob({
      type: 'tracking',
      brandId: brand.id,
      data: { brandId: brand.id, immediate: false },
      maxAttempts: 3,
    });
    runTrackingJob(job.id, io);
    triggered++;
  }

  logger.info({ triggered, total: brands.length }, 'daily tracking triggered');

  // Search Console sync (#644) — independent follow-up step; never blocks or
  // fails the tracking run. No-ops when Composio isn't configured.
  //
  // Each prompt's real demand (PROMPT-014) follows it, so tonight's queries
  // are the ones matched: Search Console every night, and the weekly Google
  // Trends, People Also Ask and YouTube tasks when DEMAND_SIGNALS is on, read
  // an hour later or the next night. It runs whether or not the sync did.
  runGscSync()
    .catch((err) => {
      logger.error({ err }, '[gsc-sync] daily run failed');
    })
    .then(() => sweepPromptDemand())
    .then(() => scheduleDemandCollect())
    .catch((err) => {
      logger.error({ err }, '[prompt-demand] daily sweep crashed');
    });

  // AI-bot rows past their retention (AT-010): 90 days, counters 400.
  pruneBotEvents().catch((err) => {
    logger.error({ err }, '[ai-bots] daily prune failed');
  });

  // Content Editor versions past their 90 days (CE-018).
  pruneContentVersions().catch((err) => {
    logger.error({ err }, '[content-history] daily prune failed');
  });

  // Site Audit's kept AI verdicts no audit has read for 180 days (00430).
  pruneLlmVerdicts().catch((err) => {
    logger.error({ err }, '[audit] daily AI verdicts prune failed');
  });

  // Chat's attachments past their 90 days (00409): each file, then its row.
  sweepExpiredChatUploads().catch((err) => {
    logger.error({ err }, '[chat-uploads] daily sweep failed');
  });

  // Demo brands nobody opened for two weeks (00380): their sample rows go,
  // the brand row stays, and the next visit builds them again.
  sweepIdleDemoBrands().catch((err) => {
    logger.error({ err }, '[demo] idle sweep failed');
  });

  // Catalog feed URLs (#1263): read again once a day, never blocking tracking.
  // Then the products removed from their source over 90 days ago are
  // deleted: after the sweep, so it isn't deleting while a sync brings one back.
  // Then the brands' AI shopping cards are matched to their catalogs as they
  // are now (product visibility, 00360).
  sweepCatalogSources()
    .catch((err) => {
      logger.error({ err }, '[catalog] daily sweep failed');
    })
    .then(() => purgeRemovedCatalogProducts())
    .catch((err) => {
      logger.error({ err }, '[catalog] daily purge failed');
    })
    .then(() => sweepShoppingCardMatches())
    .catch((err) => {
      logger.error(
        { err: { name: err?.name, message: err?.message } },
        '[card-match] daily sweep failed',
      );
    });

  // Pages sent to Webflow, published there since (#1331): read once a day.
  sweepWebflowPublished().catch((err) => {
    logger.error({ err: { name: err?.name } }, '[webflow-status] daily sweep failed');
  });
  // And to WordPress (00294), once a day too.
  sweepWordPressPublished().catch((err) => {
    logger.error({ err: { name: err?.name } }, '[wordpress-status] daily sweep failed');
  });
  // And to Framer (00295), once a day too.
  sweepFramerPublished().catch((err) => {
    logger.error({ err: { name: err?.name } }, '[framer-status] daily sweep failed');
  });
  // And to Wix (00372), once a day too.
  sweepWixPublished().catch((err) => {
    logger.error({ err: { name: err?.name } }, '[wix-status] daily sweep failed');
  });

  // Google Analytics sync (#704) — same contract as the Search Console sync
  // above: independent, never blocks or fails the tracking run, no-ops when
  // Composio or the Analytics auth config isn't set.
  //
  // Page opportunity detection (#719) is chained onto it rather than fired
  // alongside: it reads the tables the sync writes, so running the two
  // concurrently would score yesterday's window. A sync failure skips
  // detection instead of letting it publish findings from stale data.
  //
  // The auto-audit runs (SA-006) come after both, so a run audits the pages
  // this week's data ranks highest; they run whether or not the sync did.
  runGaSync()
    .then(() =>
      runPageOpportunityDetection().catch((err) => {
        logger.error({ err }, '[page-opportunities] daily run failed');
      }),
    )
    .catch((err) => {
      logger.error({ err }, '[ga-sync] daily run failed');
    })
    .finally(() => {
      // The AI Traffic weekly digest (AT-013): Mondays, after the sync, so
      // last Sunday's Analytics numbers are in. Cloud only, like the pulse.
      sendTrafficDigests().catch((err) => {
        logger.error({ err }, '[traffic-digest] weekly sweep crashed');
      });
      return sweepAutoAudits({
        readInbox: readOpportunityInbox,
        startAudits: startAutoAudits,
      }).catch((err) => {
        logger.error({ err }, '[auto-audit] daily sweep crashed');
      });
    });

  return { triggered, total: brands.length };
}

// --- Daily health report (CRON_SECRET auth, Vercel Cron) ---
// Answers at once and reports in the background: timing the page reads can
// take longer than a cron request may stay open.
app.post('/api/internal/health-report', (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  sendHealthReport().catch((err) => logger.error({ err }, '[health] daily report failed'));
  return res.status(202).json({ success: true });
});

// --- Internal cron endpoint (CRON_SECRET auth, used by Vercel Cron in cloud mode) ---
app.post('/api/internal/daily-tracking', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const result = await runDailyTracking();
    return res.json({ success: true, ...result });
  } catch (err) {
    req.log.error({ err }, 'daily tracking error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal content-brief endpoint (CRON_SECRET auth, called by web MCP layer) ---
// The web layer's MCP route does the org-ownership check *before* hitting
// this endpoint — it can't reach here unless the authenticated `getcito_` API
// key belongs to the same org as the opportunity. So this endpoint just
// trusts the secret and runs the LLM. Always passes force=true to bypass
// the cached-brief early-return (MCP callers want a fresh brief; for
// cached reads they should use get_content_opportunity instead). Never on
// a demo brand (00380): 402 demo_brand, as the API answers.
app.post('/api/internal/content/:id/brief', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { id } = req.params;
    if (await isDemoBrandRow('content_opportunities', id)) {
      return res.status(402).json(DEMO_BRAND);
    }
    const { force, model } = req.body || {};
    const result = await generateBriefForOpportunity(id, {
      force: Boolean(force),
      model,
    });
    return res.json({
      success: true,
      brief: result.brief,
      generated_at: result.generated_at,
      regenerated: result.regenerated,
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    // PlanLimitError (brief quota exhausted / inactive subscription) carries
    // a statusCode — surface it so the MCP layer can relay a clear message.
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'internal content brief error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal site-audit endpoint (CRON_SECRET auth, called by web MCP layer) ---
// The web MCP layer verifies the caller's `getcito_` API key org owns `brandId`
// before reaching here, so this endpoint just trusts the secret, resolves the
// brand's org, enforces the monthly Site Audit quota, and starts the detached
// audit job — returning the new `running` audit, or the page's audit already
// running (the MCP caller then polls get_site_audit for the result). A page
// audited in the last minutes answers 409 recently_audited unless `force`.
// Never on a demo brand (00380).
app.post('/api/internal/site-audits', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { brandId, url, force } = req.body || {};
    if (!brandId || !url) {
      return res.status(400).json({ success: false, message: 'brandId and url are required' });
    }
    if (await isDemoBrand(brandId)) return res.status(402).json(DEMO_BRAND);
    const started = await startSiteAuditForBrand(brandId, url, { force: force === true });
    if (started.recent) return res.status(409).json(recentAuditBody(started.recent));
    return res.status(202).json({
      success: true,
      audit: started.audit,
      alreadyRunning: started.alreadyRunning === true,
    });
  } catch (err) {
    // 404: no such brand; 400: not a page address.
    if (err.status === 404 || err.status === 400) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    // PlanLimitError (audit quota exhausted / inactive subscription) carries a
    // statusCode — surface it so the MCP layer can relay a clear message.
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'internal site audit error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal site-audit quota endpoint (CRON_SECRET auth, called by web MCP layer) ---
// Read-only: returns the org's monthly Site Audit allowance via the same
// getSiteAuditQuotaStatus the dashboard uses, so the MCP `get_site_audit_quota`
// tool shares one source of truth for plan limits + usage counting. The web
// MCP layer passes its authenticated org id.
app.get('/api/internal/site-audit-quota', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    // Express gives an array when a query param is repeated; take the first so
    // a single string always reaches getSiteAuditQuotaStatus.
    const raw = req.query.orgId;
    const orgId = Array.isArray(raw) ? raw[0] : raw;
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'orgId is required' });
    }
    // A read, as the dashboard's: a plan that ended reads as a limit of 0.
    const quota = await getSiteAuditQuotaStatus(orgId, { readOnly: true });
    return res.json({ success: true, quota });
  } catch (err) {
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'internal site audit quota error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal AI usage endpoint (CRON_SECRET auth, called by web MCP layer) ---
// Read-only: this period's AI usage for the org, as GET /api/billing/ai-usage
// answers a member (getAiUsage), so the MCP `get_ai_usage` tool reads the
// Billing meter's own numbers. The web MCP layer passes its authenticated org
// id. Without an active plan there is no allowance to meter: 402 plan_limit.
app.get('/api/internal/ai-usage', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const raw = req.query.orgId;
    const orgId = z.guid().safeParse(Array.isArray(raw) ? raw[0] : raw);
    if (!orgId.success) {
      return res.status(400).json({ success: false, message: 'orgId must be a UUID' });
    }
    return res.json({ success: true, usage: await getAiUsage(orgId.data) });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'plan_limit', message: err.message });
    }
    req.log.error({ err }, 'internal AI usage error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal integrations config (CRON_SECRET auth, called by web MCP layer) ---
// Which integrations this deployment has credentials for, as GET
// /api/integrations/config answers a member: the MCP tools have no member
// session to ask with (Product Visibility's readiness checks Merchant Center
// only where it is offered). Booleans only.
app.get('/api/internal/integrations-config', (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return res.json({ success: true, config: integrationsConfig() });
});

// --- Internal Chat budget endpoints (CRON_SECRET auth, called by the web's Chat engine) ---
// Each model step of a Chat run is held on the workspace's AI budget before it
// starts, then charged at its real cost or let go (routes/internalChatBudget.js).
// With the secret, the /api limiter above doesn't count them (rateLimiter.js).
app.use('/api/internal/chat/budget', internalChatBudgetRoutes);

// --- Internal Chat notices (CRON_SECRET auth, called by the web's Chat engine and sweep) ---
// The workspace's own AI key failed: each Admin's Inbox notice and e-mail, once
// per failure episode and one reminder (routes/internalChatNotices.js, 00441).
app.use('/api/internal/chat/notices', internalChatNoticesRoutes);

// --- Internal Chat page reads (CRON_SECRET auth, called by the web's Chat engine) ---
// fetch_page (CHAT-10 §B): a public page opened through safe-fetch's rules and
// read on the server; only what Chat reads of it goes back (routes/internalChatPages.js).
app.use('/api/internal/chat/pages', internalChatPagesRoutes);

// --- Internal Chat model menu (CRON_SECRET auth, called by the web's Chat) ---
// Each offered model's multiplier against Auto and whether the catalog still
// lists it, from the daily price sync; never a price (routes/internalChatModels.js).
app.use('/api/internal/chat/models', internalChatModelsRoutes);

// --- Internal Chat go-live (CRON_SECRET auth, called by the web's Chat engine) ---
// An agent's going-live step on its own (AUTONOMOUS-GO-LIVE §5.4): every
// condition checked again here, then the page sent as the run's person
// (routes/internalChatGoLive.js).
app.use('/api/internal/chat/go-live', internalChatGoLiveRoutes);

// --- Internal Improve send endpoint (CRON_SECRET auth, called by web MCP layer) ---
// The web MCP layer verifies the caller's `getcito_` API key org owns the prompt
// before reaching here and passes the key's user, so this endpoint trusts the
// secret, checks the user's plan includes prompt_improve and creates the
// Action Center action exactly as the Improve tab's "Send Actions" does.
// Never on a demo brand's prompt (00380).
app.post('/api/internal/prompts/:promptId/improve/action', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { userId, ...body } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }
    if (await isDemoBrandRow('prompts', req.params.promptId)) {
      return res.status(402).json(DEMO_BRAND);
    }
    const result = await sendImproveActionForKeyUser({
      promptId: req.params.promptId,
      userId,
      body,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    // PlanLimitError (plan without prompt_improve / inactive subscription)
    // carries a statusCode — surface it so the MCP layer can relay it.
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'plan_limit', message: err.message });
    }
    if (err.status) {
      return res
        .status(err.status)
        .json({ success: false, message: err.message, details: err.details });
    }
    req.log.error({ err }, 'internal improve send error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal publish endpoint (CRON_SECRET auth, called by web MCP layer) ---
// A page marked Published at its live address for an MCP API key
// (`mark_content_draft_published`), as the editor's Mark published does
// (POST /api/content-drafts/:draftId/publish). The web MCP layer passes the
// key's organization and user; the draft must be that organization's. Never
// on a demo brand's draft (00380).
const internalPublishBody = z.object({
  url: z.string().max(8192),
  userId: z.guid(),
  orgId: z.guid(),
});

app.post('/api/internal/content-drafts/:draftId/publish', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const draftId = z.guid().safeParse(req.params.draftId);
  const body = internalPublishBody.safeParse(req.body ?? {});
  if (!draftId.success || !body.success) {
    return res.status(400).json({ success: false, code: 'invalid', message: 'Invalid request' });
  }
  const url = liveAddress(body.data.url);
  if (!url) {
    return res.status(400).json({
      success: false,
      code: 'invalid_url',
      message: 'Give the http(s) address the page is live at, with no sign-in details.',
    });
  }
  try {
    if (await isDemoBrandRow('content_drafts', draftId.data)) {
      return res.status(402).json(DEMO_BRAND);
    }
    const result = await publishDraftForKeyUser({
      draftId: draftId.data,
      url,
      userId: body.data.userId,
      orgId: body.data.orgId,
    });
    if (!result) {
      return res
        .status(404)
        .json({ success: false, code: 'not_found', message: 'Draft not found' });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    req.log.error({ err: { name: err?.name } }, 'internal content draft publish error');
    return res
      .status(500)
      .json({ success: false, message: 'The page could not be marked published' });
  }
});

// --- Internal citation-recount endpoint (CRON_SECRET auth, called by the web
// layer whenever a brand's domain list changes) ---
// Recomputes prompt_results.citation_count for the brand against its current
// domain list so the stored tally never diverges from the Citations page's
// live classification. See lib/citationRecount.js.
app.post('/api/internal/recount-citations', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { brandId } = req.body || {};
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    const result = await recountBrandCitations(brandId);
    return res.json({ success: true, ...result });
  } catch (err) {
    req.log.error({ err, brandId }, 'internal recount-citations error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal trigger-tracking endpoint (routes/internalTriggerTracking.js) ---
// The first run after a payment, and the brand's volume analysis with it.
app.use('/api/internal/trigger-tracking', internalTriggerTrackingRoutes);

// --- Cloro webhook callback (routes/cloroCallback.js) ---
// After the raw body parser mounted for this path at the top.
app.use('/cloro/callback', cloroCallbackRoutes);

// Public, webhook-secret-authenticated status callback for external workflows.
// It is mounted outside /api so no dashboard JWT is required; the router has its own stricter limiter.
app.use('/webhooks/content', webhookContentCallbackRoutes);
app.use('/webhooks/content-drafts', webhookContentDraftCallbackRoutes);

// --- Authenticated API routes ---
// The demo brand is read-only (middleware/demoBrand.js), and so is a
// workspace whose plan has ended (middleware/subscription.js): both checked
// once the person is known, before any route, the demo brand first so its
// answer is the same with a plan or without one. The webhooks, callbacks and
// internal endpoints above never reach them. Each request keeps its own
// store (lib/requestScope.js): the caller's brand access is read once,
// until the response ends.
app.use(
  '/api',
  requestScope,
  Middleware.decodeToken.bind(Middleware),
  refuseDemoBrandWrites,
  requireActiveSubscription,
  routes,
);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'aeo-server',
    mode: process.env.IS_CLOUD === 'true' ? 'cloud' : 'self-hosted',
    timestamp: new Date().toISOString(),
  });
});

// --- Global error handler ---
app.use((err, req, res, _next) => {
  // Module logger, not req.log: an error thrown before requestIdMiddleware
  // (e.g. in the public traffic routes or body parser) has no req.log.
  logger.error({ err }, 'unhandled error');
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
  });
});

// --- Start ---
const PORT = process.env.PORT || 80;

server.listen(PORT, async () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, 'server running');

  // Startup job maintenance acts on every job in the database: it fails all
  // 'active' jobs as interrupted, deletes old Cloro tasks and takes over
  // 'waiting' jobs. Only the deployed server owns those. A development
  // server pointed at the production database (nodemon restarting on every
  // save) was failing the live nightly runs in the middle of their work.
  // Keyed on 'development' rather than on 'production', so a deployment
  // whose env file leaves NODE_ENV unset still runs it.
  if (process.env.NODE_ENV === 'development') {
    logger.info('development: skipping job cleanup, recovery and the daily cron');
    return;
  }

  await cleanupStaleJobs();
  await cleanupStalePendingTasks();

  // The job queue lives in memory: restart waiting jobs whose run chain was
  // lost (a restart, an error before they got a slot), now and every minute.
  const recover = () =>
    recoverWaitingJobs(io).catch((err) => logger.error({ err }, 'waiting-job recovery failed'));
  await recover();
  setInterval(recover, 60_000);

  // Rebuild the citation rollups of brands whose prompts changed topic
  // (00118), and the Insights days of deleted prompts (00192), within
  // minutes, not at the nightly sweep. An empty queue costs one select, and
  // each function refuses to overlap with a run of its own still in progress.
  cron.schedule(REBUILD_QUEUE_SCHEDULE, () => {
    rebuildQueuedCitationRollups().catch((err) =>
      logger.error({ err }, '[citations-rollups] scheduled rebuild crashed'),
    );
    rebuildQueuedInsightsRollups().catch((err) =>
      logger.error({ err }, '[insights-rollups] scheduled rebuild crashed'),
    );
  });

  // Chat's model prices, from OpenRouter's public catalog, daily (CHAT-16 §A):
  // only with the new Chat on. Off, nothing is fetched and every cost is
  // read from improveCost.js's own table, as before.
  if (chatAgenticDeployed()) {
    startModelPriceSync().catch((err) => logger.error({ err }, '[model-prices] start failed'));
    // Daily suggestions in Chat's Inbox (CHAT-26): every hour, one open
    // Action Center action for each person whose morning it is, by rules
    // and with no AI call.
    startDailySuggestions();
    // Chat's agents (W2-16): every minute the web fires due schedules and sweeps.
    startChatAgentTicks();
    // The impact ledger (CHAT-22 §2): each shipped change measured at 7,
    // 14, 30 and 90 days against a control set, nightly, from the Insights
    // rollups only (no engine query, no model call).
    startImpactLedger();
  }

  if (!isCloud()) {
    const schedule = process.env.DAILY_CRON_SCHEDULE || '0 6 * * *';
    cron.schedule(schedule, async () => {
      logger.info('self-hosted daily tracking triggered');
      try {
        await runDailyTracking();
        await cleanupOldJobs();
      } catch (err) {
        logger.error({ err }, 'self-hosted daily tracking failed');
      }
    });
    logger.info({ schedule }, 'self-hosted daily cron active');
  }
});

export { app, server, io };
