/**
 * An agent's going-live step on its own (AUTONOMOUS-GO-LIVE §5.4, PR 4), for
 * the web's Chat engine: a triggered agent run has no one's session, so the
 * engine asks the server to send the page as the person the run acts as.
 * Server to server: CRON_SECRET auth, as the other internal endpoints.
 *
 * POST /api/internal/chat/go-live/send
 *   { orgId, agentRunId, runId, actingUserId, draftId, target, kind,
 *     reservationId, page }
 *   The engine reserved the step's slot first (reserve_agent_go_live, 00443).
 *   Everything is checked again here, from the database, so a fault in the
 *   web's precedence alone can't put anything live:
 *     - Chat is on for the workspace, its plan allows Full auto (Growth and
 *       up, paid, active), and Admins turned publishing on its own on
 *       (chat_settings.auto_go_live_groups);
 *     - the agent run is the workspace's, running, and acts as actingUserId;
 *       its agent was allowed for the run's version (chat_agent_go_live);
 *     - that person is still an Admin or a Manager of the workspace (and
 *       publishing isn't off for Managers), reaches the draft's brand, and
 *       the brand isn't the demo's;
 *     - the reservation is this step's: reserved for this run, draft and
 *       target, or done for them in the last 24 hours (a send again takes
 *       no second slot). A page taken down doesn't go out again on its own.
 *   Then the page goes as a person's Send to CMS does (sendContentPages),
 *   with the agent run kept on the delivery (00444), and the step is
 *   finished: done, or failed with why, which frees its slot. Never retried.
 *   Done, the agent's owner and Notify people are told (Inbox and e-mail,
 *   lib/chat-notices/goLive.js, 00446), after the answer is on its way.
 *   → 200 { delivery }: the send's row as the Send dialog reads it.
 *   → 403 { code }: a check failed (chat_off, plan, switch_off, permission,
 *     role, publishing_off, brand, demo_brand, reservation); nothing sent.
 *   → 404 { code: 'not_found' }: the run or the draft isn't there.
 *   → 409, 422, 429, 502 { code }: the send's own refusal (sendContentPages).
 *   `kind: 'publish'` (PR 9) puts a new page live in Webflow, WordPress or
 *   Wix (lib/cmsPublish.js): live already → 409 live_item, Framer → 409
 *   framer_site_publish, a publish the CMS refused → 502 publish_refused.
 *
 * POST /api/internal/chat/go-live/quality-reads
 *   { orgId, agentRunId, runId, actingUserId, draftId, sites }
 *   Content Quality's reads of the draft as saved, for the web's go-live gate
 *   (§6.2, the owner's 2026-11-02 decision): its links (linkCheck.js, the
 *   acting person's hourly reads), and with Quality's phase 2 its claims,
 *   its page read and the kinds of `sites` (the sites the gate's rules
 *   can't place, among those the draft links). A read the draft has kept
 *   costs nothing; a new one is the agent run's own step (feature agent,
 *   within its cap and the month's budget: chat-budget agentRunReserve), not
 *   the workspace's Quality budget. With them, the brand's facts (phase 2)
 *   and its site's trust, as the editor reads them. Each read answers on its
 *   own, so one that fails leaves the others:
 *   { links, claims, page, classes, facts, siteTrust }, each
 *   { ok: true, value } or { ok: false, code } (run_cap, ai_budget, off,
 *   failed); the gate holds the page on any it needs that failed.
 *   → 403 { code } for the run checks (chat_off, permission, role, brand,
 *     demo_brand); 404 for a run or draft that isn't the workspace's.
 */

import { Router } from 'express';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { isCloud } from '../config/plans.js';
import { brandAccessOf } from '../lib/access.js';
import { chatAgenticEnabled } from '../lib/chatFlag.js';
import { DeliveryError, deliveryPage, sendContentPages } from '../lib/contentDelivery.js';
import { publishContentPage } from '../lib/cmsPublish.js';
import { isDemoBrand } from '../middleware/demoBrand.js';
import { ChatBudgetError, agentRunReserve } from '../lib/chatBudget.js';
import { readBrandFacts } from '../lib/brandFacts.js';
import { tellWentLive } from '../lib/chat-notices/goLive.js';
import { pageReadContext } from '../lib/contentPageContext.js';
import { qualityPhase } from '../lib/contentQuality.js';
import { readDraftClaims } from '../lib/contentQualityClaims.js';
import { readPage } from '../lib/contentQualityPage.js';
import { MAX_SOURCE_SITES, linkedSites, readSourceClasses } from '../lib/contentSourceClass.js';
import { checkLinks, reserveReads } from '../lib/linkCheck.js';
import { PlanLimitError } from '../lib/planGuard.js';
import { readSiteTrust } from '../lib/siteTrust.js';
import { webhookSecretsMatch } from '../lib/webhookSecret.js';
import logger from '../lib/logger.js';

