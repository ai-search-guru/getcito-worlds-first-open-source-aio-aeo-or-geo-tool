/**
 * Pages Chat opens (lib/pageOpen.js; CHAT-10 §B, fetch_page), for the web's
 * Chat engine. Server to server: CRON_SECRET auth, as the other internal
 * endpoints; the web checks the person and their workspace, the page's site
 * and the run's pages before it asks.
 *
 * POST /api/internal/chat/pages/open { url, hosts, domains, orgId }
 *   hosts and domains: the run's sites (a host as it is, "www." aside; a
 *   domain with its subdomains); every step of the page's redirects must be
 *   on one (not_allowed). The web sends only well-formed names. orgId: the
 *   workspace the page is opened for, always given (400 without it), so
 *   each workspace has its own places.
 *   → 200 { page }: what Chat reads of the page, never its HTML.
 *   → 4xx/5xx { code, message, status }: why it couldn't be opened
 *     (safe-fetch's codes; status: the page's own answer). The web words
 *     each code itself: a message never carries what the page sent.
 *   → 429 { code: 'busy' }: a workspace opens 2 pages at once at most, so
 *     one run can't hold the API's event loop. The count is this process's:
 *     with several API instances, a workspace opens 2 on each.
 *
 * Neither the page nor its address is logged. Calls with the secret aren't
 * counted by the API's per-IP limiter (rateLimiter.js), as the budget's.
 */

import { Router } from 'express';
import { z } from 'zod';
import { openPage } from '../lib/pageOpen.js';
import { PageFetchError } from '../lib/safeFetch.js';

const router = Router();

router.use((req, res, next) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** A host name, lower case (labels of letters, digits and hyphens), or an IPv4 address. */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$|^\d{1,3}(?:\.\d{1,3}){3}$/;
const hostList = z.array(z.string().regex(HOST)).max(1500);

const openSchema = z.strictObject({
  url: z.string().trim().min(1).max(2048),
  hosts: hostList,
  domains: hostList,
  orgId: z.guid(),
});

/** The answer for a page that couldn't be opened, by safe-fetch's code. */
const FETCH_STATUS = {
  invalid_url: 400,
  blocked: 400,
  not_allowed: 422,
  too_many_redirects: 422,
  not_html: 422,
  too_large: 422,
  too_deep: 422,
  http_error: 422,
  timeout: 504,
  unreachable: 502,
};

/** Pages a workspace opens at once, at most. */
export const PAGES_AT_ONCE = 2;
/** Pages opening now, by workspace, in this process (not shared between API instances). */
const opening = new Map();

router.post('/open', async (req, res) => {
  const parsed = openSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ code: 'invalid_url', message: 'Not a URL', status: null });
  }
  const { url, hosts, domains, orgId: key } = parsed.data;
  const now = opening.get(key) ?? 0;
  if (now >= PAGES_AT_ONCE) {
    return res
      .status(429)
      .json({ code: 'busy', message: 'Other pages are opening for this workspace', status: null });
  }
  opening.set(key, now + 1);
  try {
    const page = await openPage(url, { sites: { hosts, domains } });
    return res.json({ page });
  } catch (err) {
    if (err instanceof PageFetchError) {
      return res
        .status(FETCH_STATUS[err.code] ?? 502)
        .json({ code: err.code, message: err.message, status: err.status ?? null });
    }
    // The error's name and message only: never the page or its address.
    req.log.error({ err: { name: err?.name, message: err?.message } }, 'chat page open error');
    return res.status(500).json({ code: 'failed', message: 'The page could not be read' });
  } finally {
    const left = (opening.get(key) ?? 1) - 1;
    if (left > 0) opening.set(key, left);
    else opening.delete(key);
  }
});

export default router;
