/**
 * The daily auto-audit sweep (SA-006). For each organization whose run is
 * due, it claims the run (one site_audit_auto_runs row per org, period and
 * run day, so a second sweep the same day does nothing), audits the pages
 * its brands' Site Audit fixes were completed on and not audited or tried
 * since (learning B7), then the top pages of their Opportunities inboxes,
 * and once every audit has finished, records the run and, when the team
 * asked for it, e-mails them.
 *
 * The inbox read and the audit start live in routes/audits.js; they're
 * passed in, so this module doesn't import a route (and tests stand them in).
 */

import supabaseAdmin from '../../config/supabase.js';
import { getSiteAuditQuotaStatus, PlanLimitError } from '../planGuard.js';
import { readAllRpcRows } from '../rpcPages.js';
import { logger } from '../logger.js';
import { AUTO_AUDIT, pickRunPages, runPageKey } from './autoAudit.js';
import { sendAutoAuditEmail } from './autoAuditEmail.js';
import { excludePatternMatcher, opportunityKey } from './opportunities.js';
import { pageKey } from './history.js';
import { onBrandDomain } from './host.js';

/**
 * @typedef {object} SweepDeps
 * @property {(brandId: string) => Promise<{ opportunities: object[] }>} readInbox
 * @property {(brandId: string, urls: string[], orgId: string) => Promise<{ auditIds: string[], done: Promise<unknown> }>} startAudits
 * @property {Date} [now]
 * @property {string[]} [orgIds]  only these organizations (the manual script)
 */

/**
 * Start every due run; resolves when they have all finished.
 *
 * @param {SweepDeps} deps
 * @returns {Promise<{ runs: number }>}
 */
export async function sweepAutoAudits({ readInbox, startAudits, now = new Date(), orgIds }) {
  const { data: brands, error } = await readAllRpcRows('brands', (from, to) => {
    let query = supabaseAdmin
      .from('brands')
      .select('id, name, organization_id')
      .eq('is_active', true)
      // A demo brand's site (00380) is a `.example` domain: never audited.
      .eq('is_demo', false);
    if (orgIds) query = query.in('organization_id', orgIds);
    return query.order('id', { ascending: true }).range(from, to);
  });
  if (error) throw new Error(error.message);

  const byOrg = new Map();
  const seen = new Set();
  for (const brand of brands ?? []) {
    // A slice boundary can repeat a row (rpcPages.js).
    if (!brand.organization_id || seen.has(brand.id)) continue;
    seen.add(brand.id);
    if (!byOrg.has(brand.organization_id)) byOrg.set(brand.organization_id, []);
    byOrg.get(brand.organization_id).push(brand);
  }

  // Runs are started one org at a time, then finish together: their audits
  // share the auto pool, so starting is quick and finishing is not.
  const finishing = [];
  for (const [orgId, orgBrands] of byOrg) {
    try {
      const run = await startRun(orgId, orgBrands, { readInbox, startAudits, now });
      if (run) finishing.push(run.finished);
    } catch (err) {
      logger.error({ err, orgId }, '[auto-audit] run failed to start');
    }
  }
  await Promise.all(finishing);
  return { runs: finishing.length };
}

/**
 * Claim and start the org's due run. Returns { finished }, a promise that
 * settles once the run is recorded (wrapped, so awaiting the start doesn't
 * wait for it), or null when nothing is due.
 */