const router = Router();

// The secret is compared in constant time (webhookSecretsMatch), as the budget's endpoints do.
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  const secret = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!webhookSecretsMatch(process.env.CRON_SECRET, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** The go-live group a CMS send belongs to (chat_settings.auto_go_live_groups). */
const GROUP = 'publishing';
/** How far back a step done for the same draft and target lets it go again with no new slot. */
const SLOT_WINDOW_MS = 24 * 60 * 60 * 1000;

const sendSchema = z.strictObject({
  orgId: z.guid(),
  agentRunId: z.guid(),
  runId: z.guid(),
  actingUserId: z.guid(),
  draftId: z.guid(),
  target: z.enum(['webflow', 'wordpress', 'framer', 'wix']),
  kind: z.enum(['cms_draft', 'publish']),
  reservationId: z.guid(),
  page: deliveryPage,
});

/**
 * A check that failed: nothing is sent. `free`: the slot was reserved for
 * this very step, so it is released; another step's is never touched.
 */
class Refused extends Error {
  constructor(code, { status = 403, free = false } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.free = free;
  }
}

/** Full auto's plan rule, as the web's plan facts have it: Growth and up, paid, active. */
function planAllows(org) {
  if (!isCloud()) return true;
  const status = org?.subscription_status;
  if (status !== 'active' && status !== 'trialing') return false;
  // A trial doesn't open Full auto; an Enterprise trial is a deal's and keeps its plan.
  if (status === 'trialing' && org?.plan !== 'enterprise') return false;
  return org?.plan === 'growth' || org?.plan === 'enterprise';
}

async function one(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Every condition of §5.4, read fresh. Returns the draft's brand. */
async function checkStep(body) {
  const step = await one(
    supabaseAdmin
      .from('chat_agent_go_live_events')
      .select(
        'id, organization_id, agent_id, agent_run_id, content_draft_id, target, kind, status, created_at',
      )
      .eq('id', body.reservationId),
  );
  // Reserved for this run, draft, target and kind: a refusal frees it.
  const free =
    step?.status === 'reserved' &&
    step.organization_id === body.orgId &&
    step.agent_run_id === body.agentRunId &&
    step.content_draft_id === body.draftId &&
    step.target === body.target &&
    step.kind === body.kind;
  const refuse = (code, status = 403) => new Refused(code, { status, free });

  if (!chatAgenticEnabled(body.orgId)) throw refuse('chat_off');
  const [org, settings, run, access, draft] = await Promise.all([
    one(
      supabaseAdmin.from('organizations').select('plan, subscription_status').eq('id', body.orgId),
    ),
    one(
      supabaseAdmin
        .from('chat_settings')
        .select('auto_go_live_groups, manager_execute_off')
        .eq('organization_id', body.orgId),
    ),
    one(
      supabaseAdmin
        .from('chat_agent_runs')
        .select('id, agent_id, agent_version, acting_user_id, status')
        .eq('id', body.agentRunId)
        .eq('organization_id', body.orgId),
    ),
    brandAccessOf(body.actingUserId),
    one(
      supabaseAdmin
        .from('content_drafts')
        .select('id, brand_id, archived_at, brands!inner(organization_id)')
        .eq('id', body.draftId)
        .eq('brands.organization_id', body.orgId),
    ),
  ]);
  if (!planAllows(org)) throw refuse('plan');
  if (!(settings?.auto_go_live_groups ?? []).includes(GROUP)) throw refuse('switch_off');
  if (!run) throw refuse('not_found', 404);
  if (run.status !== 'running' || run.acting_user_id !== body.actingUserId || !run.agent_id) {
    throw refuse('permission');
  }
  const allowed = await one(
    supabaseAdmin
      .from('chat_agent_go_live')
      .select('version')
      .eq('agent_id', run.agent_id)
      .eq('organization_id', body.orgId),
  );
  if (!allowed || allowed.version !== run.agent_version) throw refuse('permission');
  if (access.orgId !== body.orgId || !['admin', 'manager'].includes(access.role)) {
    throw refuse('role');
  }
  if (access.role === 'manager' && (settings?.manager_execute_off ?? []).includes(GROUP)) {
    throw refuse('publishing_off');
  }
  if (!draft || draft.archived_at) throw refuse('not_found', 404);
  if (!access.all && !access.brandIds.has(draft.brand_id)) throw refuse('brand');
  if (await isDemoBrand([draft.brand_id])) throw refuse('demo_brand');
  // A page someone took down never goes live on its own again (PR 10): a click does it.
  if (await takenDown(body.draftId)) throw refuse('taken_down', 409);
  if (!reservationFits(step, body, run.agent_id)) throw refuse('reservation');
  return draft.brand_id;
}

/** Whether a send of the draft was taken down (00460). */
async function takenDown(draftId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id')
    .eq('draft_id', draftId)
    .eq('status', 'taken_down')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** The step's slot: reserved for this run, draft and target, or done for them lately. */
function reservationFits(step, body, agentId) {
  const same =
    step &&
    step.organization_id === body.orgId &&
    step.agent_id === agentId &&
    step.content_draft_id === body.draftId &&
    step.target === body.target;
  if (!same) return false;
  if (step.status === 'reserved') {
    return step.agent_run_id === body.agentRunId && step.kind === body.kind;
  }
  // A send again within the window takes no second slot; one taken down never goes on its own.
  return step.status === 'done' && Date.now() - Date.parse(step.created_at) < SLOT_WINDOW_MS;
}

/** How the step ended; a failed one frees its slot. Only a reserved step changes. */
async function finishStep(
  id,
  status,
  { deliveryId = null, externalId = null, publishedUrl = null, error = null },
) {
  const { error: rpcError } = await supabaseAdmin.rpc('finish_agent_go_live', {
    p_id: id,
    p_status: status,
    p_delivery_id: deliveryId,
    p_published_url: publishedUrl,
    p_external_id: externalId,
    p_error: error,
  });
  if (rpcError) throw new Error(rpcError.message);
}

router.post('/send', async (req, res) => {
  const parsed = sendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'invalid', message: 'Invalid request' });
  }
  const body = parsed.data;
  if (body.page.draftId !== body.draftId) {
    return res.status(400).json({ success: false, code: 'invalid', message: 'Invalid request' });
  }
  let brandId;
  try {
    brandId = await checkStep(body);
  } catch (err) {
    if (err instanceof Refused) {
      // Nothing went: this step's own slot is freed for another.
      if (err.free) {
        await finishStep(body.reservationId, 'failed', { error: `refused: ${err.code}` }).catch(
          (finishErr) => req.log.error({ err: finishErr }, 'internal go-live finish error'),
        );
      }
      return res.status(err.status).json({ success: false, code: err.code });
    }
    req.log.error({ err }, 'internal go-live check error');
    return res.status(500).json({ success: false, code: 'failed', message: 'Internal error' });
  }

  try {
    const step = {
      orgId: body.orgId,
      brandId,
      userId: body.actingUserId,
      target: body.target,
      agentRunId: body.agentRunId,
    };
    // A CMS draft is a send; a publish writes the checked page into it, then puts it live.
    const delivery =
      body.kind === 'publish'
        ? (await publishContentPage({ ...step, page: body.page })).delivery
        : ((await sendContentPages({ ...step, pages: [body.page] })).deliveries[0] ?? null);
    const done = delivery && delivery.status !== 'failed';
    await finishStep(body.reservationId, done ? 'done' : 'failed', {
      deliveryId: delivery?.id ?? null,
      externalId: delivery?.external_id ?? null,
      publishedUrl: delivery?.published_url ?? null,
      error: done ? null : (delivery?.error ?? 'Not sent'),
    }).catch((err) => req.log.error({ err }, 'internal go-live finish error'));
    res.json({ success: true, delivery });
    // Who should know it went out on its own: never on the step's way.
    if (done) {
      await tellWentLive({ eventId: body.reservationId }).catch((err) =>
        logger.error({ err, eventId: body.reservationId }, 'internal go-live notice error'),
      );
    }
    return undefined;
  } catch (err) {
    const known = err instanceof DeliveryError;
    await finishStep(body.reservationId, 'failed', {
      error: known ? err.message : 'The page could not be sent',
    }).catch((finishErr) => req.log.error({ err: finishErr }, 'internal go-live finish error'));
    if (known) {
      return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    }
    req.log.error({ err }, 'internal go-live send error');
    return res.status(502).json({ success: false, code: 'failed', message: 'Not sent' });
  }
});

