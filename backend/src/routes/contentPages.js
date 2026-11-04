import { Router } from 'express';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { onBrandDomain } from '../lib/audit/host.js';
import { MAX_SOURCE_SITES, linkedSites, readSourceClasses } from '../lib/contentSourceClass.js';
import { qualityPhase } from '../lib/contentQuality.js';
import { readDraftClaims } from '../lib/contentQualityClaims.js';
import { pageReadContext } from '../lib/contentPageContext.js';
import { readPage } from '../lib/contentQualityPage.js';
import { checkLinks, reserveReads } from '../lib/linkCheck.js';
import { MAX_CONTENT_LENGTH, extractPageContent } from '../lib/pageContent.js';
import { PageFetchError, fetchPage } from '../lib/safeFetch.js';
import { PlanLimitError } from '../lib/planGuard.js';
import {
  claimsLimiter,
  pageReadLimiter,
  linkCheckLimiter,
  qualityCheckLimiter,
} from '../middleware/rateLimiter.js';

/**
 * Pages brought into the Content Editor (CE-003): Optimize content › Page
 * URL, and Start's "Optimize this page instead". Only the brand's own pages
 * (its domains or their subdomains) are read: the editor optimizes the
 * brand's content, not anyone else's, and it keeps the fetch to sites the
 * brand named. The fetch itself refuses private addresses (safeFetch.js).
 */

const router = Router();

const importBody = z.object({
  // guid, not uuid: brand ids aren't all RFC 4122 versions (seeded ones).
  brandId: z.guid(),
  url: z.string().trim().min(1).max(2048),
});

/** The person-facing reason a page couldn't be read, by fetch error code. */
const FETCH_STATUS = {
  invalid_url: 400,
  blocked: 400,
  too_many_redirects: 422,
  not_html: 422,
  too_large: 422,
  too_deep: 422,
  http_error: 422,
  timeout: 504,
  unreachable: 502,
};

router.post('/import', async (req, res) => {
  const parsed = importBody.safeParse(req.body);
  if (!parsed.success) {
    const urlIssue = parsed.error.issues.some((issue) => issue.path[0] === 'url');
    return res.status(400).json({ error: 'invalid', code: urlIssue ? 'invalid_url' : 'invalid' });
  }
  const { brandId } = parsed.data;
  // A bare host ("acme.com/pricing") is read as https.
  const url = /^[a-z][a-z0-9+.-]*:/i.test(parsed.data.url)
    ? parsed.data.url
    : `https://${parsed.data.url}`;

  try {
    await assertBrandAccess(brandId, req.user.id);
    const { data: domains, error } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId);
    if (error) throw error;
    const brandDomains = (domains ?? []).map((d) => d.domain);
    if (!onBrandDomain(url, brandDomains)) {
      return res.status(400).json({ error: 'Not on the brand’s site', code: 'off_site' });
    }

    const page = await fetchPage(url);
    // A redirect off the brand's site isn't the brand's page.
    if (!onBrandDomain(page.url, brandDomains)) {
      return res.status(422).json({ error: 'The page redirects off the site', code: 'off_site' });
    }
    const content = extractPageContent(page.html, page.url);
    if (content.html.length > MAX_CONTENT_LENGTH) {
      return res.status(422).json({ error: 'The page is too large', code: 'too_large' });
    }
    return res.json({ url: page.url, title: content.title, html: content.html });
  } catch (err) {
    if (err instanceof PageFetchError) {
      return res
        .status(FETCH_STATUS[err.code] ?? 502)
        .json({ error: err.message, code: err.code, status: err.status ?? null });
    }
    if (err?.status === 403 || err?.status === 404) {
      return res.status(err.status).json({ error: err.message, code: 'forbidden' });
    }
    req.log.error({ err }, 'content page import error');
    return res.status(500).json({ error: 'Failed to read the page', code: 'failed' });
  }
});

const linksBody = z.object({ draftId: z.guid() });

/**
 * The links of a saved draft, for Quality's Trust (Quality spec §2.2):
 * whether each answers and how old its page is (linkCheck.js). Any member
 * of the draft's brand may ask; the links are read from the draft as saved,
 * never from the request, through the same guarded fetch, at most once a
 * day each and HOURLY_READS an hour per member (linkCheck.js). `skipped`
 * are the links it never reads (relative, one-time or account links).
 */
router.post('/links', linkCheckLimiter, async (req, res) => {
  const parsed = linksBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id, body_html')
      .eq('id', parsed.data.draftId)
      .maybeSingle();
    if (error) throw error;
    if (!draft) return res.status(404).json({ error: 'Draft not found', code: 'not_found' });
    await assertBrandAccess(draft.brand_id, req.user.id);

    const $ = cheerio.load(draft.body_html ?? '');
    const hrefs = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get();
    const { reads, skipped } = await checkLinks(hrefs, {
      reserve: (wanted) => reserveReads(req.user.id, wanted),
      log: req.log,
    });
    return res.json({
      links: [...reads].map(([href, read]) => ({ href, ...read })),
      skipped,
    });
  } catch (err) {
    if (err?.status === 403 || err?.status === 404) {
      return res.status(err.status).json({ error: err.message, code: 'forbidden' });
    }
    req.log.error({ err }, 'content link check error');
    return res.status(500).json({ error: 'Failed to check the links', code: 'failed' });
  }
});

const sourceClassesBody = z.object({
  draftId: z.guid(),
  sites: z.array(z.string().trim().toLowerCase().min(1).max(300)).min(1).max(MAX_SOURCE_SITES),
});

/**
 * A PlanLimitError's answer, as the editor's other routes give it
 * (contentDrafts.js): 402 no_subscription when there is no plan, else 429
 * ai_budget for a spent budget.
 */