async function startRun(orgId, brands, { readInbox, startAudits, now }) {
  let quota;
  try {
    quota = await getSiteAuditQuotaStatus(orgId, { now });
  } catch (err) {
    // An org without an active subscription has nothing to run.
    if (err instanceof PlanLimitError) return null;
    throw err;
  }
  const { auto } = quota;
  if (!auto.enabled || !auto.due) return null;

  // The run's share, or what's left of the whole quota when that's less.
  const free = quota.limit === -1 ? auto.perRun : quota.limit - quota.used - quota.running;
  const slots = Math.max(0, Math.min(auto.perRun, free));

  const { data: claimed, error } = await supabaseAdmin
    .from('site_audit_auto_runs')
    .upsert(
      {
        organization_id: orgId,
        period_start: auto.periodStart,
        run_day: auto.due.day,
        slots,
        started_at: now.toISOString(),
      },
      { onConflict: 'organization_id,period_start,run_day', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(error.message);
  const runId = claimed?.[0]?.id;
  // Another sweep claimed it first.
  if (!runId) return null;

  const inboxes = [];
  let triedKeys = new Set();
  let fixed = [];
  if (slots > 0) {
    triedKeys = await recentlyTriedPages(brands, now);
    // Pages fixed since their last audit come first (learning B7). A read
    // that fails leaves the run to the inboxes, as before.
    fixed = await fixedPages(brands, now).catch((err) => {
      logger.warn({ err, orgId }, '[auto-audit] fixed pages not read');
      return [];
    });
    for (const brand of brands) {
      try {
        const { opportunities } = await readInbox(brand.id);
        inboxes.push({ brandId: brand.id, opportunities });
      } catch (err) {
        logger.warn({ err, orgId, brandId: brand.id }, '[auto-audit] inbox read failed');
      }
    }
  }
  const pages = pickRunPages(inboxes, slots, now, triedKeys, fixed);

  const auditIds = [];
  const audits = [];
  for (const brand of brands) {
    const urls = pages.filter((p) => p.brandId === brand.id).map((p) => p.url);
    if (urls.length === 0) continue;
    try {
      const started = await startAudits(brand.id, urls, orgId);
      auditIds.push(...started.auditIds);
      audits.push(started.done);
    } catch (err) {
      // The quota filled up meanwhile (a user's audits): the run keeps what it started.
      logger.warn({ err, orgId, brandId: brand.id }, '[auto-audit] audits not started');
    }
  }
  if (auditIds.length > 0) {
    const { error: idsErr } = await supabaseAdmin
      .from('site_audit_auto_runs')
      .update({ audit_ids: auditIds })
      .eq('id', runId);
    if (idsErr) throw new Error(idsErr.message);
  }

  const nextRunAt = auto.runs.find((r) => r.day > auto.due.day)?.at ?? auto.periodEnd;
  const finished = Promise.all(audits)
    .then(() =>
      finishRun({ runId, orgId, brands, auditIds, emailAfterRun: auto.emailAfterRun, nextRunAt }),
    )
    .catch((err) => logger.error({ err, orgId, runId }, '[auto-audit] run failed to finish'));
  return { finished };
}

/** Pages the org's runs audited in the last 30 days, completed or not. */
async function recentlyTriedPages(brands, now) {
  const since = new Date(now.getTime() - AUTO_AUDIT.freshDays * 24 * 60 * 60 * 1000);
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('url')
    .in(
      'brand_id',
      brands.map((b) => b.id),
    )
    .eq('source', 'auto')
    .gte('created_at', since.toISOString());
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => opportunityKey(row.url)).filter(Boolean));
}

/**
 * Pages one fix action offers at most, of those still due (its others are
 * left out first): a run takes few anyway.
 */
const FIXED_PER_ACTION = 20;

/**
 * Pages a Site Audit fix (an Action Center action of the fix category) was
 * completed on in the last 30 days and that no audit has read or tried
 * since (any audit of the brand's, finished or not), the most recently
 * fixed first (learning B7). Its targets name the pages, by their
 * addresses, on the action's brand's own domains and not left out of
 * auto-audits (excluded, or under an exclude pattern and not pinned); one
 * fixed twice counts from its last fix.
 *
 * @returns {Promise<Array<{ brandId: string, key: string, url: string, path: string }>>}
 */