const readsSchema = z.strictObject({
  orgId: z.guid(),
  agentRunId: z.guid(),
  runId: z.guid(),
  actingUserId: z.guid(),
  draftId: z.guid(),
  sites: z.array(z.string().trim().toLowerCase().min(1).max(300)).max(MAX_SOURCE_SITES).default([]),
});

/** The run a gate reads for: running, as this person, in the workspace; the draft, theirs to read. */
async function checkReads(body) {
  if (!chatAgenticEnabled(body.orgId)) throw new Refused('chat_off');
  const [run, access, draft] = await Promise.all([
    one(
      supabaseAdmin
        .from('chat_agent_runs')
        .select('id, acting_user_id, status')
        .eq('id', body.agentRunId)
        .eq('organization_id', body.orgId),
    ),
    brandAccessOf(body.actingUserId),
    one(
      supabaseAdmin
        .from('content_drafts')
        .select(
          'id, brand_id, body_html, page_type, kept_sources, archived_at, brands!inner(organization_id)',
        )
        .eq('id', body.draftId)
        .eq('brands.organization_id', body.orgId),
    ),
  ]);
  if (!run) throw new Refused('not_found', { status: 404 });
  if (run.status !== 'running' || run.acting_user_id !== body.actingUserId) {
    throw new Refused('permission');
  }
  if (access.orgId !== body.orgId || !['admin', 'manager'].includes(access.role)) {
    throw new Refused('role');
  }
  if (!draft || draft.archived_at) throw new Refused('not_found', { status: 404 });
  if (!access.all && !access.brandIds.has(draft.brand_id)) throw new Refused('brand');
  if (await isDemoBrand([draft.brand_id])) throw new Refused('demo_brand');
  return draft;
}