function planLimit(res, err) {
  if (err.statusCode === 402) {
    return res.status(402).json({ error: err.message, code: 'no_subscription' });
  }
  return res.status(429).json({ error: err.message, code: 'ai_budget' });
}

/**
 * POST /api/content-pages/source-classes { draftId, sites } (Quality CE-046,
 * part b): the kind of each site the editor's rules can't place, read once
 * by the model and kept for every workspace. Only sites the draft links, as
 * saved, are read: the route reads no other site. Off until Quality's phase
 * 2 is live (CONTENT_QUALITY_PHASE). A spent AI budget answers 429
 * ai_budget: the editor leaves those sources out of Trust (402
 * no_subscription without a plan).
 */
router.post('/source-classes', qualityCheckLimiter, async (req, res) => {
  if (qualityPhase() < 2) return res.status(404).json({ error: 'Not available', code: 'off' });
  const parsed = sourceClassesBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id, body_html, kept_sources')
      .eq('id', parsed.data.draftId)
      .maybeSingle();
    if (error) throw error;
    if (!draft) return res.status(404).json({ error: 'Draft not found', code: 'not_found' });
    const { orgId } = await assertBrandAccess(draft.brand_id, req.user.id);

    const $ = cheerio.load(draft.body_html ?? '');
    const linked = linkedSites(
      $('a[href]')
        .map((_, el) => $(el).attr('href'))
        .get(),
    );
    // A site whose every link the person kept counts as it is: none to ask about.
    const keptLinks = new Set(draft.kept_sources ?? []);
    const sites = [...new Set(parsed.data.sites)].filter(
      (site) => linked.has(site) && !linked.get(site).every((href) => keptLinks.has(href)),
    );
    const result = await readSourceClasses({
      orgId,
      draftId: parsed.data.draftId,
      sites,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) return planLimit(res, err);
    if (err?.status === 403 || err?.status === 404) {
      return res.status(err.status).json({ error: err.message, code: 'forbidden' });
    }
    // Not the whole error: a provider's carries the request.
    req.log.error(
      { err: { name: err?.name, message: err?.message, stack: err?.stack } },
      'content source class error',
    );
    return res.status(500).json({ error: 'Failed to read the sources', code: 'failed' });
  }
});

const claimsBody = z.object({
  draftId: z.guid(),
  // The paragraph the person is writing in, as saved: read once they leave it.
  skip: z.string().max(20000).optional(),
});

/**
 * POST /api/content-pages/claims { draftId, skip? } (Quality CE-045): the
 * claims in the draft's own paragraphs, as saved, that a reader would want
 * a source for, read by the model a paragraph at a time and kept by the
 * paragraph (content_quality_claims). Off until Quality's phase 2 is live.
 * A spent AI budget answers 429 ai_budget: the editor leaves the claims it
 * hasn't read out of Trust (402 no_subscription without a plan).
 */
router.post('/claims', claimsLimiter, async (req, res) => {
  if (qualityPhase() < 2) return res.status(404).json({ error: 'Not available', code: 'off' });
  const parsed = claimsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id, body_html')
      .eq('id', parsed.data.draftId)
      .maybeSingle();
    if (error) throw error;
    if (!draft) return res.status(404).json({ error: 'Draft not found', code: 'not_found' });
    const { orgId } = await assertBrandAccess(draft.brand_id, req.user.id);
    const result = await readDraftClaims({
      orgId,
      draftId: parsed.data.draftId,
      html: draft.body_html ?? '',
      skip: parsed.data.skip,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) return planLimit(res, err);
    if (err?.status === 403 || err?.status === 404) {
      return res.status(err.status).json({ error: err.message, code: 'forbidden' });
    }
    // Not the whole error: a provider's (APICallError, a RetryError of them)
    // carries the request, the page's paragraphs.
    req.log.error(
      { err: { name: err?.name, message: err?.message, stack: err?.stack } },
      'content claims error',
    );
    return res.status(500).json({ error: 'Failed to read the claims', code: 'failed' });
  }
});

const pageReadBody = z.object({ draftId: z.guid() });

/**
 * POST /api/content-pages/page-read { draftId } (Quality CE-049): the
 * draft's visual proof spots and proof asks, read from the page as saved
 * with its page type, the brand's business type and the brand's approved
 * claims about itself (CE-047). Off until Quality's phase 2 is live. A spent
 * AI budget answers the kept read with `paused`.
 */
router.post('/page-read', pageReadLimiter, async (req, res) => {
  if (qualityPhase() < 2) return res.status(404).json({ error: 'Not available', code: 'off' });
  const parsed = pageReadBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id, body_html, page_type')
      .eq('id', parsed.data.draftId)
      .maybeSingle();
    if (error) throw error;
    if (!draft) return res.status(404).json({ error: 'Draft not found', code: 'not_found' });
    const { orgId } = await assertBrandAccess(draft.brand_id, req.user.id);
    const context = await pageReadContext(draft.brand_id);
    const result = await readPage({
      orgId,
      draftId: parsed.data.draftId,
      html: draft.body_html ?? '',
      pageType: draft.page_type,
      ...context,
    });
    return res.json(result);
  } catch (err) {
    if (err?.status === 403 || err?.status === 404) {
      return res.status(err.status).json({ error: err.message, code: 'forbidden' });
    }
    // Not the whole error: a provider's carries the request, the page's words.
    req.log.error(
      { err: { name: err?.name, message: err?.message, stack: err?.stack } },
      'content page read error',
    );
    return res.status(500).json({ error: 'Failed to read the page', code: 'failed' });
  }
});

export default router;