export async function fixedPages(brands, now) {
  const since = new Date(now.getTime() - AUTO_AUDIT.freshDays * 24 * 60 * 60 * 1000);
  const brandIds = brands.map((b) => b.id);
  const { data: actions, error } = await supabaseAdmin
    .from('actions')
    .select('brand_id, payload, completed_at')
    .in('brand_id', brandIds)
    .eq('status', 'completed')
    .eq('category', 'fix')
    .is('deleted_at', null)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  if (!actions?.length) return [];

  // Only a brand's own pages: a fix's target on another site (a
  // competitor's page, say) costs an audit and says nothing of the fix. A
  // brand without a domain has none. Nor the pages the team left out of
  // Opportunities and auto-audits: excluded ones, and those under the
  // brand's exclude patterns unless pinned, as the inbox does.
  const [domainRows, prefRows, settingRows] = await Promise.all([
    supabaseAdmin.from('brand_domains').select('brand_id, domain').in('brand_id', brandIds),
    readAllRpcRows('site_audit_page_prefs', (from, to) =>
      supabaseAdmin
        .from('site_audit_page_prefs')
        .select('brand_id, page_key, state')
        .in('brand_id', brandIds)
        .order('brand_id', { ascending: true })
        .order('page_key', { ascending: true })
        .range(from, to),
    ),
    supabaseAdmin
      .from('site_audit_brand_settings')
      .select('brand_id, exclude_patterns')
      .in('brand_id', brandIds),
  ]);
  for (const read of [domainRows, prefRows, settingRows]) {
    if (read.error) throw new Error(read.error.message);
  }
  const domains = new Map();
  for (const row of domainRows.data ?? []) {
    if (!domains.has(row.brand_id)) domains.set(row.brand_id, []);
    domains.get(row.brand_id).push(row.domain);
  }
  const prefs = new Map(
    (prefRows.data ?? []).map((row) => [runPageKey(row.brand_id, row.page_key), row.state]),
  );
  const excludedByPattern = new Map(
    (settingRows.data ?? []).map((row) => [
      row.brand_id,
      excludePatternMatcher(row.exclude_patterns ?? []),
    ]),
  );
  const leftOut = (brandId, key, path) => {
    const state = prefs.get(runPageKey(brandId, key));
    if (state === 'excluded') return true;
    return state !== 'pinned' && Boolean(excludedByPattern.get(brandId)?.(path));
  };

  // By the brand's page (runPageKey): brands sharing a domain fix their own.
  const pages = new Map();
  for (const [index, action] of actions.entries()) {
    const own = domains.get(action.brand_id) ?? [];
    const p = action.payload ?? {};
    const urls = [
      ...(Array.isArray(p.targets) ? p.targets.map((t) => t?.id) : []),
      ...(Array.isArray(p.targetIds) ? p.targetIds : []),
    ].filter(
      (url) => typeof url === 'string' && /^https?:\/\//i.test(url) && onBrandDomain(url, own),
    );
    for (const url of urls) {
      const key = opportunityKey(url);
      const id = key ? runPageKey(action.brand_id, key) : null;
      // Newest fix first: the first one read for a page is its last.
      if (!id || pages.has(id)) continue;
      const path = pageKey(url)?.path ?? '/';
      if (leftOut(action.brand_id, key, path)) continue;
      pages.set(id, {
        brandId: action.brand_id,
        key,
        url,
        path,
        fixedAt: Date.parse(action.completed_at),
        action: index,
      });
    }
  }
  if (pages.size === 0) return [];

  // The audits since the oldest of those fixes, by the address asked for or
  // ended at: the brand's own, as the action's result reads them (A2). Every
  // one, past PostgREST's 1000-row page: a busy month has more.
  const oldest = [...pages.values()].reduce((min, page) =>
    page.fixedAt < min.fixedAt ? page : min,
  ).fixedAt;
  const { data: audits, error: auditsErr } = await readAllRpcRows('site_audits', (from, to) =>
    supabaseAdmin
      .from('site_audits')
      .select('brand_id, url, final_url, created_at')
      .in('brand_id', brandIds)
      .gte('created_at', new Date(oldest).toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (auditsErr) throw new Error(auditsErr.message);
  const lastAudit = new Map();
  for (const audit of audits ?? []) {
    for (const url of [audit.url, audit.final_url]) {
      const key = url ? opportunityKey(url) : null;
      const id = key ? runPageKey(audit.brand_id, key) : null;
      const at = Date.parse(audit.created_at);
      if (id && !(lastAudit.get(id) >= at)) lastAudit.set(id, at);
    }
  }
  // The pages still due, each fix's first FIXED_PER_ACTION of them.
  const perAction = new Map();
  const due = [];
  for (const [id, page] of pages) {
    if (lastAudit.get(id) >= page.fixedAt) continue;
    const taken = perAction.get(page.action) ?? 0;
    if (taken >= FIXED_PER_ACTION) continue;
    perAction.set(page.action, taken + 1);
    due.push({ brandId: page.brandId, key: page.key, url: page.url, path: page.path });
  }
  return due;
}

/** Record the finished run and, when the org asked for it, e-mail what it found. */
async function finishRun({ runId, orgId, brands, auditIds, emailAfterRun, nextRunAt }) {
  const { data: rows, error } = auditIds.length
    ? await supabaseAdmin.from('site_audits').select('id, brand_id, status').in('id', auditIds)
    : { data: [], error: null };
  if (error) throw new Error(error.message);

  const perBrand = [];
  for (const brand of brands) {
    const own = (rows ?? []).filter((r) => r.brand_id === brand.id);
    if (own.length === 0) continue;
    const completed = own.filter((r) => r.status === 'completed').map((r) => r.id);
    let criticalIssues = 0;
    if (completed.length > 0) {
      // Critical issues: the signals the audits failed.
      const { count, error: countErr } = await supabaseAdmin
        .from('audit_signal_results')
        .select('audit_id', { count: 'exact', head: true })
        .in('audit_id', completed)
        .eq('status', 'fail');
      if (countErr) throw new Error(countErr.message);
      criticalIssues = count ?? 0;
    }
    perBrand.push({
      id: brand.id,
      name: brand.name,
      pages: own.length,
      completed: completed.length,
      criticalIssues,
    });
  }

  const { error: doneErr } = await supabaseAdmin
    .from('site_audit_auto_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', runId);
  if (doneErr) throw new Error(doneErr.message);

  const emailed =
    emailAfterRun && perBrand.length > 0
      ? await sendAutoAuditEmail(orgId, { brands: perBrand, nextRunAt })
      : false;
  logger.info({ orgId, runId, brands: perBrand, emailed }, '[auto-audit] run finished');
}