/** One read's answer: its value, or why it couldn't be read. */
async function settle(read) {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    if (err instanceof ChatBudgetError && err.code === 'run_cap') {
      return { ok: false, code: 'run_cap' };
    }
    if (err instanceof PlanLimitError) return { ok: false, code: 'ai_budget' };
    logger.warn(
      { err: { name: err?.name, message: err?.message } },
      '[go-live] a quality read failed',
    );
    return { ok: false, code: 'failed' };
  }
}

const OFF = { ok: false, code: 'off' };

router.post('/quality-reads', async (req, res) => {
  const parsed = readsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'invalid', message: 'Invalid request' });
  }
  const body = parsed.data;
  let draft;
  try {
    draft = await checkReads(body);
  } catch (err) {
    if (err instanceof Refused)
      return res.status(err.status).json({ success: false, code: err.code });
    req.log.error({ err }, 'internal go-live reads check error');
    return res.status(500).json({ success: false, code: 'failed', message: 'Internal error' });
  }

  const html = draft.body_html ?? '';
  const $ = cheerio.load(html);
  const hrefs = $('a[href]')
    .map((_, el) => $(el).attr('href'))
    .get();
  const reserve = agentRunReserve(body.orgId, {
    runId: body.runId,
    agentRunId: body.agentRunId,
  });
  const phase2 = qualityPhase() >= 2;
  // Only sites the draft links, and not one whose every link the person kept.
  const linked = linkedSites(hrefs);
  const kept = new Set(draft.kept_sources ?? []);
  const sites = [...new Set(body.sites)].filter(
    (site) => linked.has(site) && !linked.get(site).every((href) => kept.has(href)),
  );
  const common = { orgId: body.orgId, draftId: body.draftId };
  const [links, claims, page, classes, facts, siteTrust] = await Promise.all([
    settle(() =>
      checkLinks(hrefs, {
        reserve: (wanted) => reserveReads(body.actingUserId, wanted),
        log: req.log,
      }).then(({ reads, skipped }) => ({
        links: [...reads].map(([href, read]) => ({ href, ...read })),
        skipped,
      })),
    ),
    phase2 ? settle(() => readDraftClaims({ ...common, html, reserve })) : OFF,
    phase2
      ? settle(async () =>
          readPage({
            ...common,
            html,
            pageType: draft.page_type,
            ...(await pageReadContext(draft.brand_id)),
            reserve,
          }),
        )
      : OFF,
    phase2
      ? sites.length
        ? settle(() => readSourceClasses({ ...common, sites, reserve }))
        : { ok: true, value: { classes: [], limited: false } }
      : OFF,
    phase2 ? settle(() => readBrandFacts(draft.brand_id, { orgId: body.orgId })) : OFF,
    settle(() => readSiteTrust(draft.brand_id, { refresh: false, keptOnly: false })),
  ]);
  return res.json({ success: true, links, claims, page, classes, facts, siteTrust });
});

export default router;
